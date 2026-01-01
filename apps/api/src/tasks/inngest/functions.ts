import { Inngest } from 'inngest';
import { container } from 'tsyringe';
import { TaskService } from '../service';
import { TenantRepository } from '../../tenants/repository';
import { logger } from '../../utils/logger';

/**
 * Creates the Inngest cron function to send escalation batch notifications.
 * Runs every hour and checks if it's the right time to send notifications
 * based on each user's timezone and notification preferences.
 */
export const createEscalationNotificationCronFunction = (inngest: Inngest) => {
  return inngest.createFunction(
    {
      id: 'escalation-notification-cron',
      name: 'Escalation Notification Cron',
      retries: 2,
    },
    { cron: '0 * * * *' }, // Run every hour at minute 0
    async ({ step }) => {
      const tenantRepository = container.resolve(TenantRepository);
      const taskService = container.resolve(TaskService);

      // Get all active tenants
      const tenants = await step.run('get-tenants', async () => {
        return tenantRepository.findAll();
      });

      const results: { tenantId: string; notificationsSent: number }[] = [];

      for (const tenant of tenants) {
        const notificationsSent = await step.run(`process-tenant-${tenant.id}`, async () => {
          // Get escalation data grouped by manager
          const managerEscalationMap = await taskService.getEscalationDataForTenant(tenant.id);

          if (managerEscalationMap.size === 0) {
            return 0;
          }

          let sentCount = 0;

          // Check each manager and send if it's the right time
          for (const [managerId, data] of managerEscalationMap) {
            const shouldSend = taskService.shouldSendNotification(data.manager.timezone);

            if (shouldSend && data.escalations.length > 0) {
              const success = await taskService.sendEscalationNotification(tenant.id, data);
              if (success) {
                sentCount++;
              }
            }
          }

          return sentCount;
        });

        results.push({ tenantId: tenant.id, notificationsSent });
      }

      logger.info(
        { tenantsProcessed: tenants.length, results },
        'Completed escalation notification cron'
      );

      return {
        tenantsProcessed: tenants.length,
        results,
      };
    }
  );
};
