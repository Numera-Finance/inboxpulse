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
  getTemplate,
  templateExists,
  getAllTemplates,
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
import { getEmailSender } from '../senders';
import { taskAssignedTemplate } from '../templates/immediate';
import { escalationSummaryTemplate } from '../templates/batch';

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
 * Get user preferences (legacy - redirects to /preferences/all)
 */
app.get('/preferences', async (c) => {
  const header = getRequestHeader(c);

  try {
    const preferencesService = container.resolve<PreferencesService>(PreferencesService);
    const preferences = await preferencesService.getAllPreferencesWithDefaults(header.userId, header);

    return c.json({ success: true, data: { preferences } });
  } catch (error: any) {
    logger.error({ error: error.message }, 'Failed to get user preferences');
    return c.json({ success: false, error: error.message }, 500);
  }
});

/**
 * Update user preferences for a notification type (legacy - use PUT /preferences/by-name/:templateName instead)
 * Kept for backwards compatibility - typeId is treated as templateName
 */
app.put('/preferences/:typeId', async (c) => {
  const header = getRequestHeader(c);
  const templateName = c.req.param('typeId'); // Legacy: typeId is now templateName
  const body = await c.req.json().catch(() => ({}));

  try {
    if (!templateExists(templateName)) {
      return c.json({ success: false, error: `Unknown template: ${templateName}` }, 404);
    }

    const preferencesService = container.resolve<PreferencesService>(PreferencesService);
    const result = await preferencesService.updatePreference(
      header.userId,
      templateName,
      body,
      header
    );

    return c.json({ success: true, data: result });
  } catch (error: any) {
    logger.error({ error: error.message }, 'Failed to update preferences');
    return c.json({ success: false, error: error.message }, 500);
  }
});

/**
 * Subscribe to notification type (legacy - use PUT /preferences/by-name/:templateName instead)
 * Sets enabled: true for the given template
 */
app.post('/subscribe', async (c) => {
  const header = getRequestHeader(c);
  const body = await c.req.json().catch(() => ({}));

  const templateName = body.notificationTypeId || body.templateName;
  if (!templateName) {
    return c.json({ success: false, error: 'templateName or notificationTypeId is required' }, 400);
  }

  try {
    if (!templateExists(templateName)) {
      return c.json({ success: false, error: `Unknown template: ${templateName}` }, 404);
    }

    const preferencesService = container.resolve<PreferencesService>(PreferencesService);
    const result = await preferencesService.updatePreference(
      header.userId,
      templateName,
      { enabled: true },
      header
    );

    return c.json({ success: true, data: result });
  } catch (error: any) {
    logger.error({ error: error.message }, 'Failed to subscribe');
    return c.json({ success: false, error: error.message }, 500);
  }
});

/**
 * Unsubscribe from notification type (legacy - use PUT /preferences/by-name/:templateName instead)
 * Sets enabled: false for the given template
 */
app.post('/unsubscribe/:typeId', async (c) => {
  const header = getRequestHeader(c);
  const templateName = c.req.param('typeId');

  try {
    if (!templateExists(templateName)) {
      return c.json({ success: false, error: `Unknown template: ${templateName}` }, 404);
    }

    const preferencesService = container.resolve<PreferencesService>(PreferencesService);
    await preferencesService.updatePreference(
      header.userId,
      templateName,
      { enabled: false },
      header
    );

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
  const templateName = c.req.query('type');

  if (!notificationId || !templateName) {
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

    // Set enabled: false for this template
    const preferencesService = container.resolve<PreferencesService>(PreferencesService);
    await preferencesService.updatePreference(
      notification.userId,
      templateName,
      { enabled: false },
      header
    );

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
// Send Task Notification (Real Data)
// =============================================================================

/**
 * Send task-assigned notification
 * POST /api/notifications/send/task-assigned
 *
 * Body: {
 *   task: {
 *     id: string,
 *     customer: string,
 *     subject: string,
 *     dateOpened: string,
 *     assignedTo: string,
 *     assignedBy?: string,
 *     accountOwner: string,
 *     detailsUrl?: string
 *   },
 *   recipientEmail: string,
 *   recipientName?: string
 * }
 */
app.post('/send/task-assigned', async (c) => {
  const header = getRequestHeader(c);
  const body = await c.req.json().catch(() => ({}));

  const { task, recipientEmail, recipientName } = body;

  if (!task) {
    return c.json({ success: false, error: 'task object is required' }, 400);
  }

  if (!task.id || !task.customer || !task.subject) {
    return c.json({
      success: false,
      error: 'task.id, task.customer, and task.subject are required'
    }, 400);
  }

  if (!recipientEmail) {
    return c.json({ success: false, error: 'recipientEmail is required' }, 400);
  }

  try {
    // Build task data for email template with defaults
    const taskData = {
      id: task.id,
      customer: task.customer,
      subject: task.subject,
      dateOpened: task.dateOpened || new Date().toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
      }),
      assignedTo: task.assignedTo || 'Unassigned',
      assignedBy: task.assignedBy || null,
      accountOwner: task.accountOwner || task.assignedTo || 'Unknown',
      detailsUrl: task.detailsUrl || `${process.env.WEB_URL || 'http://localhost:4000'}/tasks/${task.id}`,
    };

    // Render the email template
    const html = await render(
      TaskAssignedEmail({
        task: taskData,
        recipientName: recipientName || (taskData.assignedTo !== 'Unassigned' ? taskData.assignedTo.split(' ')[0] : 'Team'),
      })
    );

    const subject = `New Escalation: ${taskData.customer} - ${taskData.subject.substring(0, 50)}${taskData.subject.length > 50 ? '...' : ''}`;

    // Build user and payload for template
    const user = {
      userId: header.userId,
      tenantId: header.tenantId,
      email: recipientEmail,
      timezone: 'UTC',
    };

    const payload = {
      channel: 'email' as const,
      to: recipientEmail,
      subject,
      html,
    };

    // Send via template (uses EMAIL_OVERRIDE in dev)
    const emailSender = getEmailSender();
    const result = await taskAssignedTemplate.send(user, payload, emailSender);

    return c.json({
      success: result.sent,
      data: {
        template: 'task-assigned',
        recipient: recipientEmail,
        subject,
        messageId: result.messageId,
        taskData,
      },
      error: result.error,
    });
  } catch (error: any) {
    logger.error({ error: error.message }, 'Failed to send task-assigned notification');
    return c.json({ success: false, error: error.message }, 500);
  }
});

/**
 * Send escalation batch notification (for manual testing)
 * POST /api/notifications/send/escalation-batch
 *
 * Note: In production, batch templates are triggered by cron/Inngest.
 * This endpoint is for manual testing with provided data.
 *
 * Body: {
 *   escalations: Array<{ id, customer, subject, dateOpened, assignedTo, accountOwner, detailsUrl }>,
 *   metrics: { new, open1Day, open3Days, openMoreThan3Days },
 *   recipientName: string,
 *   recipientEmail: string
 * }
 */
app.post('/send/escalation-batch', async (c) => {
  const header = getRequestHeader(c);
  const body = await c.req.json().catch(() => ({}));

  const { escalations, metrics, recipientName, recipientEmail } = body;

  if (!escalations || !Array.isArray(escalations)) {
    return c.json({ success: false, error: 'escalations array is required' }, 400);
  }

  if (!metrics) {
    return c.json({ success: false, error: 'metrics object is required' }, 400);
  }

  if (!recipientEmail) {
    return c.json({ success: false, error: 'recipientEmail is required' }, 400);
  }

  try {
    // Render the email template
    const html = await render(
      EscalationBatchEmail({
        escalations,
        metrics,
        recipientName: recipientName || 'Team',
      })
    );

    const totalCount = (metrics.new || 0) + (metrics.open1Day || 0) + (metrics.open3Days || 0) + (metrics.openMoreThan3Days || 0);
    const subject = `Action Required: ${totalCount} Escalation${totalCount !== 1 ? 's' : ''} Pending`;

    // Build payload and send via email sender (uses EMAIL_OVERRIDE in dev)
    const emailSender = getEmailSender();
    const result = await emailSender.send({
      channel: 'email',
      to: recipientEmail,
      subject,
      html,
    });

    return c.json({
      success: result.sent,
      data: {
        template: 'escalation-batch',
        recipient: recipientEmail,
        subject,
        messageId: result.messageId,
        metrics,
        escalationCount: escalations.length,
      },
      error: result.error,
    });
  } catch (error: any) {
    logger.error({ error: error.message }, 'Failed to send escalation-batch notification');
    return c.json({ success: false, error: error.message }, 500);
  }
});

// =============================================================================
// Simulation Routes (for testing with sample data)
// =============================================================================

/**
 * Simulate task-assigned notification with sample data
 * POST /api/notifications/simulate/task-assigned
 *
 * Uses EMAIL_OVERRIDE env var if set, otherwise sends to recipientEmail.
 */
app.post('/simulate/task-assigned', async (c) => {
  const body = await c.req.json().catch(() => ({}));

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
  const recipientEmail = body.recipientEmail || 'test@example.com';

  try {
    const html = await render(
      TaskAssignedEmail({
        task: taskData,
        recipientName,
      })
    );

    const subject = `New Escalation: ${taskData.customer} - ${taskData.subject.substring(0, 50)}${taskData.subject.length > 50 ? '...' : ''}`;

    const emailSender = getEmailSender();
    const result = await emailSender.send({
      channel: 'email',
      to: recipientEmail,
      subject,
      html,
    });

    return c.json({
      success: result.sent,
      data: {
        template: 'task-assigned',
        recipient: recipientEmail,
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
 * Uses EMAIL_OVERRIDE env var if set, otherwise sends to recipientEmail.
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
  const recipientEmail = body.recipientEmail || 'test@example.com';

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

    const emailSender = getEmailSender();
    const result = await emailSender.send({
      channel: 'email',
      to: recipientEmail,
      subject,
      html,
    });

    return c.json({
      success: result.sent,
      data: {
        template: 'escalation-batch',
        recipient: recipientEmail,
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

// =============================================================================
// Preferences API (template-based)
// =============================================================================
// Templates are defined in code. User preferences stored per templateName.

/**
 * Get all preferences for current user (merged with template defaults)
 * GET /api/notifications/preferences/all
 */
app.get('/preferences/all', async (c) => {
  const header = getRequestHeader(c);

  try {
    const preferencesService = container.resolve<PreferencesService>(PreferencesService);
    const preferences = await preferencesService.getAllPreferencesWithDefaults(header.userId, header);

    return c.json({ success: true, data: { preferences } });
  } catch (error: any) {
    logger.error({ error: error.message }, 'Failed to get all preferences');
    return c.json({ success: false, error: error.message }, 500);
  }
});

/**
 * Get user's preference for a template by name
 * GET /api/notifications/preferences/by-name/:templateName
 */
app.get('/preferences/by-name/:templateName', async (c) => {
  const header = getRequestHeader(c);
  const templateName = c.req.param('templateName');

  try {
    const template = getTemplate(templateName);
    if (!template) {
      return c.json({ success: false, error: `Unknown template: ${templateName}` }, 404);
    }

    const preferencesService = container.resolve<PreferencesService>(PreferencesService);
    const preference = await preferencesService.getPreference(header.userId, templateName, header);

    // Return preference or defaults from template
    return c.json({
      success: true,
      data: preference || {
        templateName: template.name,
        enabled: template.defaultEnabled,
        channels: template.defaultChannels,
        frequency: template.defaultFrequency,
        batchInterval: template.defaultBatchInterval,
        payload: null,
        lastSentAt: null,
        nextSendAt: null,
      },
    });
  } catch (error: any) {
    logger.error({ error: error.message, templateName }, 'Failed to get preference');
    return c.json({ success: false, error: error.message }, 500);
  }
});

/**
 * Update user's preference for a template
 * PUT /api/notifications/preferences/by-name/:templateName
 *
 * Body: { enabled?: boolean, channels?: string[], frequency?: string, batchInterval?: object }
 */
app.put('/preferences/by-name/:templateName', async (c) => {
  const header = getRequestHeader(c);
  const templateName = c.req.param('templateName');
  const body = await c.req.json().catch(() => ({}));

  try {
    if (!templateExists(templateName)) {
      return c.json({ success: false, error: `Unknown template: ${templateName}` }, 404);
    }

    const preferencesService = container.resolve<PreferencesService>(PreferencesService);
    const result = await preferencesService.updatePreference(
      header.userId,
      templateName,
      body,
      header
    );

    return c.json({ success: true, data: result });
  } catch (error: any) {
    logger.error({ error: error.message, templateName }, 'Failed to update preference');
    return c.json({ success: false, error: error.message }, 500);
  }
});

/**
 * Delete user's preference (revert to defaults)
 * DELETE /api/notifications/preferences/by-name/:templateName
 */
app.delete('/preferences/by-name/:templateName', async (c) => {
  const header = getRequestHeader(c);
  const templateName = c.req.param('templateName');

  try {
    if (!templateExists(templateName)) {
      return c.json({ success: false, error: `Unknown template: ${templateName}` }, 404);
    }

    const preferencesService = container.resolve<PreferencesService>(PreferencesService);
    await preferencesService.deletePreference(header.userId, templateName, header);

    return c.json({ success: true });
  } catch (error: any) {
    logger.error({ error: error.message, templateName }, 'Failed to delete preference');
    return c.json({ success: false, error: error.message }, 500);
  }
});

/**
 * Check if a template is enabled for a specific user
 * GET /api/notifications/preferences/by-name/:templateName/user/:userId
 *
 * Used by API service to check if user wants to receive a notification
 */
app.get('/preferences/by-name/:templateName/user/:userId', async (c) => {
  const header = getRequestHeader(c);
  const templateName = c.req.param('templateName');
  const userId = c.req.param('userId');

  try {
    const template = getTemplate(templateName);
    if (!template) {
      // Unknown template - default to enabled (fail-open)
      return c.json({ success: true, data: { enabled: true } });
    }

    const preferencesService = container.resolve<PreferencesService>(PreferencesService);
    const preference = await preferencesService.getPreference(userId, templateName, header);

    return c.json({
      success: true,
      data: {
        enabled: preference?.enabled ?? template.defaultEnabled,
        frequency: preference?.frequency ?? template.defaultFrequency,
        batchInterval: preference?.batchInterval ?? template.defaultBatchInterval,
      },
    });
  } catch (error: any) {
    logger.error({ error: error.message, templateName, userId }, 'Failed to check preference');
    // Fail-open: if we can't check, default to enabled
    return c.json({ success: true, data: { enabled: true } });
  }
});

// =============================================================================
// Simulation Routes (for testing with sample data)
// =============================================================================

/**
 * List available notification endpoints
 * GET /api/notifications/simulate
 */
app.get('/simulate', (c) => {
  return c.json({
    success: true,
    data: {
      emailOverride: process.env.EMAIL_OVERRIDE || null,
      endpoints: [
        {
          method: 'POST',
          path: '/api/notifications/send/task-assigned',
          description: 'Send task assignment notification with provided task data',
          sampleBody: {
            task: {
              id: 'uuid-of-task',
              customer: 'Acme Corp',
              subject: 'Issue with invoice',
              dateOpened: 'Dec 31, 2025',
              assignedTo: 'John Smith',
              assignedBy: 'Manager Name',
              accountOwner: 'Lisa Chen',
            },
            recipientName: 'John',
          },
        },
        {
          method: 'POST',
          path: '/api/notifications/send/escalation-batch',
          description: 'Send escalation batch summary to a manager',
          sampleBody: {
            escalations: [
              { id: 'task-1', customer: 'Acme Corp', subject: 'Issue', dateOpened: 'Dec 31, 2025', assignedTo: 'John', accountOwner: 'Lisa', detailsUrl: 'http://...' },
            ],
            metrics: { new: 2, open1Day: 3, open3Days: 1, openMoreThan3Days: 4 },
            recipientName: 'Manager',
            recipientEmail: 'manager@example.com',
          },
        },
        {
          method: 'POST',
          path: '/api/notifications/simulate/task-assigned',
          description: 'Send a test task assignment notification with sample data',
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
          description: 'Send a test escalation batch summary email with sample data',
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
