import type { StructuredError } from '../errors';

export interface User {
  id: string;
  email: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface RequestHeader {
  tenantId: string;
  userId: string;
  roleId?: string;
  permissions: number[]; // Array of permission integers from role
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: StructuredError;
}

/**
 * Import error detail for a single row
 */
export interface ImportError {
  row: number;
  email: string;
  error: string;
}

/**
 * Standard response for import operations
 */
export interface ImportResponse {
  imported: number;
  errors: ImportError[];
}

export * from './email';
export * from './analysis';
export * from './customer-roles';
export * from './rbac';
