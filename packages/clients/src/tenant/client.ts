import { BaseClient } from '../base-client';
import type { ApiResponse } from '@crm/shared';
import type { Tenant, CreateTenantRequest } from './types';

/**
 * Client for tenant-related API operations
 */
export class TenantClient extends BaseClient {
  /**
   * Create a tenant
   */
  async create(data: CreateTenantRequest): Promise<Tenant> {
    const response = await this.post<ApiResponse<Tenant>>('/api/tenants', data);
    if (!response?.data) {
      throw new Error('Invalid API response: missing data');
    }
    return response.data;
  }

  /**
   * Get tenant by ID
   */
  async getById(tenantId: string): Promise<Tenant | null> {
    const response = await this.get<ApiResponse<Tenant>>(`/api/tenants/${tenantId}`);
    return response?.data ?? null;
  }

  /**
   * Get the current user's tenant (resolved server-side from session)
   */
  async getMe(signal?: AbortSignal): Promise<Tenant | null> {
    const response = await this.get<ApiResponse<Tenant>>('/api/tenants/me', signal);
    return response?.data ?? null;
  }
}
