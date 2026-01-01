/**
 * Base Notification Template
 *
 * Abstract base class for all notification templates.
 * Provides common functionality: registration, definition access, send gating.
 */

import { z } from 'zod';
import {
  registerTemplate,
  type TemplateDefinition,
  type TemplateBatchInterval,
} from './template-definitions';

// =============================================================================
// Channel Payload Types
// =============================================================================

export const baseChannelPayloadSchema = z.object({
  to: z.string(),
});

export const emailPayloadSchema = baseChannelPayloadSchema.extend({
  channel: z.literal('email'),
  from: z.string().optional(),
  subject: z.string(),
  html: z.string(),
  text: z.string().optional(),
});

export const smsPayloadSchema = baseChannelPayloadSchema.extend({
  channel: z.literal('sms'),
  from: z.string().optional(),
  body: z.string(),
});

export const pushPayloadSchema = baseChannelPayloadSchema.extend({
  channel: z.literal('push'),
  title: z.string(),
  body: z.string(),
  data: z.record(z.string(), z.unknown()).optional(),
});

export const inAppPayloadSchema = baseChannelPayloadSchema.extend({
  channel: z.literal('in_app'),
  title: z.string(),
  body: z.string(),
  actionUrl: z.string().optional(),
});

export const channelPayloadSchema = z.discriminatedUnion('channel', [
  emailPayloadSchema,
  smsPayloadSchema,
  pushPayloadSchema,
  inAppPayloadSchema,
]);

export type EmailPayload = z.infer<typeof emailPayloadSchema>;
export type SmsPayload = z.infer<typeof smsPayloadSchema>;
export type PushPayload = z.infer<typeof pushPayloadSchema>;
export type InAppPayload = z.infer<typeof inAppPayloadSchema>;
export type ChannelPayload = z.infer<typeof channelPayloadSchema>;

// =============================================================================
// Channel Types
// =============================================================================

export type Channel = 'email' | 'sms' | 'push' | 'in_app';

// =============================================================================
// User Types
// =============================================================================

export const templateUserSchema = z.object({
  userId: z.string().uuid(),
  tenantId: z.string().uuid(),
  email: z.string().email(),
  phone: z.string().optional(),
  name: z.string().optional(),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  timezone: z.string().default('UTC'),
});

export type TemplateUser = z.infer<typeof templateUserSchema>;

// =============================================================================
// Send Result Types
// =============================================================================

export const sendResultSchema = z.object({
  sent: z.boolean(),
  skipped: z.boolean().default(false),
  skipReason: z.string().optional(),
  messageId: z.string().optional(),
  error: z.string().optional(),
});

export type SendResult = z.infer<typeof sendResultSchema>;

// =============================================================================
// Channel Sender Interface
// =============================================================================

export interface ChannelSender {
  send(payload: ChannelPayload): Promise<SendResult>;
}

// =============================================================================
// Base Notification Template
// =============================================================================

/**
 * Abstract base class for all notification templates.
 *
 * Subclasses:
 * - BaseImmediateTemplate: For immediate, single-user notifications
 * - BaseBatchTemplate: For batched, multi-user notifications
 */
export abstract class BaseNotificationTemplate {
  /**
   * Template definition - must be provided by subclass as static property
   */
  static readonly definition: TemplateDefinition;

  /**
   * Template name - derived from definition
   */
  abstract readonly name: string;

  constructor() {
    const ctor = this.constructor as typeof BaseNotificationTemplate;
    if (ctor.definition) {
      registerTemplate(ctor.definition);
    }
  }

  /**
   * Get the template definition
   */
  getDefinition(): TemplateDefinition {
    const ctor = this.constructor as typeof BaseNotificationTemplate;
    return ctor.definition;
  }

  /**
   * Get default channels for this template
   */
  getDefaultChannels(): Channel[] {
    return this.getDefinition().defaultChannels as Channel[];
  }

  /**
   * Get default batch interval (null for immediate templates)
   */
  getDefaultBatchInterval(): TemplateBatchInterval | null {
    return this.getDefinition().defaultBatchInterval;
  }

  /**
   * Check if this is a batch template
   */
  isBatchTemplate(): boolean {
    return this.getDefinition().isBatchTemplate;
  }

  /**
   * Check if notification can be sent to user.
   * Override to add custom logic (e.g., check user preferences).
   *
   * @param user - The user to check
   * @returns true if notification can be sent
   */
  async canSend(user: TemplateUser): Promise<boolean> {
    // Default: always allow. Override to check preferences, permissions, etc.
    return true;
  }

  /**
   * Send the notification. Implemented by subclasses.
   */
  abstract send(...args: unknown[]): Promise<unknown>;
}
