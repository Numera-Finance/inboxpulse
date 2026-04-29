/**
 * Notification API routes
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
import type { RequestHeader } from '@crm/shared';
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

  if (!templateName) {
    return c.json({ success: false, error: 'templateName is required' }, 400);
  }

  if (!templateExists(templateName)) {
    return c.json({ success: false, error: `Unknown template: ${templateName}` }, 400);
  }

  if (!recipientEmail) {
    return c.json({ success: false, error: 'recipientEmail is required' }, 400);
  }

  try {
    // Check if it's a batch template (not supported via this endpoint)
    const definition = getTemplate(templateName);
    if (definition?.isBatchTemplate) {
      return c.json({
        success: false,
        error: 'Batch templates should be triggered via cron/scheduler, not /send'
      }, 400);
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

    // Get template instance
    const template = getTemplateInstance<{ send: (input: unknown, sender: unknown) => Promise<{ sent: boolean; messageId?: string; skipped?: boolean; skipReason?: string; error?: string }> }>(templateName);
    if (!template) {
      return c.json({ success: false, error: `Template not instantiated: ${templateName}` }, 500);
    }

    // Build input for immediate template
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

    // Send via template
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
  } catch (error: any) {
    logger.error({ error, templateName }, 'Failed to send notification');
    return c.json({ success: false, error: error.message }, 500);
  }
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

  try {
    const preferencesService = container.resolve<PreferencesService>(PreferencesService);
    const preferences = await preferencesService.getAllPreferencesWithDefaults(header.userId, header);

    return c.json({ success: true, data: { preferences } });
  } catch (error: any) {
    logger.error({ error }, 'Failed to get user preferences');
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
    logger.error({ error }, 'Failed to update preferences');
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
    logger.error({ error }, 'Failed to subscribe');
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
    logger.error({ error }, 'Failed to unsubscribe');
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
    logger.error({ error }, 'Failed to get notifications');
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
    logger.error({ error }, 'Failed to get notification');
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
    logger.error({ error }, 'Failed to mark notification as read');
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
    logger.error({ error }, 'Failed to unsubscribe');
    return c.json({ success: false, error: error.message }, 500);
  }
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
  } catch (error: any) {
    logger.error({ error }, 'Failed to send escalation-batch notification');
    return c.json({ success: false, error: error.message }, 500);
  }
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
 * Uses EMAIL_OVERRIDE env var if set, otherwise sends to recipientEmail.
 */
app.post('/simulate/task-assigned', async (c) => {
  const body = await c.req.json().catch(() => ({}));

  const { task, recipientName, recipientEmail } = body;

  if (!task) {
    return c.json({ success: false, error: 'task object is required' }, 400);
  }
  if (!recipientEmail) {
    return c.json({ success: false, error: 'recipientEmail is required' }, 400);
  }

  const requiredFields = ['id', 'customer', 'subject', 'dateOpened', 'assignedTo', 'accountOwner', 'detailsUrl'];
  const missingFields = requiredFields.filter(f => !task[f]);
  if (missingFields.length > 0) {
    return c.json({ success: false, error: `Missing task fields: ${missingFields.join(', ')}` }, 400);
  }

  try {
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
  } catch (error: any) {
    logger.error({ error }, 'Failed to simulate task-assigned notification');
    return c.json({ success: false, error: error.message }, 500);
  }
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
 * Uses EMAIL_OVERRIDE env var if set, otherwise sends to recipientEmail.
 */
app.post('/simulate/escalation-batch', async (c) => {
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

  const requiredMetrics = ['new', 'open1Day', 'open3Days', 'openMoreThan3Days'];
  const missingMetrics = requiredMetrics.filter(m => metrics[m] === undefined);
  if (missingMetrics.length > 0) {
    return c.json({ success: false, error: `Missing metrics fields: ${missingMetrics.join(', ')}` }, 400);
  }

  try {
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
  } catch (error: any) {
    logger.error({ error }, 'Failed to simulate escalation-batch notification');
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
    logger.error({ error }, 'Failed to get all preferences');
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
    logger.error({ error, templateName }, 'Failed to get preference');
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
    logger.error({ error, templateName }, 'Failed to update preference');
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
    logger.error({ error, templateName }, 'Failed to delete preference');
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
    logger.error({ error, templateName, userId }, 'Failed to check preference');
    // Fail-open: if we can't check, default to enabled
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
      emailOverride: getEnv().EMAIL_OVERRIDE || null,
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
      note: 'If EMAIL_OVERRIDE is set (comma-separated), only those recipients receive emails. Others are redirected to the first address.',
    },
  });
});

export default app;
