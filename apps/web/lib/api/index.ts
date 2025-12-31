// Re-export all API functions
export * from './users';
export * from './customers';
export * from './contacts';
export * from './integrations';
export * from './emails';
export * from './roles';
export * from './tasks';
export { clearClients, API_BASE_URL } from './clients';

// Re-export types from @crm/clients for convenience
export type {
  UserResponse,
  CreateUserRequest,
  UpdateUserRequest,
  AddManagerRequest,
  AddCustomerRequest,
  Customer,
  CreateCustomerRequest,
  Contact,
  CreateContactRequest,
  Integration,
  IntegrationSource,
  RoleResponse,
  Task,
  TaskComment,
  TaskSearchRequest,
  TaskSearchResponse,
  CreateTaskRequest,
  AssignableUser,
} from '@crm/clients';

// Re-export shared types
export type { SearchRequest, SearchResponse } from '@crm/shared';
