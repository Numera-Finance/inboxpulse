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
 * Client for notification-related API operations
 */
export class NotificationsClient extends BaseClient {
  /**
   * Get user's preference for a notification type by name
   * @param typeName - e.g., 'task.assigned', 'escalation.summary'
   */
  async getPreference(typeName: string, signal?: AbortSignal): Promise<NotificationPreference> {
    const response = await this.get<ApiResponse<NotificationPreference>>(
      `/api/notifications/preferences/by-name/${typeName}`,
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
   */
  async updatePreference(
    typeName: string,
    data: UpdatePreference,
    signal?: AbortSignal
  ): Promise<NotificationPreference> {
    const response = await this.put<ApiResponse<NotificationPreference>>(
      `/api/notifications/preferences/by-name/${typeName}`,
      data,
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
   */
  async deletePreference(typeName: string, signal?: AbortSignal): Promise<void> {
    await this.delete<ApiResponse<void>>(
      `/api/notifications/preferences/by-name/${typeName}`,
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
