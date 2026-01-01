/**
 * Base Batch Template
 *
 * For batched, multi-user notifications.
 * Template fetches data, builds payloads, loops over users, and tracks scheduling.
 */

import { z } from 'zod';
import { CronExpressionParser } from 'cron-parser';
import {
  BaseNotificationTemplate,
  type TemplateUser,
  type ChannelPayload,
  type ChannelSender,
  type SendResult,
  type Channel,
} from './base-template';
import {
  type TemplateBatchInterval,
  type TemplateDefinition,
  BATCH_INTERVALS,
} from './template-definitions';

// Re-export for convenience
export { BATCH_INTERVALS, type TemplateBatchInterval, type TemplateDefinition };
export {
  type TemplateUser,
  type ChannelPayload,
  type ChannelSender,
  type SendResult,
  type Channel,
} from './base-template';

// =============================================================================
// Batch-Specific Types
// =============================================================================

/**
 * Extended user info for batch templates (includes scheduling fields)
 */
export const batchUserSchema = z.object({
  userId: z.string().uuid(),
  tenantId: z.string().uuid(),
  email: z.string().email(),
  phone: z.string().optional(),
  name: z.string().optional(),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  timezone: z.string().default('UTC'),
  lastSentAt: z.coerce.date().nullable(),
  batchInterval: z.object({
    cron: z.string(),
    timezone: z.string().optional(),
  }).nullable().optional(),
  payload: z.record(z.string(), z.unknown()).nullable().optional(),
});

export type BatchUser = z.infer<typeof batchUserSchema>;

/**
 * Input to batch template send()
 */
export const batchInputSchema = z.object({
  templateName: z.string(),
  users: z.array(batchUserSchema),
  channel: z.enum(['email', 'sms', 'in_app', 'push'] as const),
  runTimestamp: z.coerce.date(),
});

export type BatchInput = z.infer<typeof batchInputSchema>;

/**
 * Result for a single user in batch
 */
export const userSendResultSchema = z.object({
  userId: z.string().uuid(),
  sent: z.boolean(),
  skipped: z.boolean().default(false),
  skipReason: z.string().optional(),
  messageId: z.string().optional(),
  error: z.string().optional(),
  nextSendAt: z.coerce.date(),
});

export type UserSendResult = z.infer<typeof userSendResultSchema>;

/**
 * Aggregated result from batch send
 */
export const batchResultSchema = z.object({
  success: z.boolean(),
  totalUsers: z.number().int().nonnegative(),
  sentCount: z.number().int().nonnegative(),
  skippedCount: z.number().int().nonnegative(),
  errorCount: z.number().int().nonnegative(),
  results: z.array(userSendResultSchema),
});

export type BatchResult = z.infer<typeof batchResultSchema>;

// =============================================================================
// Base Batch Template
// =============================================================================

/**
 * Base class for batch notification templates.
 *
 * Batch templates:
 * - Process multiple users in a loop
 * - Fetch data for each user
 * - Build payloads internally
 * - Track next send time for scheduling
 *
 * @example
 * ```typescript
 * class EscalationSummaryTemplate extends BaseBatchTemplate<EscalationData> {
 *   static readonly definition: TemplateDefinition = {
 *     name: 'escalation.summary',
 *     defaultFrequency: 'batched',
 *     defaultBatchInterval: BATCH_INTERVALS.DAILY_8AM,
 *     isBatchTemplate: true,
 *     ...
 *   };
 *
 *   readonly name = EscalationSummaryTemplate.definition.name;
 *
 *   async fetchData(user: BatchUser): Promise<EscalationData | null> {
 *     return await this.api.getEscalations(user.userId);
 *   }
 *
 *   async getPayload(user: BatchUser, data: EscalationData, channel: Channel): Promise<ChannelPayload> {
 *     const html = await render(EscalationEmail(data));
 *     return { channel: 'email', to: user.email, subject: '...', html };
 *   }
 * }
 * ```
 */
export abstract class BaseBatchTemplate<TData = unknown> extends BaseNotificationTemplate {
  /**
   * Send batch notification to all users.
   *
   * @param input - Batch input with users, channel, and run timestamp
   * @param sender - Channel sender for delivery
   * @returns Aggregated batch result
   */
  async send(input: BatchInput, sender: ChannelSender): Promise<BatchResult> {
    const results: UserSendResult[] = [];
    const { users, channel, runTimestamp } = input;

    for (const user of users) {
      try {
        const result = await this.processUser(user, channel, sender, runTimestamp);
        results.push(result);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        results.push({
          userId: user.userId,
          sent: false,
          skipped: false,
          error: message,
          nextSendAt: this.getNextSendAt(user, runTimestamp),
        });
      }
    }

    return this.buildResult(results);
  }

  /**
   * Process a single user in the batch.
   */
  private async processUser(
    user: BatchUser,
    channel: Channel,
    sender: ChannelSender,
    runTimestamp: Date
  ): Promise<UserSendResult> {
    const nextSendAt = this.getNextSendAt(user, runTimestamp);

    // Check if notification can be sent
    if (!await this.canSend(user)) {
      return {
        userId: user.userId,
        sent: false,
        skipped: true,
        skipReason: 'User has disabled this notification',
        nextSendAt,
      };
    }

    // Fetch data for this user
    const data = await this.fetchData(user);

    // Check if notification should be sent
    if (!this.shouldSend(user, data)) {
      return {
        userId: user.userId,
        sent: false,
        skipped: true,
        skipReason: 'No data to send',
        nextSendAt,
      };
    }

    // Build payload
    const payload = await this.getPayload(user, data as TData, channel);

    // Send via channel
    const result = await sender.send(payload);

    return {
      userId: user.userId,
      sent: result.sent,
      skipped: result.skipped,
      skipReason: result.skipReason,
      messageId: result.messageId,
      error: result.error,
      nextSendAt,
    };
  }

  /**
   * Fetch data for a user. Return null if no data available.
   * Must be implemented by subclass.
   */
  abstract fetchData(user: BatchUser): Promise<TData | null>;

  /**
   * Build channel payload for a user.
   * Must be implemented by subclass.
   */
  abstract getPayload(user: BatchUser, data: TData, channel: Channel): Promise<ChannelPayload>;

  /**
   * Check if notification should be sent based on fetched data.
   * Default: send if data is not null.
   * Override for custom logic.
   */
  shouldSend(user: BatchUser, data: TData | null): boolean {
    return data !== null;
  }

  /**
   * Get next send time for a user.
   */
  getNextSendAt(user: BatchUser, fromTime: Date = new Date()): Date {
    return this.calculateNextSendAt(user.batchInterval, user.timezone, fromTime);
  }

  /**
   * Calculate next send time based on cron expression and timezone.
   */
  protected calculateNextSendAt(
    batchInterval: TemplateBatchInterval | null | undefined,
    userTimezone: string,
    fromTime: Date = new Date()
  ): Date {
    // Default cron: daily at 8:00 AM
    const cronExpression = batchInterval?.cron ?? '0 8 * * *';
    const timezone = batchInterval?.timezone ?? userTimezone ?? 'UTC';

    try {
      const interval = CronExpressionParser.parse(cronExpression, {
        currentDate: fromTime,
        tz: timezone,
      });
      return interval.next().toDate();
    } catch (error) {
      console.error('Failed to parse cron expression:', cronExpression, error);
      const fallback = new Date(fromTime);
      fallback.setHours(fallback.getHours() + 24);
      return fallback;
    }
  }

  /**
   * Build aggregated result from individual user results.
   */
  protected buildResult(results: UserSendResult[]): BatchResult {
    const sentCount = results.filter(r => r.sent).length;
    const skippedCount = results.filter(r => r.skipped).length;
    const errorCount = results.filter(r => r.error && !r.skipped).length;

    return {
      success: errorCount === 0,
      totalUsers: results.length,
      sentCount,
      skippedCount,
      errorCount,
      results,
    };
  }
}
