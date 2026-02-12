import { Inngest } from 'inngest';
import { container } from 'tsyringe';
import { TaskService } from '../service';
import { TenantRepository } from '../../tenants/repository';
import { logger } from '../../utils/logger';

/**
 * Creates the Inngest cron function to send escalation batch notifications.
 * Runs every hour and checks if it's the right time to send notifications
 * based on each user's timezone and notification preferences.
 *
 * Processing flow:
 * 1. Fetch all tenants
 * 2. Process all tenants in parallel (batch DB queries per tenant)
 * 3. Send notifications in parallel per manager
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

      // Step 1: Get all active tenants
      const tenants = await step.run('get-tenants', async () => {
        return tenantRepository.findAll();
      });

      // Step 2: Process all tenants in parallel — each tenant does batched DB queries
      // and sends notifications concurrently
      const results = await step.run('process-all-tenants', async () => {
        const tenantResults = await Promise.all(
          tenants.map(async (tenant) => {
            try {
              // getEscalationDataForTenant now uses batch queries (2 queries total)
              const managerEscalationMap = await taskService.getEscalationDataForTenant(tenant.id);

              if (managerEscalationMap.size === 0) {
                logger.info({ tenantId: tenant.id }, 'No managers with escalations found for tenant');
                return { tenantId: tenant.id, notificationsSent: 0 };
              }

              logger.info(
                {
                  tenantId: tenant.id,
                  managersWithEscalations: managerEscalationMap.size,
                  managers: [...managerEscalationMap.values()].map(d => ({
                    email: d.manager.email,
                    timezone: d.manager.timezone,
                    escalationCount: d.escalations.length,
                  })),
                },
                'Checking timezone filter for managers'
              );

              // TEMP: Limit to specific test recipients
              const testRecipients = ['mbalsara@mystartupcfo.com', 'vmohan@mystartupcfo.com'];
              // Filter managers: must have escalations, be a test recipient, and be in their notification window (8am local)
              const managersToNotify = [...managerEscalationMap.entries()].filter(
                ([, data]) =>
                  data.escalations.length > 0 &&
                  testRecipients.includes(data.manager.email) &&
                  taskService.shouldSendNotification(data.manager.timezone)
              );

              if (managersToNotify.length === 0) {
                logger.info(
                  {
                    tenantId: tenant.id,
                    currentUtcHour: new Date().getUTCHours(),
                  },
                  'No matching managers to notify'
                );
                return { tenantId: tenant.id, notificationsSent: 0 };
              }

              // Send all notifications for this tenant in parallel
              const sendResults = await Promise.all(
                managersToNotify.map(([, data]) =>
                  taskService.sendEscalationNotification(tenant.id, data)
                )
              );

              const notificationsSent = sendResults.filter(Boolean).length;
              return { tenantId: tenant.id, notificationsSent };
            } catch (error) {
              logger.error(
                { tenantId: tenant.id, error },
                'Failed to process tenant escalations'
              );
              return { tenantId: tenant.id, notificationsSent: 0 };
            }
          })
        );

        return tenantResults;
      });

      const totalSent = results.reduce((sum, r) => sum + r.notificationsSent, 0);
      logger.info(
        { tenantsProcessed: tenants.length, totalNotificationsSent: totalSent, results },
        'Completed escalation notification cron'
      );

      return {
        tenantsProcessed: tenants.length,
        totalNotificationsSent: totalSent,
        results,
      };
    }
  );
};
