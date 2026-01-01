/**
 * Base Immediate Template
 *
 * For immediate, single-user notifications.
 * Caller builds the payload externally; template gates and sends.
 */

import {
  BaseNotificationTemplate,
  type TemplateUser,
  type ChannelPayload,
  type ChannelSender,
  type SendResult,
} from './base-template';

/**
 * Base class for immediate notification templates.
 *
 * Immediate templates:
 * - Send to a single user
 * - Receive a ready-to-send payload from caller
 * - Check canSend() and forward to sender
 * - No data fetching, no batching, no scheduling
 *
 * @example
 * ```typescript
 * class TaskAssignedTemplate extends BaseImmediateTemplate {
 *   static readonly definition: TemplateDefinition = {
 *     name: 'task.assigned',
 *     defaultFrequency: 'immediate',
 *     isBatchTemplate: false,
 *     ...
 *   };
 *
 *   readonly name = TaskAssignedTemplate.definition.name;
 * }
 *
 * // Usage: caller builds payload, template sends
 * const html = await render(TaskAssignedEmail(data));
 * await template.send(user, { channel: 'email', to: user.email, subject, html }, sender);
 * ```
 */
export abstract class BaseImmediateTemplate extends BaseNotificationTemplate {
  /**
   * Send notification to a single user.
   *
   * @param user - The user to send to
   * @param payload - Ready-to-send channel payload (built by caller)
   * @param sender - Channel sender for delivery
   * @returns Send result
   */
  async send(
    user: TemplateUser,
    payload: ChannelPayload,
    sender: ChannelSender
  ): Promise<SendResult> {
    // Check if notification can be sent to this user
    if (!await this.canSend(user)) {
      return {
        sent: false,
        skipped: true,
        skipReason: 'User has disabled this notification',
      };
    }

    // Send via channel
    try {
      const result = await sender.send(payload);
      return result;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return {
        sent: false,
        skipped: false,
        error: message,
      };
    }
  }
}
