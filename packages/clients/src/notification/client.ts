/**
 * Notifications client for interacting with the notifications service
 */

import { BaseClient } from '../base-client';
import type { ApiResponse } from '@crm/shared';
import type {
  NotificationPreference,
  UpdatePreference,
  PreferenceCheck,
} from './types';

/**
 * Context for notification requests (required by notifications service)
 */
export interface NotificationContext {
  tenantId: string;
  userId: string;
}

/**
 * Client for notification-related API operations
 */
export class NotificationsClient extends BaseClient {
  /**
   * Get user's preference for a notification type by name
   * @param typeName - e.g., 'task.assigned', 'escalation.summary'
   * @param ctx - Tenant/user context (required)
   */
  async getPreference(
    typeName: string,
    ctx: NotificationContext,
    signal?: AbortSignal
  ): Promise<NotificationPreference> {
    const response = await this.getWithContext<ApiResponse<NotificationPreference>>(
      `/api/notifications/preferences/by-name/${typeName}`,
      ctx,
      signal
    );
    // Return defaults if no data
    return response?.data || {
      enabled: true,
      frequency: 'immediate',
    };
  }

  /**
   * Update user's preference for a notification type by name
   * @param typeName - e.g., 'task.assigned', 'escalation.summary'
   * @param data - Preference data to update
   * @param ctx - Tenant/user context (required)
   */
  async updatePreference(
    typeName: string,
    data: UpdatePreference,
    ctx: NotificationContext,
    signal?: AbortSignal
  ): Promise<NotificationPreference> {
    const response = await this.putWithContext<ApiResponse<NotificationPreference>>(
      `/api/notifications/preferences/by-name/${typeName}`,
      data,
      ctx,
      signal
    );
    if (!response?.data) {
      throw new Error('Invalid API response: missing data');
    }
    return response.data;
  }

  /**
   * Delete user's preference for a notification type (revert to defaults)
   * @param typeName - e.g., 'task.assigned'
   * @param ctx - Tenant/user context (required)
   */
  async deletePreference(
    typeName: string,
    ctx: NotificationContext,
    signal?: AbortSignal
  ): Promise<void> {
    await this.deleteWithContext<ApiResponse<void>>(
      `/api/notifications/preferences/by-name/${typeName}`,
      ctx,
      signal
    );
  }

  /**
   * Check if a notification type is enabled for a specific user
   * Used by API service before sending notifications
   * @param typeName - e.g., 'task.assigned'
   * @param userId - The user to check
   */
  async isEnabled(typeName: string, userId: string, signal?: AbortSignal): Promise<boolean> {
    const response = await this.get<ApiResponse<PreferenceCheck>>(
      `/api/notifications/preferences/by-name/${typeName}/user/${userId}`,
      signal
    );
    return response?.data?.enabled ?? true;
  }

  /**
   * Get full preference check for a user (enabled + frequency)
   * Used by cron jobs for batched notifications
   */
  async getPreferenceCheck(
    typeName: string,
    userId: string,
    signal?: AbortSignal
  ): Promise<PreferenceCheck> {
    const response = await this.get<ApiResponse<PreferenceCheck>>(
      `/api/notifications/preferences/by-name/${typeName}/user/${userId}`,
      signal
    );
    return response?.data ?? { enabled: true };
  }
}
