import { getContactClient } from './clients';
import type { SearchRequest, SearchResponse } from '@crm/shared';
import type {
  AssignContactCustomerRequest,
  AssignContactCustomerResponse,
  Contact,
  CreateContactRequest,
} from '@crm/clients';

/**
 * Get a contact by ID
 */
export async function getContact(id: string, signal?: AbortSignal): Promise<Contact | null> {
  return getContactClient().getContactById(id, signal);
}

/**
 * Get a contact by email
 */
export async function getContactByEmail(
  tenantId: string,
  email: string,
  signal?: AbortSignal
): Promise<Contact | null> {
  return getContactClient().getContactByEmail(tenantId, email, signal);
}

/**
 * Get all contacts for a tenant
 */
export async function getContactsByTenant(
  tenantId: string,
  signal?: AbortSignal
): Promise<Contact[]> {
  return getContactClient().getContactsByTenant(tenantId, signal);
}

/**
 * Get all contacts for a customer
 */
export async function getContactsByCustomer(
  customerId: string,
  signal?: AbortSignal
): Promise<Contact[]> {
  return getContactClient().getContactsByCustomer(customerId, signal);
}

/**
 * Search contacts with filters and pagination
 */
export async function searchContacts(
  request: SearchRequest,
  signal?: AbortSignal
): Promise<SearchResponse<Contact>> {
  return getContactClient().search(request, signal);
}

/**
 * Create or update a contact
 */
export async function upsertContact(
  data: CreateContactRequest,
  signal?: AbortSignal
): Promise<Contact> {
  return getContactClient().upsertContact(data, signal);
}

/**
 * Assign an email address to a customer, retroactively re-linking that
 * sender's existing emails.
 */
export async function assignContactCustomer(
  data: AssignContactCustomerRequest,
  signal?: AbortSignal
): Promise<AssignContactCustomerResponse> {
  return getContactClient().assignCustomer(data, signal);
}

/**
 * Update a contact
 */
export async function updateContact(
  id: string,
  data: Partial<CreateContactRequest>,
  signal?: AbortSignal
): Promise<Contact> {
  return getContactClient().updateContact(id, data, signal);
}
