/**
 * Inngest functions for notification processing
 *
 * These functions handle:
 * - Immediate notification sending
 * - Batch processing
 * - Retry logic
 * - Subscription refresh
 */

import type { Inngest } from 'inngest';
import type { Database } from '@crm/database';
import type { RequestHeader } from '@crm/shared';
import type { DeliveryService } from '../services/delivery-service';
import type { PreferencesService } from '../services/preferences-service';
import type { Notification } from '../types/core';

/**
 * Event types for notification processing
 */
export interface NotificationEvents {
  'notification/send': {
    data: {
      notificationId: string;
      tenantId: string;
      userId: string;
      requestId?: string;
    };
  };
  'notification/send.batch': {
    data: {
      batchId: string;
      tenantId: string;
      requestId?: string;
    };
  };
  'notification/fan-out': {
    data: {
      notificationType: string;
      tenantId: string;
      data: Record<string, unknown>;
      userIds?: string[];
      idempotencyKey?: string;
      requestId?: string;
    };
  };
  'notification/refresh-subscriptions': {
    data: {
      notificationTypeId: string;
      tenantId: string;
      requestId?: string;
    };
  };
}

export interface InngestFunctionDeps {
  db: Database;
  deliveryService: DeliveryService;
  preferencesService: PreferencesService;
  notificationRepo: any;
  batchRepo: any;
}

/**
 * Create all notification Inngest functions
 */
export function createNotificationFunctions(
  inngest: Inngest<{ id: string }>,
  getDeps: () => Promise<InngestFunctionDeps>
) {
  /**
   * Process pending notifications (cron)
   * Runs every minute to send scheduled notifications
   */
  const processPendingNotifications = inngest.createFunction(
    {
      id: 'notifications/process-pending',
      retries: 3,
    },
    { cron: '* * * * *' }, // Every minute
    async ({ step, logger }) => {
      const deps = await getDeps();
      const now = new Date();

      // Fetch pending notifications ready to send
      const notifications = await step.run('fetch-pending', async () => {
        return deps.notificationRepo.findPendingForSending(now);
      });

      if (notifications.length === 0) {
        return { processed: 0 };
      }

      logger.info({ count: notifications.length }, 'Processing pending notifications');

      // Process in batches of 10
      const batchSize = 10;
      let processed = 0;
      let failed = 0;

      for (let i = 0; i < notifications.length; i += batchSize) {
        const batch = notifications.slice(i, i + batchSize);

        const results = await step.run(`process-batch-${i}`, async () => {
          const batchResults = await Promise.all(
            batch.map(async (notification: Notification) => {
              const header: RequestHeader = {
                tenantId: notification.tenantId,
                userId: notification.userId,
                permissions: [],
              };

              try {
                const result = await deps.deliveryService.deliverNotification(
                  notification,
                  header
                );
                return { success: result.success, id: notification.id };
              } catch (error: any) {
                logger.error(
                  { error: error.message, notificationId: notification.id },
                  'Failed to deliver notification'
                );
                return { success: false, id: notification.id, error: error.message };
              }
            })
          );
          return batchResults;
        });

        processed += results.filter((r: any) => r.success).length;
        failed += results.filter((r: any) => !r.success).length;
      }

      return { processed, failed, total: notifications.length };
    }
  );

  /**
   * Send a single notification immediately
   * Triggered by notification/send event
   */
  const sendNotification = inngest.createFunction(
    {
      id: 'notifications/send',
      retries: 3,
      concurrency: {
        limit: 50, // Max concurrent sends
      },
    },
    { event: 'notification/send' },
    async ({ event, step, logger }) => {
      const { notificationId, tenantId, userId, requestId } = event.data;
      const deps = await getDeps();

      const header: RequestHeader = {
        tenantId,
        userId,
        permissions: [],
      };

      // Fetch notification
      const notification = await step.run('fetch-notification', async () => {
        return deps.notificationRepo.findById(notificationId, header);
      });

      if (!notification) {
        logger.warn({ notificationId }, 'Notification not found');
        return { success: false, error: 'Notification not found' };
      }

      // Deliver
      const result = await step.run('deliver', async () => {
        return deps.deliveryService.deliverNotification(notification, header);
      });

      logger.info(
        { notificationId, success: result.success, channel: result.channel },
        'Notification delivery completed'
      );

      return result;
    }
  );

  /**
   * Process a batch of notifications
   * Aggregates notifications and sends as digest
   */
  const processBatch = inngest.createFunction(
    {
      id: 'notifications/process-batch',
      retries: 2,
    },
    { event: 'notification/send.batch' },
    async ({ event, step, logger }) => {
      const { batchId, tenantId, requestId } = event.data;
      const deps = await getDeps();

      const header: RequestHeader = {
        tenantId,
        userId: 'system',
        permissions: [],
      };

      // Fetch batch with notifications
      const batch = await step.run('fetch-batch', async () => {
        return deps.batchRepo.findById(batchId, header);
      });

      if (!batch) {
        logger.warn({ batchId }, 'Batch not found');
        return { success: false, error: 'Batch not found' };
      }

      // Get all notifications in this batch
      const notifications = await step.run('fetch-batch-notifications', async () => {
        return deps.notificationRepo.findByBatchId(batchId, header);
      });

      if (notifications.length === 0) {
        logger.info({ batchId }, 'No notifications in batch');
        return { success: true, count: 0 };
      }

      // Aggregate content
      const aggregatedContent = await step.run('aggregate-content', async () => {
        // Build digest from notifications
        return {
          title: `You have ${notifications.length} notifications`,
          summary: `Digest of ${notifications.length} notifications`,
          items: notifications.map((n: Notification) => ({
            notificationId: n.id,
            title: n.title,
            summary: n.body,
            metadata: n.metadata,
          })),
        };
      });

      // Update batch with aggregated content
      await step.run('update-batch', async () => {
        return deps.batchRepo.update(
          batchId,
          {
            aggregatedContent,
            status: 'processing',
          },
          header
        );
      });

      // Send batch notification
      // This would render a digest template and send via channel
      const result = await step.run('send-digest', async () => {
        // Create a synthetic notification for the digest
        const digestNotification: Notification = {
          id: batchId,
          tenantId: batch.tenantId,
          userId: batch.userId,
          notificationTypeId: batch.notificationTypeId,
          title: aggregatedContent.title,
          body: aggregatedContent.summary,
          metadata: { items: aggregatedContent.items },
          status: 'pending',
          priority: 'normal',
          channel: batch.channel,
          deliveryAttempts: [],
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        return deps.deliveryService.deliverNotification(digestNotification, header);
      });

      // Update batch status
      await step.run('finalize-batch', async () => {
        return deps.batchRepo.update(
          batchId,
          {
            status: result.success ? 'sent' : 'failed',
            sentAt: result.success ? new Date() : null,
          },
          header
        );
      });

      // Update individual notifications
      if (result.success) {
        await step.run('update-notifications', async () => {
          for (const notification of notifications) {
            await deps.notificationRepo.update(
              notification.id,
              { status: 'sent', sentAt: new Date() },
              header
            );
          }
        });
      }

      logger.info(
        { batchId, success: result.success, count: notifications.length },
        'Batch processing completed'
      );

      return { success: result.success, count: notifications.length };
    }
  );

  /**
   * Process pending batches (cron)
   * Runs every 5 minutes to find and process ready batches
   */
  const processPendingBatches = inngest.createFunction(
    {
      id: 'notifications/process-pending-batches',
      retries: 2,
    },
    { cron: '*/5 * * * *' }, // Every 5 minutes
    async ({ step, logger }) => {
      const deps = await getDeps();
      const now = new Date();

      // Find batches ready to send
      const batches = await step.run('fetch-pending-batches', async () => {
        return deps.batchRepo.findPendingBatches(now);
      });

      if (batches.length === 0) {
        return { processed: 0 };
      }

      logger.info({ count: batches.length }, 'Processing pending batches');

      // Trigger batch processing for each
      for (const batch of batches) {
        await step.sendEvent('trigger-batch', {
          name: 'notification/send.batch',
          data: {
            batchId: batch.id,
            tenantId: batch.tenantId,
          },
        });
      }

      return { triggered: batches.length };
    }
  );

  /**
   * Refresh auto-subscriptions for a notification type
   */
  const refreshSubscriptions = inngest.createFunction(
    {
      id: 'notifications/refresh-subscriptions',
      retries: 2,
    },
    { event: 'notification/refresh-subscriptions' },
    async ({ event, step, logger }) => {
      const { notificationTypeId, tenantId, requestId } = event.data;
      const deps = await getDeps();

      const header: RequestHeader = {
        tenantId,
        userId: 'system',
        permissions: [],
      };

      const result = await step.run('refresh', async () => {
        return deps.preferencesService.refreshAutoSubscriptions(notificationTypeId, header);
      });

      logger.info(
        { notificationTypeId, subscribed: result.subscribed, unsubscribed: result.unsubscribed },
        'Subscription refresh completed'
      );

      return result;
    }
  );

  return {
    processPendingNotifications,
    sendNotification,
    processBatch,
    processPendingBatches,
    refreshSubscriptions,
  };
}

/**
 * Get all function instances for registration
 */
export function getNotificationFunctions(
  inngest: Inngest<{ id: string }>,
  getDeps: () => Promise<InngestFunctionDeps>
) {
  const functions = createNotificationFunctions(inngest, getDeps);
  return Object.values(functions);
}
