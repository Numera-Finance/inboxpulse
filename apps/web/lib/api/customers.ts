import { getCustomerClient } from './clients';
import type { SearchRequest, SearchResponse } from '@crm/shared';
import type { Customer, CreateCustomerRequest } from '@crm/clients';

/**
 * Get a customer by ID
 */
export async function getCustomer(id: string, signal?: AbortSignal): Promise<Customer | null> {
  return getCustomerClient().getCustomerById(id, signal);
}

/**
 * Get a customer by domain
 */
export async function getCustomerByDomain(
  tenantId: string,
  domain: string,
  signal?: AbortSignal
): Promise<Customer | null> {
  return getCustomerClient().getCustomerByDomain(tenantId, domain, signal);
}

/**
 * Get all customers for a tenant
 */
export async function getCustomersByTenant(
  tenantId: string,
  signal?: AbortSignal
): Promise<Customer[]> {
  return getCustomerClient().getCustomersByTenant(tenantId, signal);
}

/**
 * Search customers with filters and pagination
 */
export async function searchCustomers(
  request: SearchRequest,
  signal?: AbortSignal
): Promise<SearchResponse<Customer>> {
  return getCustomerClient().search(request, signal);
}

/**
 * Create or update a customer
 */
export async function upsertCustomer(
  data: CreateCustomerRequest,
  signal?: AbortSignal
): Promise<Customer> {
  return getCustomerClient().upsertCustomer(data, signal);
}

/**
 * Update customer fields (name, labels, metadata, etc.)
 */
export async function updateCustomer(
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
  return getCustomerClient().updateCustomer(id, data, signal);
}
