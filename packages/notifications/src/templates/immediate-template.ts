/**
 * Base Immediate Template
 *
 * For immediate, single-user notifications.
 * Templates implement send() to render and deliver content.
 */

import { z } from 'zod';
import {
  BaseNotificationTemplate,
  type TemplateUser,
  type ChannelSender,
  type SendResult,
} from './base-template';

/**
 * Input for immediate template send
 */
export const immediateInputSchema = z.object({
  user: z.object({
    userId: z.string().uuid(),
    tenantId: z.string().uuid(),
    email: z.string().email(),
    timezone: z.string().default('UTC'),
  }),
  data: z.record(z.string(), z.unknown()),
  channel: z.enum(['email', 'sms', 'push', 'in_app']).default('email'),
});

export type ImmediateInput = z.infer<typeof immediateInputSchema>;

/**
 * Base class for immediate notification templates.
 *
 * Immediate templates:
 * - Send to a single user
 * - Implement send() to render content and deliver
 * - No batching, no scheduling
 *
 * @example
 * ```typescript
 * class TaskAssignedTemplate extends BaseImmediateTemplate<TaskAssignedData> {
 *   async send(input: ImmediateInput, sender: ChannelSender): Promise<SendResult> {
 *     const data = input.data as TaskAssignedData;
 *     const html = await render(TaskAssignedEmail(data));
 *     return sender.send({
 *       channel: 'email',
 *       to: input.user.email,
 *       subject: `New Task: ${data.task.subject}`,
 *       html,
 *     });
 *   }
 * }
 * ```
 */
export abstract class BaseImmediateTemplate<TData = unknown> extends BaseNotificationTemplate {
  /**
   * Send notification to a single user.
   * Templates implement this to render content and deliver.
   *
   * @param input - User, data, and channel
   * @param sender - Channel sender for delivery
   * @returns Send result
   */
  abstract send(
    input: ImmediateInput,
    sender: ChannelSender
  ): Promise<SendResult>;

  /**
   * Helper to check if user can receive this notification.
   * Call this at the start of send() if needed.
   */
  protected async checkCanSend(user: TemplateUser): Promise<SendResult | null> {
    if (!await this.canSend(user)) {
      return {
        sent: false,
        skipped: true,
        skipReason: 'User has disabled this notification',
      };
    }
    return null; // OK to send
  }
}
