import { BaseClient } from '../base-client';
import type { ApiResponse } from '@crm/shared';
import type {
  DashboardConfigResponse,
  DashboardLayoutConfig,
} from './types';

/**
 * Client for dashboard-related API operations
 */
export class DashboardClient extends BaseClient {
  /**
   * Get current user's dashboard layout config
   */
  async getConfig(signal?: AbortSignal): Promise<DashboardLayoutConfig | null> {
    const response = await this.get<ApiResponse<DashboardConfigResponse>>('/api/dashboards/config', signal);
    return response?.data?.config || null;
  }

  /**
   * Save current user's dashboard layout config
   */
  async saveConfig(config: DashboardLayoutConfig, signal?: AbortSignal): Promise<void> {
    await this.put<ApiResponse<{ success: boolean }>>('/api/dashboards/config', { config }, signal);
  }

  /**
   * Reset current user's dashboard layout config to default
   */
  async resetConfig(signal?: AbortSignal): Promise<DashboardLayoutConfig | null> {
    const response = await super.delete<ApiResponse<DashboardConfigResponse>>('/api/dashboards/config', signal);
    return response?.data?.config || null;
  }
}
