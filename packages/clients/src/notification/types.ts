/**
 * Notification client types
 */

import { z } from 'zod';

/**
 * Notification channel types
 */
export type NotificationChannel = 'email' | 'in_app' | 'push' | 'sms';

/**
 * Batch interval configuration
 */
export interface BatchInterval {
  type: 'minutes' | 'hours' | 'daily';
  value?: number;
  time?: string; // For daily, e.g., "08:00"
}

/**
 * User notification preference
 */
export interface NotificationPreference {
  id?: string;
  notificationTypeId?: string;
  enabled: boolean;
  channels?: NotificationChannel[];
  frequency?: 'immediate' | 'batched';
  batchInterval?: BatchInterval | null;
}

/**
 * Update preference request
 */
export const updatePreferenceSchema = z.object({
  enabled: z.boolean().optional(),
  channels: z.array(z.enum(['email', 'in_app', 'push', 'sms'])).optional(),
  frequency: z.enum(['immediate', 'batched']).optional(),
  batchInterval: z.object({
    type: z.enum(['minutes', 'hours', 'daily']),
    value: z.number().optional(),
    time: z.string().optional(),
  }).nullable().optional(),
});

export type UpdatePreference = z.infer<typeof updatePreferenceSchema>;

/**
 * Preference check response (for API service)
 */
export interface PreferenceCheck {
  enabled: boolean;
  frequency?: 'immediate' | 'batched';
  batchInterval?: BatchInterval | null;
}
