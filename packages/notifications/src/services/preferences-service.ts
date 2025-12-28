/**
 * Preferences Service
 *
 * Manages user notification preferences including:
 * - Subscription management
 * - Channel preferences
 * - Frequency settings
 * - Quiet hours
 */

import { injectable, inject } from 'tsyringe';
import { eq, and, type Database } from '@crm/database';
import type { RequestHeader } from '@crm/shared';
import type { UserResolver } from '../types/interfaces';
import type {
  NotificationChannel,
  BatchInterval,
  QuietHours,
  UserNotificationPreference,
  NotificationType,
} from '../types/core';
import { NotificationTypeRepository } from '../repositories/notification-type-repository';

export interface UpdatePreferencesParams {
  enabled?: boolean;
  channels?: NotificationChannel[];
  frequency?: 'immediate' | 'batched';
  batchInterval?: BatchInterval | null;
  quietHours?: QuietHours | null;
  timezone?: string | null;
}

export interface SubscribeParams {
  notificationTypeId: string;
  channels?: NotificationChannel[];
  frequency?: 'immediate' | 'batched';
  batchInterval?: BatchInterval;
}

@injectable()
export class PreferencesService {
  constructor(
    @inject('Database') private db: Database,
    @inject('NotificationTypeRepository') private typeRepo: NotificationTypeRepository,
    @inject('UserResolver') private userResolver: UserResolver,
    @inject('UserNotificationPreferencesTable') private preferencesTable: any
  ) {}

  /**
   * Get user's preference for a specific notification type
   */
  async getPreference(
    userId: string,
    notificationTypeId: string,
    header: RequestHeader
  ): Promise<UserNotificationPreference | null> {
    const result = await this.db
      .select()
      .from(this.preferencesTable)
      .where(
        and(
          eq(this.preferencesTable.userId, userId),
          eq(this.preferencesTable.notificationTypeId, notificationTypeId),
          eq(this.preferencesTable.tenantId, header.tenantId)
        )
      )
      .limit(1);

    return (result[0] as UserNotificationPreference) || null;
  }

  /**
   * Get all preferences for a user
   */
  async getUserPreferences(
    userId: string,
    header: RequestHeader
  ): Promise<UserNotificationPreference[]> {
    const results = await this.db
      .select()
      .from(this.preferencesTable)
      .where(
        and(
          eq(this.preferencesTable.userId, userId),
          eq(this.preferencesTable.tenantId, header.tenantId)
        )
      );
    return results as UserNotificationPreference[];
  }

  /**
   * Update user's preference for a notification type
   */
  async updatePreference(
    userId: string,
    notificationTypeId: string,
    params: UpdatePreferencesParams,
    header: RequestHeader
  ): Promise<UserNotificationPreference> {
    const existing = await this.getPreference(userId, notificationTypeId, header);

    if (existing) {
      // Update existing preference
      const result = await this.db
        .update(this.preferencesTable)
        .set({
          ...params,
          updatedAt: new Date(),
        })
        .where(eq(this.preferencesTable.id, existing.id))
        .returning();

      return result[0] as UserNotificationPreference;
    } else {
      // Create new preference
      const notificationType = await this.typeRepo.findById(notificationTypeId, header);
      if (!notificationType) {
        throw new Error(`Notification type ${notificationTypeId} not found`);
      }

      const result = await this.db
        .insert(this.preferencesTable)
        .values({
          tenantId: header.tenantId,
          userId,
          notificationTypeId,
          enabled: params.enabled ?? true,
          channels: params.channels ?? notificationType.defaultChannels,
          frequency: params.frequency ?? notificationType.defaultFrequency,
          batchInterval: params.batchInterval ?? notificationType.defaultBatchInterval,
          quietHours: params.quietHours,
          timezone: params.timezone,
          subscriptionSource: 'manual',
        })
        .returning();

      return result[0] as UserNotificationPreference;
    }
  }

  /**
   * Subscribe user to a notification type
   */
  async subscribe(
    userId: string,
    params: SubscribeParams,
    header: RequestHeader
  ): Promise<UserNotificationPreference> {
    // Verify notification type exists and is active
    const notificationType = await this.typeRepo.findById(params.notificationTypeId, header);
    if (!notificationType) {
      throw new Error(`Notification type ${params.notificationTypeId} not found`);
    }
    if (!notificationType.isActive) {
      throw new Error(`Notification type ${params.notificationTypeId} is not active`);
    }

    // Check if user has required permission
    if (notificationType.requiredPermission) {
      const hasPermission = await this.userResolver.userHasPermission(
        userId,
        notificationType.requiredPermission
      );
      if (!hasPermission) {
        throw new Error(`User does not have permission to subscribe to this notification type`);
      }
    }

    // Check subscription conditions
    if (notificationType.subscriptionConditions) {
      const meetsConditions = await this.userResolver.userMatchesConditions(
        userId,
        notificationType.subscriptionConditions
      );
      if (!meetsConditions) {
        throw new Error(`User does not meet subscription conditions`);
      }
    }

    return this.updatePreference(
      userId,
      params.notificationTypeId,
      {
        enabled: true,
        channels: params.channels ?? notificationType.defaultChannels,
        frequency: params.frequency ?? notificationType.defaultFrequency,
        batchInterval: params.batchInterval ?? notificationType.defaultBatchInterval,
      },
      header
    );
  }

  /**
   * Unsubscribe user from a notification type
   */
  async unsubscribe(
    userId: string,
    notificationTypeId: string,
    header: RequestHeader
  ): Promise<void> {
    const existing = await this.getPreference(userId, notificationTypeId, header);

    if (existing) {
      await this.db
        .update(this.preferencesTable)
        .set({
          enabled: false,
          updatedAt: new Date(),
        })
        .where(eq(this.preferencesTable.id, existing.id));
    }
  }

  /**
   * Get all subscribers for a notification type
   */
  async getSubscribers(
    notificationTypeId: string,
    header: RequestHeader
  ): Promise<string[]> {
    const preferences = await this.db
      .select({ userId: this.preferencesTable.userId })
      .from(this.preferencesTable)
      .where(
        and(
          eq(this.preferencesTable.notificationTypeId, notificationTypeId),
          eq(this.preferencesTable.tenantId, header.tenantId),
          eq(this.preferencesTable.enabled, true)
        )
      );

    return preferences.map(p => p.userId);
  }

  /**
   * Auto-subscribe users who meet conditions for a notification type
   */
  async refreshAutoSubscriptions(
    notificationTypeId: string,
    header: RequestHeader
  ): Promise<{ subscribed: number; unsubscribed: number }> {
    const notificationType = await this.typeRepo.findById(notificationTypeId, header);
    if (!notificationType || !notificationType.autoSubscribeEnabled) {
      return { subscribed: 0, unsubscribed: 0 };
    }

    // This would iterate through users and check conditions
    // Implementation depends on how you want to query users
    // For now, return empty result
    return { subscribed: 0, unsubscribed: 0 };
  }

  /**
   * Check if a notification should be sent based on quiet hours
   */
  isInQuietHours(
    quietHours: QuietHours | null | undefined,
    timezone: string = 'UTC'
  ): boolean {
    if (!quietHours) return false;

    const now = new Date();
    // Convert to user's timezone
    const userTime = new Date(now.toLocaleString('en-US', { timeZone: timezone }));
    const hours = userTime.getHours();
    const minutes = userTime.getMinutes();
    const currentTime = hours * 60 + minutes;

    const [startHours, startMinutes] = quietHours.start.split(':').map(Number);
    const [endHours, endMinutes] = quietHours.end.split(':').map(Number);
    const startTime = startHours * 60 + startMinutes;
    const endTime = endHours * 60 + endMinutes;

    // Handle overnight quiet hours (e.g., 22:00 - 07:00)
    if (startTime > endTime) {
      return currentTime >= startTime || currentTime <= endTime;
    }

    return currentTime >= startTime && currentTime <= endTime;
  }
}
