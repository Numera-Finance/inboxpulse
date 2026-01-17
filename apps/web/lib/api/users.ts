import { getUserClient } from './clients';
import type { SearchRequest, SearchResponse } from '@crm/shared';
import type {
  UserResponse,
  UserWithRole,
  CreateUserRequest,
  UpdateUserRequest,
  AddManagerRequest,
  AddCustomerRequest,
} from '@crm/clients';

/**
 * Get a user by ID
 */
export async function getUser(id: string, signal?: AbortSignal): Promise<UserResponse | null> {
  return getUserClient().getById(id, signal);
}

/**
 * Get users assigned to a customer
 */
export async function getUsersByCustomer(
  customerId: string,
  signal?: AbortSignal
): Promise<UserWithRole[]> {
  return getUserClient().getByCustomer(customerId, signal);
}

/**
 * Search users with filters and pagination
 */
export async function searchUsers(
  request: SearchRequest,
  signal?: AbortSignal
): Promise<SearchResponse<UserResponse>> {
  return getUserClient().search(request, signal);
}

/**
 * Create a new user
 */
export async function createUser(
  data: CreateUserRequest,
  signal?: AbortSignal
): Promise<UserResponse> {
  return getUserClient().create(data, signal);
}

/**
 * Update an existing user
 */
export async function updateUser(
  id: string,
  data: UpdateUserRequest,
  signal?: AbortSignal
): Promise<UserResponse> {
  return getUserClient().update(id, data, signal);
}

/**
 * Mark a user as active
 */
export async function markUserActive(id: string, signal?: AbortSignal): Promise<UserResponse> {
  return getUserClient().markActive(id, signal);
}

/**
 * Mark a user as inactive
 */
export async function markUserInactive(id: string, signal?: AbortSignal): Promise<UserResponse> {
  return getUserClient().markInactive(id, signal);
}

/**
 * Add a manager to a user
 */
export async function addManager(
  userId: string,
  data: AddManagerRequest,
  signal?: AbortSignal
): Promise<void> {
  return getUserClient().addManager(userId, data, signal);
}

/**
 * Remove a manager from a user
 */
export async function removeManager(
  userId: string,
  managerId: string,
  signal?: AbortSignal
): Promise<void> {
  return getUserClient().removeManager(userId, managerId, signal);
}

/**
 * Add a customer assignment to a user
 */
export async function addCustomerToUser(
  userId: string,
  data: AddCustomerRequest,
  signal?: AbortSignal
): Promise<void> {
  return getUserClient().addCustomer(userId, data, signal);
}

/**
 * Remove a customer assignment from a user
 */
export async function removeCustomerFromUser(
  userId: string,
  customerId: string,
  signal?: AbortSignal
): Promise<void> {
  return getUserClient().removeCustomer(userId, customerId, signal);
}

/**
 * Set all customer assignments for a user (replaces existing)
 */
export async function setUserCustomerAssignments(
  userId: string,
  assignments: Array<{ customerId: string; roleId?: string }>,
  signal?: AbortSignal
): Promise<void> {
  return getUserClient().setCustomerAssignments(userId, assignments, signal);
}

/**
 * Import users from a file
 */
export async function importUsers(
  file: File,
  signal?: AbortSignal
): Promise<import('@crm/shared').ImportResponse> {
  return getUserClient().import(file, signal);
}

/**
 * Export users to CSV
 */
export async function exportUsers(signal?: AbortSignal): Promise<Blob> {
  return getUserClient().export(signal);
}
