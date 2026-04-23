import { BaseClient } from '../base-client';
import type { ApiResponse, SearchRequest, SearchResponse, ImportResponse } from '@crm/shared';
import type {
  UserResponse,
  UserWithRelationsResponse,
  UserWithRole,
  CreateUserRequest,
  UpdateUserRequest,
  UpdateUserPreferences,
  AddManagerRequest,
  AddCustomerRequest,
  TransferUserRequest,
  TransferUserResponse,
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
   * Get current user's profile
   */
  async getMe(signal?: AbortSignal): Promise<UserResponse | null> {
    const response = await this.get<ApiResponse<UserResponse>>('/api/users/me', signal);
    return response?.data || null;
  }

  /**
   * Update current user's preferences (timezone, etc.)
   */
  async updateMyPreferences(data: UpdateUserPreferences, signal?: AbortSignal): Promise<UserResponse> {
    const response = await this.patch<ApiResponse<UserResponse>>('/api/users/me/preferences', data, signal);
    if (!response?.data) {
      throw new Error('Invalid API response: missing data');
    }
    return response.data;
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
   * Activate user (sets rowStatus to active)
   */
  async activate(id: string, signal?: AbortSignal): Promise<UserResponse> {
    const response = await this.patch<ApiResponse<UserResponse>>(
      `/api/users/${id}/activate`,
      {},
      signal
    );
    if (!response?.data) {
      throw new Error('Invalid API response: missing data');
    }
    return response.data;
  }

  /**
   * Deactivate user (sets rowStatus to inactive)
   */
  async deactivate(id: string, signal?: AbortSignal): Promise<UserResponse> {
    const response = await this.patch<ApiResponse<UserResponse>>(
      `/api/users/${id}/deactivate`,
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
   * Transfer a user's responsibilities to another user
   */
  async transfer(
    sourceUserId: string,
    data: TransferUserRequest,
    signal?: AbortSignal
  ): Promise<TransferUserResponse> {
    const response = await this.post<ApiResponse<TransferUserResponse>>(
      `/api/users/${sourceUserId}/transfer`,
      data,
      signal
    );
    if (!response?.data) {
      throw new Error('Invalid API response: missing data');
    }
    return response.data;
  }

  /**
   * Import users from CSV/Excel
   */
  async import(file: File, signal?: AbortSignal): Promise<ImportResponse> {
    const formData = new FormData();
    formData.append('file', file);

    const response = await fetch(`${this.baseUrl}/api/users/import`, {
      method: 'POST',
      body: formData,
      credentials: 'include', // Include cookies for auth
      signal,
    });

    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({})) as { message?: string; error?: string };
      const message = errorBody.error || errorBody.message || `Import failed: ${response.statusText}`;
      throw new Error(message);
    }

    const result = await response.json() as ApiResponse<ImportResponse>;
    if (!result.data) {
      throw new Error('Invalid API response: missing data');
    }
    return result.data;
  }

  /**
   * Export users to CSV
   */
  async export(signal?: AbortSignal): Promise<Blob> {
    return this.getBlob('/api/users/export', signal);
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
