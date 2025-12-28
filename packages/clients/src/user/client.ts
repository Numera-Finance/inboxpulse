import { BaseClient } from '../base-client';
import type { ApiResponse, SearchRequest, SearchResponse } from '@crm/shared';
import type {
  UserResponse,
  UserWithRelationsResponse,
  UserWithRole,
  CreateUserRequest,
  UpdateUserRequest,
  AddManagerRequest,
  AddCustomerRequest,
} from './types';

/**
 * Client for user-related API operations
 */
export class UserClient extends BaseClient {
  /**
   * Get user by ID
   */
  async getById(id: string, signal?: AbortSignal): Promise<UserResponse | null> {
    const response = await this.get<ApiResponse<UserResponse>>(`/api/users/${id}`, signal);
    return response?.data || null;
  }

  /**
   * Get users assigned to a customer
   */
  async getByCustomer(customerId: string, signal?: AbortSignal): Promise<UserWithRole[]> {
    const response = await this.get<ApiResponse<UserWithRole[]>>(
      `/api/users/by-customer/${customerId}`,
      signal
    );
    return response?.data || [];
  }

  /**
   * Search users
   */
  async search(request: SearchRequest, signal?: AbortSignal): Promise<SearchResponse<UserResponse>> {
    const response = await this.post<ApiResponse<SearchResponse<UserResponse>>>(
      '/api/users/find',
      request,
      signal
    );
    
    if (!response?.data) {
      throw new Error('Invalid API response: missing data');
    }
    
    return response.data;
  }

  /**
   * Create a user
   */
  async create(data: CreateUserRequest, signal?: AbortSignal): Promise<UserResponse> {
    const response = await this.post<ApiResponse<UserResponse>>('/api/users', data, signal);
    if (!response?.data) {
      throw new Error('Invalid API response: missing data');
    }
    return response.data;
  }

  /**
   * Update a user
   */
  async update(id: string, data: UpdateUserRequest, signal?: AbortSignal): Promise<UserResponse> {
    const response = await this.patch<ApiResponse<UserResponse>>(`/api/users/${id}`, data, signal);
    if (!response?.data) {
      throw new Error('Invalid API response: missing data');
    }
    return response.data;
  }

  /**
   * Mark user as active
   */
  async markActive(id: string, signal?: AbortSignal): Promise<UserResponse> {
    const response = await this.patch<ApiResponse<UserResponse>>(
      `/api/users/${id}/mark-active`,
      {},
      signal
    );
    if (!response?.data) {
      throw new Error('Invalid API response: missing data');
    }
    return response.data;
  }

  /**
   * Mark user as inactive
   */
  async markInactive(id: string, signal?: AbortSignal): Promise<UserResponse> {
    const response = await this.patch<ApiResponse<UserResponse>>(
      `/api/users/${id}/mark-inactive`,
      {},
      signal
    );
    if (!response?.data) {
      throw new Error('Invalid API response: missing data');
    }
    return response.data;
  }

  /**
   * Add a manager to a user
   */
  async addManager(id: string, data: AddManagerRequest, signal?: AbortSignal): Promise<void> {
    await this.post<ApiResponse<void>>(`/api/users/${id}/managers`, data, signal);
  }

  /**
   * Remove a manager from a user
   */
  async removeManager(id: string, managerId: string, signal?: AbortSignal): Promise<void> {
    await this.delete<ApiResponse<void>>(`/api/users/${id}/managers/${managerId}`, signal);
  }

  /**
   * Add a customer assignment to a user
   */
  async addCustomer(id: string, data: AddCustomerRequest, signal?: AbortSignal): Promise<void> {
    await this.post<ApiResponse<void>>(`/api/users/${id}/customers`, data, signal);
  }

  /**
   * Remove a customer assignment from a user
   */
  async removeCustomer(id: string, customerId: string, signal?: AbortSignal): Promise<void> {
    await this.delete<ApiResponse<void>>(`/api/users/${id}/customers/${customerId}`, signal);
  }

  /**
   * Set all customer assignments for a user (replaces existing)
   */
  async setCustomerAssignments(
    id: string,
    assignments: Array<{ customerId: string; roleId?: string }>,
    signal?: AbortSignal
  ): Promise<void> {
    await this.put<ApiResponse<void>>(`/api/users/${id}/customers`, { assignments }, signal);
  }

  /**
   * Import users from CSV/Excel
   */
  async import(file: File, signal?: AbortSignal): Promise<{ imported: number; errors: number }> {
    const formData = new FormData();
    formData.append('file', file);
    
    const response = await fetch(`${this.baseUrl}/api/users/import`, {
      method: 'POST',
      body: formData,
      signal,
    });

    if (!response.ok) {
      throw new Error(`Import failed: ${response.statusText}`);
    }

    const result = await response.json() as ApiResponse<{ imported: number; errors: number }>;
    if (!result.data) {
      throw new Error('Invalid API response: missing data');
    }
    return result.data;
  }

  /**
   * Export users to CSV
   */
  async export(signal?: AbortSignal): Promise<Blob> {
    const response = await fetch(`${this.baseUrl}/api/users/export`, {
      method: 'GET',
      signal,
    });

    if (!response.ok) {
      throw new Error(`Export failed: ${response.statusText}`);
    }

    return response.blob();
  }

  // ===========================================================================
  // Notification-related methods (for service-to-service calls)
  // ===========================================================================

  /**
   * Get user's permissions
   */
  async getPermissions(id: string, signal?: AbortSignal): Promise<number[]> {
    const response = await this.get<ApiResponse<{ permissions: number[] }>>(
      `/api/users/${id}/permissions`,
      signal
    );
    return response?.data?.permissions || [];
  }

  /**
   * Check if user has access to a specific customer
   */
  async hasCustomerAccess(id: string, customerId: string, signal?: AbortSignal): Promise<boolean> {
    const response = await this.get<ApiResponse<{ hasAccess: boolean }>>(
      `/api/users/${id}/customers/${customerId}/access`,
      signal
    );
    return response?.data?.hasAccess ?? false;
  }

  /**
   * Check if user has any customer assignments
   */
  async hasAnyCustomers(id: string, signal?: AbortSignal): Promise<boolean> {
    const response = await this.get<ApiResponse<{ hasCustomers: boolean }>>(
      `/api/users/${id}/has-customers`,
      signal
    );
    return response?.data?.hasCustomers ?? false;
  }

  /**
   * Check if user has a manager
   */
  async hasManager(id: string, signal?: AbortSignal): Promise<boolean> {
    const response = await this.get<ApiResponse<{ hasManager: boolean }>>(
      `/api/users/${id}/has-manager`,
      signal
    );
    return response?.data?.hasManager ?? false;
  }
}
