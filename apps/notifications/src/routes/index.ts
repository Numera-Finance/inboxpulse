/**
 * Notification API routes
 *
 * Error handling: routes throw AppError subclasses (or any Error) and the
 * global app.onError handler in src/index.ts logs and returns a sanitized
 * ApiResponse. Don't add per-route try/catch unless the behavior is
 * intentionally non-default (e.g., fail-open).
 */

import { Hono } from 'hono';
import { container } from 'tsyringe';
import { render } from '@react-email/components';
import {
  PreferencesService,
  NotificationRepository,
  getTemplate,
  templateExists,
  getAllTemplates,
  getTemplateInstance,
} from '@crm/notifications';
import { getEnv } from '../env';
import {
  InvalidInputError,
  NotFoundError,
  InternalError,
  type RequestHeader,
} from '@crm/shared';
import { logger } from '../utils/logger';
import { getRequestHeader } from '../utils/request-header';
import { TaskAssignedEmail, EscalationBatchEmail } from '../templates/emails';
import { getEmailSender } from '../senders';

// Import templates to trigger registration
import '../templates';

const app = new Hono();

/**
 * Unified send notification endpoint
 * POST /api/notifications/send
 *
 * Body: {
 *   templateName: string,  // e.g., 'task.assigned'
 *   data: object,          // template-specific data
 *   recipientEmail: string // email address to send to
 * }
 */
app.post('/send', async (c) => {
  const header = getRequestHeader(c);
  const body = await c.req.json().catch(() => ({}));

  const { templateName, data, recipientEmail } = body;

  if (!templateName) throw new InvalidInputError('templateName is required');
  if (!templateExists(templateName)) throw new InvalidInputError(`Unknown template: ${templateName}`);
  if (!recipientEmail) throw new InvalidInputError('recipientEmail is required');

  const definition = getTemplate(templateName);
  if (definition?.isBatchTemplate) {
    throw new InvalidInputError('Batch templates should be triggered via cron/scheduler, not /send');
  }

  // Check user preferences - skip if user has disabled this notification
  const preferencesService = container.resolve<PreferencesService>(PreferencesService);
  const isEnabled = await preferencesService.isEnabled(header.userId, templateName, header);
  if (!isEnabled) {
    return c.json({
      success: true,
      data: {
        templateName,
        recipient: recipientEmail,
        skipped: true,
        skipReason: 'User has disabled this notification type',
      },
    });
  }

  const template = getTemplateInstance<{ send: (input: unknown, sender: unknown) => Promise<{ sent: boolean; messageId?: string; skipped?: boolean; skipReason?: string; error?: string }> }>(templateName);
  if (!template) throw new InternalError(`Template not instantiated: ${templateName}`);

  const input = {
    user: {
      userId: header.userId,
      tenantId: header.tenantId,
      email: recipientEmail,
      timezone: 'UTC',
    },
    data: data || {},
    channel: 'email' as const,
  };

  const emailSender = getEmailSender();
  const result = await template.send(input, emailSender);

  return c.json({
    success: result.sent,
    data: {
      templateName,
      recipient: recipientEmail,
      messageId: result.messageId,
      skipped: result.skipped,
      skipReason: result.skipReason,
    },
    error: result.error,
  });
});

/**
 * Get all available notification templates
 * Templates are defined in code, not in database.
 */
app.get('/templates', (c) => {
  const templates = getAllTemplates();
  return c.json({ success: true, data: { templates } });
});

/**
 * Get user preferences (legacy - redirects to /preferences/all)
 */
app.get('/preferences', async (c) => {
  const header = getRequestHeader(c);
  const preferencesService = container.resolve<PreferencesService>(PreferencesService);
  const preferences = await preferencesService.getAllPreferencesWithDefaults(header.userId, header);
  return c.json({ success: true, data: { preferences } });
});

/**
 * Update user preferences for a notification type (legacy - use PUT /preferences/by-name/:templateName instead)
 * Kept for backwards compatibility - typeId is treated as templateName
 */
app.put('/preferences/:typeId', async (c) => {
  const header = getRequestHeader(c);
  const templateName = c.req.param('typeId'); // Legacy: typeId is now templateName
  const body = await c.req.json().catch(() => ({}));

  if (!templateExists(templateName)) throw new NotFoundError('Template', templateName);

  const preferencesService = container.resolve<PreferencesService>(PreferencesService);
  const result = await preferencesService.updatePreference(header.userId, templateName, body, header);
  return c.json({ success: true, data: result });
});

/**
 * Subscribe to notification type (legacy - use PUT /preferences/by-name/:templateName instead)
 * Sets enabled: true for the given template
 */
app.post('/subscribe', async (c) => {
  const header = getRequestHeader(c);
  const body = await c.req.json().catch(() => ({}));

  const templateName = body.notificationTypeId || body.templateName;
  if (!templateName) throw new InvalidInputError('templateName or notificationTypeId is required');
  if (!templateExists(templateName)) throw new NotFoundError('Template', templateName);

  const preferencesService = container.resolve<PreferencesService>(PreferencesService);
  const result = await preferencesService.updatePreference(
    header.userId,
    templateName,
    { enabled: true },
    header
  );
  return c.json({ success: true, data: result });
});

/**
 * Unsubscribe from notification type (legacy - use PUT /preferences/by-name/:templateName instead)
 * Sets enabled: false for the given template
 */
app.post('/unsubscribe/:typeId', async (c) => {
  const header = getRequestHeader(c);
  const templateName = c.req.param('typeId');

  if (!templateExists(templateName)) throw new NotFoundError('Template', templateName);

  const preferencesService = container.resolve<PreferencesService>(PreferencesService);
  await preferencesService.updatePreference(
    header.userId,
    templateName,
    { enabled: false },
    header
  );
  return c.json({ success: true });
});

/**
 * Get user notifications
 */
app.get('/notifications', async (c) => {
  const header = getRequestHeader(c);
  const status = c.req.query('status')?.split(',');
  const limit = parseInt(c.req.query('limit') || '50');
  const offset = parseInt(c.req.query('offset') || '0');

  const notificationRepo = container.resolve<NotificationRepository>('NotificationRepository');
  const notifications = await notificationRepo.findByUser(header.userId, header, {
    status,
    limit,
    offset,
  });

  return c.json({ success: true, data: { notifications } });
});

/**
 * Get single notification
 */
app.get('/notifications/:id', async (c) => {
  const header = getRequestHeader(c);
  const id = c.req.param('id');

  const notificationRepo = container.resolve<NotificationRepository>('NotificationRepository');
  const notification = await notificationRepo.findById(id, header);

  if (!notification) throw new NotFoundError('Notification', id);
  return c.json({ success: true, data: notification });
});

/**
 * Mark notification as read
 */
app.post('/notifications/:id/read', async (c) => {
  const header = getRequestHeader(c);
  const id = c.req.param('id');

  const notificationRepo = container.resolve<NotificationRepository>('NotificationRepository');
  const result = await notificationRepo.markAsRead(id, header);

  if (!result) throw new NotFoundError('Notification', id);
  return c.json({ success: true, data: result });
});

/**
 * Unsubscribe via link (one-click from email)
 */
app.get('/unsubscribe', async (c) => {
  const notificationId = c.req.query('nid');
  const templateName = c.req.query('type');

  if (!notificationId || !templateName) {
    throw new InvalidInputError('Invalid unsubscribe link');
  }

  // Get notification to find user
  const notificationRepo = container.resolve<NotificationRepository>('NotificationRepository');
  const notification = await notificationRepo.findById(notificationId, {
    tenantId: '',
    userId: '',
    permissions: [],
  } as RequestHeader);

  if (!notification) throw new InvalidInputError('Invalid unsubscribe link');

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
});



// =============================================================================
// Send Routes (called by crm-api service)
// =============================================================================

/**
 * Send escalation-batch notification
 * POST /api/notifications/send/escalation-batch
 *
 * Body: {
 *   escalations: [{ id, customer, subject, dateOpened, assignedTo, accountOwner, detailsUrl }],
 *   metrics: { new, open1Day, open3Days, openMoreThan3Days },
 *   recipientName?: string,
 *   recipientEmail: string
 * }
 */
app.post('/send/escalation-batch', async (c) => {
  const body = await c.req.json().catch(() => ({}));

  const { escalations, metrics, recipientName, recipientEmail } = body;

  if (!escalations || !Array.isArray(escalations)) throw new InvalidInputError('escalations array is required');
  if (!metrics) throw new InvalidInputError('metrics object is required');
  if (!recipientEmail) throw new InvalidInputError('recipientEmail is required');

  const html = await render(
    EscalationBatchEmail({
      escalations,
      metrics,
      recipientName: recipientName || 'Team',
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

  logger.info(
    { recipient: recipientEmail, escalationCount: escalations.length, sent: result.sent },
    'Sent escalation-batch notification'
  );

  return c.json({
    success: result.sent,
    data: {
      template: 'escalation-batch',
      recipient: recipientEmail,
      subject,
      messageId: result.messageId,
      escalationCount: escalations.length,
    },
    error: result.error,
  });
});

// =============================================================================
// Simulation Routes (for testing - caller must provide all data)
// =============================================================================

/**
 * Simulate task-assigned notification
 * POST /api/notifications/simulate/task-assigned
 *
 * Body: {
 *   task: { id, customer, subject, dateOpened, assignedTo, assignedBy?, accountOwner, detailsUrl },
 *   recipientName: string,
 *   recipientEmail: string
 * }
 *
 * Sends to recipientEmail. EMAIL_BCC env var BCCs the configured monitor list.
 */
app.post('/simulate/task-assigned', async (c) => {
  const body = await c.req.json().catch(() => ({}));

  const { task, recipientName, recipientEmail } = body;

  if (!task) throw new InvalidInputError('task object is required');
  if (!recipientEmail) throw new InvalidInputError('recipientEmail is required');

  const requiredFields = ['id', 'customer', 'subject', 'dateOpened', 'assignedTo', 'accountOwner', 'detailsUrl'];
  const missingFields = requiredFields.filter(f => !task[f]);
  if (missingFields.length > 0) {
    throw new InvalidInputError(`Missing task fields: ${missingFields.join(', ')}`);
  }

  const html = await render(
    TaskAssignedEmail({
      task,
      recipientName: recipientName || 'Team',
    })
  );

  const subject = `New Escalation: ${task.customer} - ${task.subject.substring(0, 50)}${task.subject.length > 50 ? '...' : ''}`;

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
    },
    error: result.error,
  });
});

/**
 * Simulate escalation-batch notification
 * POST /api/notifications/simulate/escalation-batch
 *
 * Body: {
 *   escalations: [{ id, customer, subject, dateOpened, assignedTo, accountOwner, detailsUrl }],
 *   metrics: { new, open1Day, open3Days, openMoreThan3Days },
 *   recipientName?: string,
 *   recipientEmail: string
 * }
 *
 * Sends to recipientEmail. EMAIL_BCC env var BCCs the configured monitor list.
 */
app.post('/simulate/escalation-batch', async (c) => {
  const body = await c.req.json().catch(() => ({}));

  const { escalations, metrics, recipientName, recipientEmail } = body;

  if (!escalations || !Array.isArray(escalations)) throw new InvalidInputError('escalations array is required');
  if (!metrics) throw new InvalidInputError('metrics object is required');
  if (!recipientEmail) throw new InvalidInputError('recipientEmail is required');

  const requiredMetrics = ['new', 'open1Day', 'open3Days', 'openMoreThan3Days'];
  const missingMetrics = requiredMetrics.filter(m => metrics[m] === undefined);
  if (missingMetrics.length > 0) {
    throw new InvalidInputError(`Missing metrics fields: ${missingMetrics.join(', ')}`);
  }

  const html = await render(
    EscalationBatchEmail({
      escalations,
      metrics,
      recipientName: recipientName || 'Team',
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
      escalationCount: escalations.length,
    },
    error: result.error,
  });
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
  const preferencesService = container.resolve<PreferencesService>(PreferencesService);
  const preferences = await preferencesService.getAllPreferencesWithDefaults(header.userId, header);
  return c.json({ success: true, data: { preferences } });
});

/**
 * Get user's preference for a template by name
 * GET /api/notifications/preferences/by-name/:templateName
 */
app.get('/preferences/by-name/:templateName', async (c) => {
  const header = getRequestHeader(c);
  const templateName = c.req.param('templateName');

  const template = getTemplate(templateName);
  if (!template) throw new NotFoundError('Template', templateName);

  const preferencesService = container.resolve<PreferencesService>(PreferencesService);
  const preference = await preferencesService.getPreference(header.userId, templateName, header);

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

  if (!templateExists(templateName)) throw new NotFoundError('Template', templateName);

  const preferencesService = container.resolve<PreferencesService>(PreferencesService);
  const result = await preferencesService.updatePreference(header.userId, templateName, body, header);
  return c.json({ success: true, data: result });
});

/**
 * Delete user's preference (revert to defaults)
 * DELETE /api/notifications/preferences/by-name/:templateName
 */
app.delete('/preferences/by-name/:templateName', async (c) => {
  const header = getRequestHeader(c);
  const templateName = c.req.param('templateName');

  if (!templateExists(templateName)) throw new NotFoundError('Template', templateName);

  const preferencesService = container.resolve<PreferencesService>(PreferencesService);
  await preferencesService.deletePreference(header.userId, templateName, header);
  return c.json({ success: true });
});

/**
 * Check if a template is enabled for a specific user
 * GET /api/notifications/preferences/by-name/:templateName/user/:userId
 *
 * Used by API service to check if user wants to receive a notification.
 * Fail-open by design: if anything goes wrong, default to enabled so legitimate
 * notifications aren't silently dropped because of a transient lookup failure.
 * Keeps its own try/catch to preserve that contract.
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
  } catch (error) {
    logger.error({ error, templateName, userId }, 'Failed to check preference (fail-open)');
    return c.json({ success: true, data: { enabled: true } });
  }
});

/**
 * List available notification endpoints
 * GET /api/notifications/simulate
 */
app.get('/simulate', (c) => {
  return c.json({
    success: true,
    data: {
      emailBcc: getEnv().EMAIL_BCC || null,
      endpoints: [
        {
          method: 'POST',
          path: '/api/notifications/simulate/task-assigned',
          description: 'Send a task assignment notification (all fields required)',
          requiredBody: {
            task: {
              id: 'string (required)',
              customer: 'string (required)',
              subject: 'string (required)',
              dateOpened: 'string (required)',
              assignedTo: 'string (required)',
              assignedBy: 'string (optional)',
              accountOwner: 'string (required)',
              detailsUrl: 'string (required)',
            },
            recipientName: 'string (optional, defaults to "Team")',
            recipientEmail: 'string (required)',
          },
        },
        {
          method: 'POST',
          path: '/api/notifications/simulate/escalation-batch',
          description: 'Send an escalation batch summary email (all fields required)',
          requiredBody: {
            escalations: '[{ id, customer, subject, dateOpened, assignedTo, accountOwner, detailsUrl }] (required)',
            metrics: '{ new, open1Day, open3Days, openMoreThan3Days } (required)',
            recipientName: 'string (optional, defaults to "Team")',
            recipientEmail: 'string (required)',
          },
        },
      ],
      note: 'EMAIL_BCC (comma-separated) silently BCCs every outbound email so production delivery can be monitored.',
    },
  });
});

export default app;
