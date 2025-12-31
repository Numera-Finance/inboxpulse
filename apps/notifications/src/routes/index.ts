/**
 * Notification API routes
 */

import { Hono } from 'hono';
import { container } from 'tsyringe';
import { render } from '@react-email/components';
import {
  NotificationService,
  DeliveryService,
  PreferencesService,
  NotificationRepository,
  NotificationTypeRepository,
  sendNotificationRequestSchema,
  createNotificationTypeRequestSchema,
  updateUserPreferencesRequestSchema,
  subscribeRequestSchema,
} from '@crm/notifications';
import type { RequestHeader } from '@crm/shared';
import { logger } from '../utils/logger';
import { getRequestHeader } from '../utils/request-header';
import {
  EmailEscalation,
  DealWon,
  TaskAssignment,
  BatchDigest,
  TaskAssignedEmail,
  EscalationBatchEmail,
} from '../templates/emails';

// =============================================================================
// Postmark Email Sender (for testing)
// =============================================================================

const TEST_EMAIL_RECIPIENT = 'mbalsara@mystartupcfo.com';
const FROM_EMAIL = 'hello@9mo.ai';
const FROM_NAME = 'MSCFO Email Sentiment';

interface PostmarkSendResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

async function sendEmailViaPostmark(
  subject: string,
  htmlBody: string
): Promise<PostmarkSendResult> {
  const serverToken = process.env.POSTMARK_API_TOKEN;

  if (!serverToken) {
    logger.warn('POSTMARK_API_TOKEN not set, skipping email send');
    return { success: false, error: 'POSTMARK_API_TOKEN not configured' };
  }

  try {
    const response = await fetch('https://api.postmarkapp.com/email', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-Postmark-Server-Token': serverToken,
      },
      body: JSON.stringify({
        From: `${FROM_NAME} <${FROM_EMAIL}>`,
        To: TEST_EMAIL_RECIPIENT,
        Subject: subject,
        HtmlBody: htmlBody,
        MessageStream: 'outbound',
      }),
    });

    const data = await response.json() as { MessageID?: string; ErrorCode?: number; Message?: string };

    if (!response.ok || (data.ErrorCode && data.ErrorCode !== 0)) {
      logger.error({ data }, 'Postmark send failed');
      return { success: false, error: data.Message || `HTTP ${response.status}` };
    }

    logger.info({ messageId: data.MessageID, to: TEST_EMAIL_RECIPIENT }, 'Email sent via Postmark');
    return { success: true, messageId: data.MessageID };
  } catch (error: any) {
    logger.error({ error: error.message }, 'Postmark request failed');
    return { success: false, error: error.message };
  }
}

const app = new Hono();

/**
 * Send notification (fan-out to subscribers)
 */
app.post('/send', async (c) => {
  const header = getRequestHeader(c);
  const body = await c.req.json();

  const validationResult = sendNotificationRequestSchema.safeParse(body);
  if (!validationResult.success) {
    logger.error({ errors: validationResult.error.issues }, 'Invalid send notification request');
    return c.json({ success: false, error: 'Invalid request', details: validationResult.error.issues }, 400);
  }

  try {
    const notificationService = container.resolve<NotificationService>(NotificationService);
    const result = await notificationService.sendNotification(validationResult.data, header);

    return c.json({ success: true, data: result });
  } catch (error: any) {
    logger.error({ error: error.message }, 'Failed to send notification');
    return c.json({ success: false, error: error.message }, 500);
  }
});

/**
 * Create notification type
 */
app.post('/types', async (c) => {
  const header = getRequestHeader(c);
  const body = await c.req.json();

  const validationResult = createNotificationTypeRequestSchema.safeParse({
    ...body,
    tenantId: header.tenantId,
  });
  if (!validationResult.success) {
    logger.error({ errors: validationResult.error.issues }, 'Invalid create notification type request');
    return c.json({ success: false, error: 'Invalid request', details: validationResult.error.issues }, 400);
  }

  try {
    const typeRepo = container.resolve<NotificationTypeRepository>('NotificationTypeRepository');
    const result = await typeRepo.create(validationResult.data, header);

    return c.json({ success: true, data: result });
  } catch (error: any) {
    logger.error({ error: error.message }, 'Failed to create notification type');
    return c.json({ success: false, error: error.message }, 500);
  }
});

/**
 * Get notification types
 */
app.get('/types', async (c) => {
  const header = getRequestHeader(c);

  try {
    const typeRepo = container.resolve<NotificationTypeRepository>('NotificationTypeRepository');
    const types = await typeRepo.findAll(header);

    return c.json({ success: true, data: { types } });
  } catch (error: any) {
    logger.error({ error: error.message }, 'Failed to get notification types');
    return c.json({ success: false, error: error.message }, 500);
  }
});

/**
 * Get user preferences
 */
app.get('/preferences', async (c) => {
  const header = getRequestHeader(c);

  try {
    const preferencesService = container.resolve<PreferencesService>(PreferencesService);
    const preferences = await preferencesService.getUserPreferences(header.userId, header);

    return c.json({ success: true, data: { preferences } });
  } catch (error: any) {
    logger.error({ error: error.message }, 'Failed to get user preferences');
    return c.json({ success: false, error: error.message }, 500);
  }
});

/**
 * Update user preferences for a notification type
 */
app.put('/preferences/:typeId', async (c) => {
  const header = getRequestHeader(c);
  const typeId = c.req.param('typeId');
  const body = await c.req.json();

  const validationResult = updateUserPreferencesRequestSchema.safeParse({
    ...body,
    notificationTypeId: typeId,
  });
  if (!validationResult.success) {
    logger.error({ errors: validationResult.error.issues }, 'Invalid update preferences request');
    return c.json({ success: false, error: 'Invalid request', details: validationResult.error.issues }, 400);
  }

  try {
    const preferencesService = container.resolve<PreferencesService>(PreferencesService);
    const result = await preferencesService.updatePreference(
      header.userId,
      typeId,
      validationResult.data,
      header
    );

    return c.json({ success: true, data: result });
  } catch (error: any) {
    logger.error({ error: error.message }, 'Failed to update preferences');
    return c.json({ success: false, error: error.message }, 500);
  }
});

/**
 * Subscribe to notification type
 */
app.post('/subscribe', async (c) => {
  const header = getRequestHeader(c);
  const body = await c.req.json();

  const validationResult = subscribeRequestSchema.safeParse(body);
  if (!validationResult.success) {
    logger.error({ errors: validationResult.error.issues }, 'Invalid subscribe request');
    return c.json({ success: false, error: 'Invalid request', details: validationResult.error.issues }, 400);
  }

  try {
    const preferencesService = container.resolve<PreferencesService>(PreferencesService);
    const result = await preferencesService.subscribe(header.userId, validationResult.data, header);

    return c.json({ success: true, data: result });
  } catch (error: any) {
    logger.error({ error: error.message }, 'Failed to subscribe');
    return c.json({ success: false, error: error.message }, 500);
  }
});

/**
 * Unsubscribe from notification type
 */
app.post('/unsubscribe/:typeId', async (c) => {
  const header = getRequestHeader(c);
  const typeId = c.req.param('typeId');

  try {
    const preferencesService = container.resolve<PreferencesService>(PreferencesService);
    await preferencesService.unsubscribe(header.userId, typeId, header);

    return c.json({ success: true });
  } catch (error: any) {
    logger.error({ error: error.message }, 'Failed to unsubscribe');
    return c.json({ success: false, error: error.message }, 500);
  }
});

/**
 * Get user notifications
 */
app.get('/notifications', async (c) => {
  const header = getRequestHeader(c);
  const status = c.req.query('status')?.split(',');
  const limit = parseInt(c.req.query('limit') || '50');
  const offset = parseInt(c.req.query('offset') || '0');

  try {
    const notificationRepo = container.resolve<NotificationRepository>('NotificationRepository');
    const notifications = await notificationRepo.findByUser(header.userId, header, {
      status,
      limit,
      offset,
    });

    return c.json({ success: true, data: { notifications } });
  } catch (error: any) {
    logger.error({ error: error.message }, 'Failed to get notifications');
    return c.json({ success: false, error: error.message }, 500);
  }
});

/**
 * Get single notification
 */
app.get('/notifications/:id', async (c) => {
  const header = getRequestHeader(c);
  const id = c.req.param('id');

  try {
    const notificationRepo = container.resolve<NotificationRepository>('NotificationRepository');
    const notification = await notificationRepo.findById(id, header);

    if (!notification) {
      return c.json({ success: false, error: 'Notification not found' }, 404);
    }

    return c.json({ success: true, data: notification });
  } catch (error: any) {
    logger.error({ error: error.message }, 'Failed to get notification');
    return c.json({ success: false, error: error.message }, 500);
  }
});

/**
 * Mark notification as read
 */
app.post('/notifications/:id/read', async (c) => {
  const header = getRequestHeader(c);
  const id = c.req.param('id');

  try {
    const notificationRepo = container.resolve<NotificationRepository>('NotificationRepository');
    const result = await notificationRepo.markAsRead(id, header);

    if (!result) {
      return c.json({ success: false, error: 'Notification not found' }, 404);
    }

    return c.json({ success: true, data: result });
  } catch (error: any) {
    logger.error({ error: error.message }, 'Failed to mark notification as read');
    return c.json({ success: false, error: error.message }, 500);
  }
});

/**
 * Unsubscribe via link (one-click from email)
 */
app.get('/unsubscribe', async (c) => {
  const notificationId = c.req.query('nid');
  const typeId = c.req.query('type');

  if (!notificationId || !typeId) {
    return c.json({ success: false, error: 'Invalid unsubscribe link' }, 400);
  }

  try {
    // Get notification to find user
    const notificationRepo = container.resolve<NotificationRepository>('NotificationRepository');
    const notification = await notificationRepo.findById(notificationId, {
      tenantId: '',
      userId: '',
      permissions: [],
    } as RequestHeader);

    if (!notification) {
      return c.json({ success: false, error: 'Invalid unsubscribe link' }, 400);
    }

    const header: RequestHeader = {
      tenantId: notification.tenantId,
      userId: notification.userId,
      permissions: [],
    };

    const preferencesService = container.resolve<PreferencesService>(PreferencesService);
    await preferencesService.unsubscribe(notification.userId, typeId, header);

    // Return HTML response for browser
    return c.html(`
      <!DOCTYPE html>
      <html>
        <head><title>Unsubscribed</title></head>
        <body>
          <h1>You have been unsubscribed</h1>
          <p>You will no longer receive these notifications.</p>
        </body>
      </html>
    `);
  } catch (error: any) {
    logger.error({ error: error.message }, 'Failed to unsubscribe');
    return c.json({ success: false, error: error.message }, 500);
  }
});

/**
 * Preview template - sample data for each template type
 */
const sampleTemplateData: Record<string, { component: any; props: Record<string, any> }> = {
  'email.escalation': {
    component: EmailEscalation,
    props: {
      recipientName: 'John Smith',
      customerName: 'Acme Corporation',
      emailSubject: 'Urgent: Service outage affecting production',
      severity: 'high',
      reason: 'Customer has been waiting for a response for over 24 hours',
      waitingHours: 26,
      viewUrl: 'https://app.example.com/emails/123',
      approveUrl: 'https://app.example.com/actions/approve?token=abc123',
      rejectUrl: 'https://app.example.com/actions/reject?token=abc123',
      unsubscribeUrl: 'https://app.example.com/unsubscribe?nid=123&type=email.escalation',
    },
  },
  'deal.won': {
    component: DealWon,
    props: {
      recipientName: 'Sarah Johnson',
      dealName: 'Enterprise License - Acme Corp',
      customerName: 'Acme Corporation',
      dealValue: '150,000',
      currency: 'USD',
      closedBy: 'Mike Wilson',
      closedDate: new Date().toLocaleDateString(),
      viewUrl: 'https://app.example.com/deals/456',
      unsubscribeUrl: 'https://app.example.com/unsubscribe?nid=456&type=deal.won',
    },
  },
  'task.assigned': {
    component: TaskAssignment,
    props: {
      recipientName: 'Alex Chen',
      taskTitle: 'Follow up with Acme Corp on contract renewal',
      taskDescription: 'Contact the procurement team to discuss Q1 contract renewal terms.',
      assignedBy: 'Sarah Johnson',
      dueDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toLocaleDateString(),
      priority: 'high',
      viewUrl: 'https://app.example.com/tasks/789',
      completeUrl: 'https://app.example.com/actions/complete?token=xyz789',
      unsubscribeUrl: 'https://app.example.com/unsubscribe?nid=789&type=task.assigned',
    },
  },
  'batch.digest': {
    component: BatchDigest,
    props: {
      recipientName: 'Team Member',
      periodLabel: 'Today',
      notifications: [
        {
          id: '1',
          type: 'email.escalation',
          title: 'Email from Acme Corp needs attention',
          summary: 'High priority - waiting 12 hours',
          timestamp: '2 hours ago',
          priority: 'high',
          viewUrl: 'https://app.example.com/emails/101',
        },
        {
          id: '2',
          type: 'deal.won',
          title: 'Deal Won: TechStart Inc',
          summary: 'USD 45,000 - Closed by Mike',
          timestamp: '4 hours ago',
          viewUrl: 'https://app.example.com/deals/102',
        },
        {
          id: '3',
          type: 'task.assigned',
          title: 'New Task: Prepare Q4 report',
          summary: 'Due in 3 days',
          timestamp: '5 hours ago',
          priority: 'medium',
          viewUrl: 'https://app.example.com/tasks/103',
        },
      ],
      totalCount: 7,
      viewAllUrl: 'https://app.example.com/notifications',
      unsubscribeUrl: 'https://app.example.com/unsubscribe?type=batch.digest',
    },
  },
};

/**
 * List available preview templates
 */
app.get('/preview', (c) => {
  const templates = Object.keys(sampleTemplateData).map((id) => ({
    id,
    previewUrl: `/api/notifications/preview/${id}`,
    htmlUrl: `/api/notifications/preview/${id}?format=html`,
  }));

  return c.json({
    success: true,
    data: { templates },
  });
});

/**
 * Preview a notification template
 * Query params:
 *   - format: 'json' (default) or 'html'
 *   - Can override props via query params (e.g., ?recipientName=Jane)
 */
app.get('/preview/:templateId', async (c) => {
  const templateId = c.req.param('templateId');
  const format = c.req.query('format') || 'json';

  const template = sampleTemplateData[templateId];
  if (!template) {
    return c.json({
      success: false,
      error: `Template not found: ${templateId}`,
      availableTemplates: Object.keys(sampleTemplateData),
    }, 404);
  }

  try {
    // Merge sample props with any query param overrides
    const queryOverrides: Record<string, string> = {};
    for (const [key, value] of Object.entries(c.req.query())) {
      if (key !== 'format' && value) {
        queryOverrides[key] = value;
      }
    }

    const props = { ...template.props, ...queryOverrides };
    const Component = template.component;
    const html = await render(Component(props));

    if (format === 'html') {
      return c.html(html);
    }

    return c.json({
      success: true,
      data: {
        templateId,
        props,
        html,
        subject: getSubjectForTemplate(templateId, props),
      },
    });
  } catch (error: any) {
    logger.error({ error: error.message, templateId }, 'Failed to render template preview');
    return c.json({ success: false, error: error.message }, 500);
  }
});

/**
 * Get subject line for template
 */
function getSubjectForTemplate(templateId: string, props: Record<string, any>): string {
  const subjects: Record<string, string> = {
    'email.escalation': `${props.severity}: Email from ${props.customerName} needs attention`,
    'deal.won': `Deal Won: ${props.dealName} - ${props.currency} ${props.dealValue}`,
    'task.assigned': `New Task: ${props.taskTitle}`,
    'batch.digest': `Your notification summary for ${props.periodLabel}`,
  };
  return subjects[templateId] || templateId;
}

// =============================================================================
// Simulation Routes (for testing email delivery)
// =============================================================================

/**
 * Simulate task-assigned notification
 * POST /api/notifications/simulate/task-assigned
 *
 * Sends a test task assignment email to the hardcoded test recipient
 */
app.post('/simulate/task-assigned', async (c) => {
  const body = await c.req.json().catch(() => ({}));

  // Sample task data (can be overridden via request body)
  const taskData = {
    id: body.id || 'task-123',
    customer: body.customer || 'Acme Corporation',
    subject: body.subject || 'Urgent: Billing discrepancy on invoice #4521',
    dateOpened: body.dateOpened || new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
    assignedTo: body.assignedTo || 'Manish Balsara',
    assignedBy: body.assignedBy || 'Sarah Johnson',
    accountOwner: body.accountOwner || 'Lisa Chen',
    detailsUrl: body.detailsUrl || 'https://app.mystartupcfo.com/tasks/task-123',
  };

  const recipientName = body.recipientName || 'Manish';

  try {
    // Render the email template
    const html = await render(
      TaskAssignedEmail({
        task: taskData,
        recipientName,
      })
    );

    const subject = `New Escalation: ${taskData.customer} - ${taskData.subject.substring(0, 50)}${taskData.subject.length > 50 ? '...' : ''}`;

    // Send via Postmark
    const result = await sendEmailViaPostmark(subject, html);

    return c.json({
      success: result.success,
      data: {
        template: 'task-assigned',
        recipient: TEST_EMAIL_RECIPIENT,
        subject,
        messageId: result.messageId,
        taskData,
      },
      error: result.error,
    });
  } catch (error: any) {
    logger.error({ error: error.message }, 'Failed to simulate task-assigned notification');
    return c.json({ success: false, error: error.message }, 500);
  }
});

/**
 * Simulate escalation-batch notification
 * POST /api/notifications/simulate/escalation-batch
 *
 * Sends a test escalation batch summary email to the hardcoded test recipient
 */
app.post('/simulate/escalation-batch', async (c) => {
  const body = await c.req.json().catch(() => ({}));

  // Sample metrics
  const metrics = body.metrics || {
    new: 3,
    open1Day: 2,
    open3Days: 4,
    openMoreThan3Days: 1,
  };

  // Sample escalations
  const escalations = body.escalations || [
    {
      id: 'esc-1',
      customer: 'Acme Corporation',
      subject: 'Billing discrepancy on invoice #4521',
      dateOpened: 'Dec 30, 2024',
      assignedTo: 'John Smith',
      accountOwner: 'Lisa Chen',
      detailsUrl: 'https://app.mystartupcfo.com/tasks/esc-1',
    },
    {
      id: 'esc-2',
      customer: 'TechStart Inc',
      subject: 'Integration API timeout issues affecting production',
      dateOpened: 'Dec 29, 2024',
      assignedTo: 'Sarah Johnson',
      accountOwner: 'Sarah Johnson',
      detailsUrl: 'https://app.mystartupcfo.com/tasks/esc-2',
    },
    {
      id: 'esc-3',
      customer: 'Global Logistics',
      subject: 'Missing shipment documentation for Q4 orders',
      dateOpened: 'Dec 27, 2024',
      assignedTo: 'Mike Chen',
      accountOwner: 'Rachel Kim',
      detailsUrl: 'https://app.mystartupcfo.com/tasks/esc-3',
    },
    {
      id: 'esc-4',
      customer: 'Startup Ventures',
      subject: 'Contract renewal discussion needed',
      dateOpened: 'Dec 25, 2024',
      assignedTo: 'Alex Wong',
      accountOwner: 'Lisa Chen',
      detailsUrl: 'https://app.mystartupcfo.com/tasks/esc-4',
    },
  ];

  const recipientName = body.recipientName || 'Manish';

  try {
    // Render the email template
    const html = await render(
      EscalationBatchEmail({
        escalations,
        metrics,
        recipientName,
      })
    );

    const totalCount = metrics.new + metrics.open1Day + metrics.open3Days + metrics.openMoreThan3Days;
    const subject = `Action Required: ${totalCount} Escalation${totalCount !== 1 ? 's' : ''} Pending`;

    // Send via Postmark
    const result = await sendEmailViaPostmark(subject, html);

    return c.json({
      success: result.success,
      data: {
        template: 'escalation-batch',
        recipient: TEST_EMAIL_RECIPIENT,
        subject,
        messageId: result.messageId,
        metrics,
        escalationCount: escalations.length,
      },
      error: result.error,
    });
  } catch (error: any) {
    logger.error({ error: error.message }, 'Failed to simulate escalation-batch notification');
    return c.json({ success: false, error: error.message }, 500);
  }
});

/**
 * List available simulation endpoints
 * GET /api/notifications/simulate
 */
app.get('/simulate', (c) => {
  return c.json({
    success: true,
    data: {
      testRecipient: TEST_EMAIL_RECIPIENT,
      endpoints: [
        {
          method: 'POST',
          path: '/api/notifications/simulate/task-assigned',
          description: 'Send a test task assignment notification email',
          sampleBody: {
            recipientName: 'John',
            customer: 'Acme Corp',
            subject: 'Issue with invoice',
            assignedBy: 'Manager Name',
          },
        },
        {
          method: 'POST',
          path: '/api/notifications/simulate/escalation-batch',
          description: 'Send a test escalation batch summary email',
          sampleBody: {
            recipientName: 'Team',
            metrics: { new: 2, open1Day: 3, open3Days: 1, openMoreThan3Days: 4 },
          },
        },
      ],
      note: 'All test emails are sent to the hardcoded recipient. Set POSTMARK_API_TOKEN in .env.local to enable sending.',
    },
  });
});

export default app;
