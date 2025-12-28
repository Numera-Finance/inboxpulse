/**
 * Zod schemas for notification API responses
 */

import { z } from 'zod';

// Import batchIntervalSchema from requests to avoid duplication
import { batchIntervalSchema } from './requests';

export const notificationResponseSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  userId: z.string().uuid(),
  notificationTypeId: z.string().uuid(),
  title: z.string(),
  body: z.string(),
  status: z.enum(['pending', 'batched', 'sent', 'failed', 'cancelled', 'expired', 'skipped', 'read']),
  priority: z.enum(['critical', 'high', 'normal', 'low']),
  scheduledFor: z.coerce.date().nullable(),
  sentAt: z.coerce.date().nullable(),
  readAt: z.coerce.date().nullable(),
  channel: z.enum(['email', 'slack', 'gchat', 'sms', 'mobile_push']).nullable(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

export type NotificationResponse = z.infer<typeof notificationResponseSchema>;

export const notificationTypeResponseSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  category: z.enum(['alerts', 'approvals', 'digests', 'system']).nullable(),
  defaultChannels: z.array(z.enum(['email', 'slack', 'gchat', 'sms', 'mobile_push'])),
  defaultFrequency: z.enum(['immediate', 'batched']),
  requiresAction: z.boolean(),
  isActive: z.boolean(),
  subscribed: z.boolean(),
});

export type NotificationTypeResponse = z.infer<typeof notificationTypeResponseSchema>;

export const userPreferencesResponseSchema = z.object({
  id: z.string().uuid(),
  notificationTypeId: z.string().uuid(),
  enabled: z.boolean(),
  channels: z.array(z.enum(['email', 'slack', 'gchat', 'sms', 'mobile_push'])),
  frequency: z.enum(['immediate', 'batched']),
  batchInterval: batchIntervalSchema.nullable(),
  quietHours: z.object({
    start: z.string(),
    end: z.string(),
    timezone: z.string(),
  }).nullable(),
  subscriptionSource: z.enum(['manual', 'auto']),
});

export type UserPreferencesResponse = z.infer<typeof userPreferencesResponseSchema>;

export const refreshResultSchema = z.object({
  subscribed: z.array(z.string().uuid()),
  unsubscribed: z.array(z.string().uuid()),
  updated: z.array(z.string().uuid()),
});

export type RefreshResult = z.infer<typeof refreshResultSchema>;
