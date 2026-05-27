import { BaseClient } from '../base-client';
import type { ApiResponse, SearchRequest, SearchResponse } from '@crm/shared';
import type { Customer, CreateCustomerRequest, MergeCustomerResponse } from './types';

/**
 * Client for customer-related API operations
 */
export class CustomerClient extends BaseClient {
  /**
   * Create or update a customer
   *
   * Browser callers should omit `tenantId` — tenant is resolved from the session.
   * Internal service-to-service callers (when this client is constructed with
   * `{ internal: true }`) must pass `tenantId` so the `x-tenant-id` header is set
   * for `requireInternalAuth`.
   */
  async upsertCustomer(data: CreateCustomerRequest, signal?: AbortSignal, tenantId?: string): Promise<Customer> {
    const response = await this.post<ApiResponse<Customer>>('/api/customers', data, signal, tenantId);
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
    const response = await this.get<ApiResponse<Customer>>(`/api/customers/domain/${tenantId}/${encodedDomain}`, signal, tenantId);
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
    const response = await this.get<ApiResponse<Customer[]>>(`/api/customers/tenant/${tenantId}`, signal, tenantId);
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
      domains?: string[];
    },
    signal?: AbortSignal
  ): Promise<Customer> {
    const response = await this.patch<ApiResponse<Customer>>(`/api/customers/${id}`, data, signal);

    if (!response?.data) {
      throw new Error('Invalid API response: missing data');
    }

    return response.data;
  }

  /**
   * Import customers from Excel file
   */
  async importCustomers(file: File, signal?: AbortSignal): Promise<CustomerImportResult> {
    const formData = new FormData();
    formData.append('file', file);

    const response = await this.postFormData<ApiResponse<CustomerImportResult>>(
      '/api/customers/import',
      formData,
      signal
    );

    if (!response?.data) {
      throw new Error('Invalid API response: missing data');
    }

    return response.data;
  }

  /**
   * Export all customers to Excel file
   * Returns a Blob that can be downloaded
   */
  async exportCustomers(signal?: AbortSignal): Promise<Blob> {
    return this.getBlob('/api/customers/export', signal);
  }

  /**
   * Download import template
   * Returns a Blob that can be downloaded
   */
  async getImportTemplate(signal?: AbortSignal): Promise<Blob> {
    return this.getBlob('/api/customers/import/template', signal);
  }

  /**
   * Merge source customer into target customer.
   * All data moves to target, source is archived.
   */
  async mergeCustomer(
    targetCustomerId: string,
    sourceCustomerId: string,
    signal?: AbortSignal
  ): Promise<MergeCustomerResponse> {
    const response = await this.post<ApiResponse<MergeCustomerResponse>>(
      `/api/customers/${targetCustomerId}/merge`,
      { sourceCustomerId },
      signal
    );

    if (!response?.data) {
      throw new Error('Invalid API response: missing data');
    }

    return response.data;
  }
}

/**
 * Result of customer import operation
 */
export interface CustomerImportResult {
  imported: number;
  updated: number;
  errors: Array<{
    row: number;
    externalId: string;
    error: string;
  }>;
  warnings: Array<{
    row: number;
    externalId: string;
    warning: string;
  }>;
}
