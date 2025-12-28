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
  ActionService,
  NotificationRepository,
  NotificationTypeRepository,
  sendNotificationRequestSchema,
  createNotificationTypeRequestSchema,
  updateUserPreferencesRequestSchema,
  subscribeRequestSchema,
  actionRequestSchema,
  batchActionRequestSchema,
} from '@crm/notifications';
import type { RequestHeader } from '@crm/shared';
import { logger } from '../utils/logger';
import { getRequestHeader } from '../utils/request-header';
import {
  EmailEscalation,
  DealWon,
  TaskAssignment,
  BatchDigest,
} from '../templates/emails';

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
 * Perform action on notification
 */
app.post('/notifications/:id/action', async (c) => {
  const header = getRequestHeader(c);
  const id = c.req.param('id');
  const body = await c.req.json();

  const validationResult = actionRequestSchema.safeParse(body);
  if (!validationResult.success) {
    logger.error({ errors: validationResult.error.issues }, 'Invalid action request');
    return c.json({ success: false, error: 'Invalid request', details: validationResult.error.issues }, 400);
  }

  try {
    const actionService = container.resolve<ActionService>(ActionService);
    const result = await actionService.performAction(
      {
        notificationId: id,
        actionType: validationResult.data.actionType,
        actionData: validationResult.data.actionData,
      },
      header
    );

    return c.json({ success: result.success, data: result });
  } catch (error: any) {
    logger.error({ error: error.message }, 'Failed to perform action');
    return c.json({ success: false, error: error.message }, 500);
  }
});

/**
 * Perform batch action
 */
app.post('/notifications/batch-action', async (c) => {
  const header = getRequestHeader(c);
  const body = await c.req.json();

  const validationResult = batchActionRequestSchema.safeParse(body);
  if (!validationResult.success) {
    logger.error({ errors: validationResult.error.issues }, 'Invalid batch action request');
    return c.json({ success: false, error: 'Invalid request', details: validationResult.error.issues }, 400);
  }

  try {
    const actionService = container.resolve<ActionService>(ActionService);
    const result = await actionService.performBatchAction(validationResult.data, header);

    return c.json({ success: true, data: result });
  } catch (error: any) {
    logger.error({ error: error.message }, 'Failed to perform batch action');
    return c.json({ success: false, error: error.message }, 500);
  }
});

/**
 * Handle action via token (one-click from email)
 */
app.get('/actions/:actionType', async (c) => {
  const token = c.req.query('token');

  if (!token) {
    return c.json({ success: false, error: 'Token required' }, 400);
  }

  try {
    const actionService = container.resolve<ActionService>(ActionService);
    const result = await actionService.performActionViaToken(token);

    if (!result.success) {
      return c.json({ success: false, error: result.error }, 400);
    }

    // Redirect to success page or return JSON based on Accept header
    const acceptsHtml = c.req.header('Accept')?.includes('text/html');
    if (acceptsHtml) {
      return c.html(`
        <!DOCTYPE html>
        <html>
          <head><title>Action Completed</title></head>
          <body>
            <h1>Action completed successfully!</h1>
            <p>You can close this window.</p>
          </body>
        </html>
      `);
    }

    return c.json({ success: true, data: result });
  } catch (error: any) {
    logger.error({ error: error.message }, 'Failed to perform action via token');
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

export default app;
