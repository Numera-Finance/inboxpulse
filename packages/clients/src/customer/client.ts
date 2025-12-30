import { BaseClient } from '../base-client';
import type { ApiResponse, SearchRequest, SearchResponse } from '@crm/shared';
import type { Customer, CreateCustomerRequest } from './types';

/**
 * Client for customer-related API operations
 */
export class CustomerClient extends BaseClient {
  /**
   * Create or update a customer
   */
  async upsertCustomer(data: CreateCustomerRequest, signal?: AbortSignal): Promise<Customer> {
    const response = await this.post<ApiResponse<Customer>>('/api/customers', data, signal);
    if (!response) {
      throw new Error('Invalid API response: response is null');
    }

    // The API always returns ApiResponse<T> format: { success: boolean, data?: T, error?: StructuredError }
    // Extract the data field
    const apiResponse = response as ApiResponse<Customer>;
    if (!apiResponse.data) {
      throw new Error(`Invalid API response: missing data field. Response: ${JSON.stringify(response)}`);
    }
    return apiResponse.data;
  }

  /**
   * Get customer by domain
   */
  async getCustomerByDomain(tenantId: string, domain: string, signal?: AbortSignal): Promise<Customer | null> {
    const encodedDomain = encodeURIComponent(domain);
    const response = await this.get<ApiResponse<Customer>>(`/api/customers/domain/${tenantId}/${encodedDomain}`, signal);
    return response?.data || null;
  }

  /**
   * Get customer by ID
   */
  async getCustomerById(id: string, signal?: AbortSignal): Promise<Customer | null> {
    const response = await this.get<ApiResponse<Customer>>(`/api/customers/${id}`, signal);
    return response?.data || null;
  }

  /**
   * Get all customers for a tenant
   */
  async getCustomersByTenant(tenantId: string, signal?: AbortSignal): Promise<Customer[]> {
    const response = await this.get<ApiResponse<Customer[]>>(`/api/customers/tenant/${tenantId}`, signal);
    return response?.data || [];
  }

  /**
   * Search customers
   * Automatically cancels previous search requests when a new one is made
   */
  async search(request: SearchRequest, signal?: AbortSignal): Promise<SearchResponse<Customer>> {
    const response = await this.post<ApiResponse<SearchResponse<Customer>>>(
      '/api/customers/search',
      request,
      signal
    );

    if (!response?.data) {
      throw new Error('Invalid API response: missing data');
    }

    return response.data;
  }

  /**
   * Update customer fields (name, labels, metadata, etc.)
   */
  async updateCustomer(
    id: string,
    data: {
      name?: string;
      website?: string | null;
      industry?: string | null;
      labels?: string[];
      metadata?: Record<string, any> | null;
    },
    signal?: AbortSignal
  ): Promise<Customer> {
    const response = await this.patch<ApiResponse<Customer>>(`/api/customers/${id}`, data, signal);

    if (!response?.data) {
      throw new Error('Invalid API response: missing data');
    }

    return response.data;
  }
}
