import { Inngest } from 'inngest';
import { container } from 'tsyringe';
import { sql, eq, and, gte, lt } from 'drizzle-orm';
import { format } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import { TaskRepository } from '../repository';
import { UserRepository } from '../../users/repository';
import { TenantRepository } from '../../tenants/repository';
import { tasks, TaskStatus } from '../schema';
import { customers } from '../../customers/schema';
import { users } from '../../users/schema';
import type { Database } from '@crm/database';
import { logger } from '../../utils/logger';

interface EscalationMetrics {
  new: number;
  open1Day: number;
  open3Days: number;
  openMoreThan3Days: number;
}

interface EscalationItem {
  id: string;
  customer: string;
  subject: string;
  dateOpened: string;
  assignedTo: string;
  accountOwner: string;
  detailsUrl: string;
}

interface ManagerEscalationData {
  manager: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    timezone: string | null;
  };
  escalations: EscalationItem[];
  metrics: EscalationMetrics;
}

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

      // Get all active tenants
      const tenants = await step.run('get-tenants', async () => {
        return tenantRepository.findAll();
      });

      const results: { tenantId: string; notificationsSent: number }[] = [];

      for (const tenant of tenants) {
        const result = await step.run(`process-tenant-${tenant.id}`, async () => {
          return processEscalationsForTenant(tenant.id);
        });
        results.push({ tenantId: tenant.id, notificationsSent: result });
      }

      return {
        tenantsProcessed: tenants.length,
        results,
      };
    }
  );
};

/**
 * Process escalations for a single tenant.
 * Returns the number of notifications sent.
 */
async function processEscalationsForTenant(tenantId: string): Promise<number> {
  const db = container.resolve<Database>('Database');
  const userRepository = container.resolve(UserRepository);

  const now = new Date();

  // Get all open escalation tasks (created by system, status = OPEN)
  const escalationTasks = await db
    .select({
      task: tasks,
      customerName: customers.name,
      assignedToFirstName: users.firstName,
      assignedToLastName: users.lastName,
    })
    .from(tasks)
    .innerJoin(customers, eq(tasks.customerId, customers.id))
    .leftJoin(users, eq(tasks.assignedToId, users.id))
    .where(
      and(
        eq(tasks.tenantId, tenantId),
        eq(tasks.status, TaskStatus.OPEN),
        eq(tasks.createdBySystem, true)
      )
    );

  if (escalationTasks.length === 0) {
    logger.debug({ tenantId }, 'No open escalations found');
    return 0;
  }

  // Calculate date boundaries for metrics
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);

  const yesterdayStart = new Date(todayStart);
  yesterdayStart.setDate(yesterdayStart.getDate() - 1);

  const threeDaysAgoStart = new Date(todayStart);
  threeDaysAgoStart.setDate(threeDaysAgoStart.getDate() - 3);

  // Calculate metrics (no duplicates - mutually exclusive categories)
  const metrics: EscalationMetrics = {
    new: 0, // Created today
    open1Day: 0, // Created yesterday
    open3Days: 0, // Created 2-3 days ago
    openMoreThan3Days: 0, // Created more than 3 days ago
  };

  for (const { task } of escalationTasks) {
    const createdAt = new Date(task.createdAt);
    if (createdAt >= todayStart) {
      metrics.new++;
    } else if (createdAt >= yesterdayStart) {
      metrics.open1Day++;
    } else if (createdAt >= threeDaysAgoStart) {
      metrics.open3Days++;
    } else {
      metrics.openMoreThan3Days++;
    }
  }

  // Group tasks by customer and collect managers
  const customerIds = [...new Set(escalationTasks.map(t => t.task.customerId))];
  const managerEscalationMap = new Map<string, ManagerEscalationData>();

  for (const customerId of customerIds) {
    // Get all managers in the hierarchy for this customer
    const managers = await userRepository.getAllManagersForCustomer(customerId);

    // Get account owner
    const accountOwner = await userRepository.getAccountOwner(customerId);
    const accountOwnerName = accountOwner
      ? `${accountOwner.firstName} ${accountOwner.lastName}`
      : 'Not assigned';

    // Get tasks for this customer
    const customerTasks = escalationTasks.filter(t => t.task.customerId === customerId);

    for (const manager of managers) {
      if (!managerEscalationMap.has(manager.id)) {
        managerEscalationMap.set(manager.id, {
          manager: {
            id: manager.id,
            email: manager.email,
            firstName: manager.firstName,
            lastName: manager.lastName,
            timezone: manager.timezone,
          },
          escalations: [],
          metrics: { ...metrics }, // Copy metrics for each manager
        });
      }

      const managerData = managerEscalationMap.get(manager.id)!;

      // Add escalations for this customer
      for (const { task, customerName, assignedToFirstName, assignedToLastName } of customerTasks) {
        const assignedToName = assignedToFirstName && assignedToLastName
          ? `${assignedToFirstName} ${assignedToLastName}`
          : 'Unassigned';

        managerData.escalations.push({
          id: task.id,
          customer: customerName || 'Unknown Customer',
          subject: task.title,
          dateOpened: format(new Date(task.createdAt), 'MMM d, yyyy'),
          assignedTo: assignedToName,
          accountOwner: accountOwnerName,
          detailsUrl: `${process.env.APP_URL || 'http://localhost:3000'}/tasks/${task.id}`,
        });
      }
    }
  }

  // Check notification preferences and send emails
  let notificationsSent = 0;

  for (const [managerId, data] of managerEscalationMap) {
    // TODO: Check notification preferences from notifications service
    // For now, we'll use a default of daily at 8am

    const timezone = data.manager.timezone || 'Asia/Kolkata';
    const managerLocalTime = toZonedTime(now, timezone);
    const currentHour = managerLocalTime.getHours();

    // Default: daily at 8am local time
    // TODO: Read from user notification preferences
    const shouldSend = currentHour === 8;

    if (shouldSend && data.escalations.length > 0) {
      try {
        // Send notification via notifications service
        const response = await fetch(`${process.env.NOTIFICATIONS_SERVICE_URL || 'http://localhost:4004'}/api/send`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-tenant-id': tenantId,
          },
          body: JSON.stringify({
            template: 'escalation-batch',
            channel: 'email',
            recipient: {
              userId: managerId,
              email: data.manager.email,
              name: `${data.manager.firstName} ${data.manager.lastName}`,
            },
            data: {
              recipientName: data.manager.firstName,
              escalations: data.escalations,
              metrics: data.metrics,
            },
          }),
        });

        if (response.ok) {
          notificationsSent++;
          logger.info(
            { managerId, escalationCount: data.escalations.length },
            'Sent escalation batch notification'
          );
        } else {
          logger.error(
            { managerId, status: response.status },
            'Failed to send escalation notification'
          );
        }
      } catch (error) {
        logger.error({ managerId, error }, 'Error sending escalation notification');
      }
    }
  }

  return notificationsSent;
}
