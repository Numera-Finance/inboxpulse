import { injectable, inject } from 'tsyringe';
import type { Database } from '@crm/database';
import type { NewEmailThread } from './schema';
import { emailThreads } from './schema';
import { eq, and } from 'drizzle-orm';
import { logger } from '../utils/logger';

@injectable()
export class EmailThreadRepository {
  constructor(@inject('Database') private db: Database) {}

  /**
   * Upsert thread (insert or update if exists)
   * Returns the thread ID
   */
  async upsertThread(threadData: NewEmailThread): Promise<string> {
    try {
      const result = await this.db
        .insert(emailThreads)
        .values(threadData)
        .onConflictDoUpdate({
          target: [emailThreads.tenantId, emailThreads.integrationId, emailThreads.providerThreadId],
          set: {
            subject: threadData.subject,
            lastMessageAt: threadData.lastMessageAt,
            metadata: threadData.metadata,
            updatedAt: new Date(),
          },
        })
        .returning({ id: emailThreads.id });

      return result[0].id;
    } catch (error: any) {
      logger.error({
        error: {
          message: error.message,
          stack: error.stack,
          name: error.name,
          code: error.code,
        },
        threadData: {
          tenantId: threadData.tenantId,
          integrationId: threadData.integrationId,
          providerThreadId: threadData.providerThreadId,
        },
      }, 'Failed to upsert email thread');
      throw error;
    }
  }

  /**
   * Find thread by provider thread ID and integration ID
   */
  /**
   * Resolve a DB thread id from just the tenant + provider (Gmail) thread id,
   * without knowing the integration. Used by the add-on, which only has the open
   * thread's Gmail id from the event — so it can show thread-level trend/flagged
   * even when the open message itself isn't a tracked customer email.
   */
  async findIdByProviderThreadId(
    tenantId: string,
    providerThreadId: string
  ): Promise<{ id: string } | null> {
    const result = await this.db
      .select({ id: emailThreads.id })
      .from(emailThreads)
      .where(
        and(
          eq(emailThreads.tenantId, tenantId),
          eq(emailThreads.providerThreadId, providerThreadId)
        )
      )
      .limit(1);
    return result[0] || null;
  }

  async findByProviderThreadId(
    tenantId: string,
    integrationId: string,
    providerThreadId: string
  ): Promise<{ id: string } | null> {
    const result = await this.db
      .select({ id: emailThreads.id })
      .from(emailThreads)
      .where(
        and(
          eq(emailThreads.tenantId, tenantId),
          eq(emailThreads.integrationId, integrationId),
          eq(emailThreads.providerThreadId, providerThreadId)
        )
      )
      .limit(1);

    return result[0] || null;
  }
}
