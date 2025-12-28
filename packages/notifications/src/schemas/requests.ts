/**
 * Zod schemas for notification API requests
 */

import { z } from 'zod';

export const batchIntervalSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('immediate') }),
  z.object({ type: z.literal('minutes'), value: z.number().positive() }),
  z.object({ type: z.literal('hours'), value: z.number().positive() }),
  z.object({ type: z.literal('end_of_day') }),
  z.object({ type: z.literal('custom'), scheduledFor: z.coerce.date() }),
]);

export const sendNotificationRequestSchema = z.object({
  tenantId: z.string().uuid(),
  notificationType: z.string().min(1),
  data: z.record(z.string(), z.unknown()),
  idempotencyKey: z.string().optional(),
  eventKey: z.string().optional(),
  priority: z.enum(['critical', 'high', 'normal', 'low']).optional(),
  expiresAt: z.coerce.date().optional(),
  userIds: z.array(z.string().uuid()).optional(),
  locale: z.string().optional(),
});

export type SendNotificationRequest = z.infer<typeof sendNotificationRequestSchema>;

export const createNotificationTypeRequestSchema = z.object({
  tenantId: z.string().uuid(),
  name: z.string().min(1).max(100),
  description: z.string().optional(),
  category: z.enum(['alerts', 'approvals', 'digests', 'system']).optional(),
  defaultChannels: z.array(z.enum(['email', 'slack', 'gchat', 'sms', 'mobile_push'])),
  defaultFrequency: z.enum(['immediate', 'batched']).default('immediate'),
  defaultBatchInterval: batchIntervalSchema.optional(),
  requiredPermission: z.string().optional(),
  autoSubscribeEnabled: z.boolean().default(false),
  subscriptionConditions: z.object({
    hasCustomers: z.boolean().optional(),
    hasManager: z.boolean().optional(),
  }).optional(),
  requiresAction: z.boolean().default(false),
  defaultExpiresAfterHours: z.number().positive().optional(),
  defaultPriority: z.enum(['critical', 'high', 'normal', 'low']).default('normal'),
  templateConfig: z.object({
    channels: z.record(z.string(), z.string()),
    dataLoaderEnabled: z.boolean().optional(),
    variableMapping: z.record(z.string(), z.string()).optional(),
  }).optional(),
  deduplicationConfig: z.object({
    strategy: z.enum(['overwrite', 'create_new', 'ignore']),
    eventKeyFields: z.array(z.string()),
    updateWindowMinutes: z.number().positive(),
  }).optional(),
});

export type CreateNotificationTypeRequest = z.infer<typeof createNotificationTypeRequestSchema>;

export const updateUserPreferencesRequestSchema = z.object({
  notificationTypeId: z.string().uuid(),
  enabled: z.boolean().optional(),
  channels: z.array(z.enum(['email', 'slack', 'gchat', 'sms', 'mobile_push'])).optional(),
  frequency: z.enum(['immediate', 'batched']).optional(),
  batchInterval: batchIntervalSchema.optional(),
  quietHours: z.object({
    start: z.string().regex(/^([0-1][0-9]|2[0-3]):[0-5][0-9]$/),
    end: z.string().regex(/^([0-1][0-9]|2[0-3]):[0-5][0-9]$/),
    timezone: z.string(),
  }).optional(),
  timezone: z.string().optional(),
});

export type UpdateUserPreferencesRequest = z.infer<typeof updateUserPreferencesRequestSchema>;

export const subscribeRequestSchema = z.object({
  notificationTypeId: z.string().uuid(),
  channels: z.array(z.enum(['email', 'slack', 'gchat', 'sms', 'mobile_push'])).optional(),
  frequency: z.enum(['immediate', 'batched']).optional(),
  batchInterval: batchIntervalSchema.optional(),
});

export type SubscribeRequest = z.infer<typeof subscribeRequestSchema>;

export const actionRequestSchema = z.object({
  actionType: z.string().min(1),
  actionData: z.record(z.string(), z.unknown()).optional(),
});

export type ActionRequest = z.infer<typeof actionRequestSchema>;

export const batchActionRequestSchema = z.object({
  actionType: z.string().min(1),
  notificationIds: z.array(z.string().uuid()).min(1),
  actionData: z.record(z.string(), z.unknown()).optional(),
});

export type BatchActionRequest = z.infer<typeof batchActionRequestSchema>;

export const refreshSubscriptionsRequestSchema = z.object({
  userId: z.string().uuid().optional(),
  notificationTypeIds: z.array(z.string().uuid()).optional(),
});

export type RefreshSubscriptionsRequest = z.infer<typeof refreshSubscriptionsRequestSchema>;

export const createChannelAddressRequestSchema = z.object({
  channel: z.enum(['slack', 'sms', 'mobile_push', 'gchat']),
  address: z.string().min(1).max(255),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type CreateChannelAddressRequest = z.infer<typeof createChannelAddressRequestSchema>;
