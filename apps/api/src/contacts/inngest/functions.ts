import { Inngest } from 'inngest';
import { container } from 'tsyringe';
import { TaskService } from '../../tasks/service';
import { logger } from '../../utils/logger';

/**
 * Creates escalation tasks for emails that a manual customer assignment made
 * visible.
 *
 * These emails resolved to no customer at analysis time, so
 * `maybeCreateTaskForNegativeEmail` skipped them with
 * SKIP_TASK_CREATION_NO_CUSTOMER and they never appeared on the AI Analysis
 * page. Assigning the sender re-links them, and this backfills the tasks.
 *
 * Runs in the background rather than in the assignment request: claiming a busy
 * domain can surface hundreds of eligible emails, and each one inserts a task,
 * auto-assigns it and sends a notification. Inline, that would exceed the Cloud
 * Run request timeout long after the reassignment transaction had committed —
 * the user would see a failure for work that had actually succeeded.
 *
 * `createFromEmail` is idempotent per email (it returns the existing task if
 * there is one), so a retry cannot double-create.
 *
 * Triggered by 'contact/customer.assigned' from ContactService.assignCustomer.
 */
export const createRetroactiveEscalationsFunction = (inngest: Inngest) => {
  return inngest.createFunction(
    {
      id: 'create-retroactive-escalations',
      name: 'Create Retroactive Escalation Tasks',
      // One assignment at a time per tenant. The work is notification-heavy,
      // and a user correcting several senders in a row should not fan out into
      // concurrent bursts against the same assignees.
      concurrency: {
        key: 'event.data.tenantId',
        limit: 1,
      },
      retries: 3,
    },
    { event: 'contact/customer.assigned' },
    async ({ event, step }) => {
      const { tenantId, customerId, emails } = event.data as {
        tenantId: string;
        customerId: string;
        emails: Array<{ id: string; subject: string | null }>;
      };

      return await step.run('create-tasks', async () => {
        const taskService = container.resolve(TaskService);
        let created = 0;
        let failed = 0;

        for (const email of emails) {
          try {
            await taskService.createFromEmail(
              tenantId,
              customerId,
              email.id,
              email.subject || 'Negative sentiment email'
            );
            created++;
          } catch (error: unknown) {
            // One bad email must not strand the rest of the batch. The step
            // still succeeds, so Inngest will not retry the whole batch for a
            // failure that is specific to one email.
            failed++;
            const message = error instanceof Error ? error.message : String(error);
            logger.warn(
              { tenantId, customerId, emailId: email.id, error: message, logType: 'RETRO_TASK_CREATE_FAILED' },
              'Failed to create retroactive escalation task'
            );
          }
        }

        logger.info(
          { tenantId, customerId, requested: emails.length, created, failed, logType: 'RETRO_TASKS_COMPLETE' },
          'Created retroactive escalation tasks'
        );

        return { created, failed };
      });
    }
  );
};
