import { z } from 'zod';
import { roleResponseSchema } from '../role/types';

/**
 * Customer assignment with role for create/update requests
 */
export const customerAssignmentRequestSchema = z.object({
  customerId: z.string().uuid(),
  roleId: z.string().uuid({ message: 'Role is required for customer assignment' }),
});

export type CustomerAssignmentRequest = z.infer<typeof customerAssignmentRequestSchema>;

/**
 * Zod schema for creating a user
 */
export const createUserRequestSchema = z.object({
  firstName: z.string().min(1).max(60),
  lastName: z.string().min(1).max(60),
  email: z.string().email().max(255),
  roleId: z.string().uuid().optional(), // RBAC system role
  timezone: z.string().max(50).optional(), // IANA timezone (e.g., 'Asia/Kolkata')
  managerEmails: z.array(z.string().email()).optional(),
  customerAssignments: z.array(customerAssignmentRequestSchema).optional(),
});

export type CreateUserRequest = z.infer<typeof createUserRequestSchema>;

/**
 * Zod schema for updating a user
 */
export const updateUserRequestSchema = z.object({
  firstName: z.string().min(1).max(60).optional(),
  lastName: z.string().min(1).max(60).optional(),
  email: z.string().email().max(255).optional(),
  roleId: z.string().uuid().optional(), // RBAC system role
  canLogin: z.boolean().optional(), // Whether user can login to the application
  timezone: z.string().max(50).optional(), // IANA timezone (e.g., 'Asia/Kolkata')
  managerEmails: z.array(z.string().email()).optional(),
});

export type UpdateUserRequest = z.infer<typeof updateUserRequestSchema>;

/**
 * Zod schema for updating user preferences (self-service)
 */
export const updateUserPreferencesSchema = z.object({
  timezone: z.string().max(50).optional(),
});

export type UpdateUserPreferences = z.infer<typeof updateUserPreferencesSchema>;

/**
 * Customer assignment in response
 */
export const customerAssignmentResponseSchema = z.object({
  userId: z.string().uuid(),
  customerId: z.string().uuid(),
  roleId: z.string().uuid().nullable().optional(),
  createdAt: z.coerce.date(),
});

export type CustomerAssignmentResponse = z.infer<typeof customerAssignmentResponseSchema>;

/**
 * Zod schema for User response
 */
export const userResponseSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  firstName: z.string(),
  lastName: z.string(),
  email: z.string().email(),
  rowStatus: z.number().int().min(0).max(2), // 0=active, 1=inactive, 2=archived
  roleId: z.string().uuid().nullable().optional(), // RBAC system role
  role: roleResponseSchema.nullable().optional(), // Nested role object
  canLogin: z.boolean().optional(), // Whether user can login to the application
  timezone: z.string().nullable().optional(), // IANA timezone
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
  lastLoginAt: z.coerce.date().nullable().optional(), // Last login timestamp
  customerAssignments: z.array(customerAssignmentResponseSchema).optional(),
  managers: z.array(z.object({
    id: z.string().uuid(),
    email: z.string().email(),
    firstName: z.string(),
    lastName: z.string(),
  })).optional(),
});

export type UserResponse = z.infer<typeof userResponseSchema>;

/**
 * Zod schema for User with relations
 */
export const userWithRelationsResponseSchema = userResponseSchema.extend({
  managers: z.array(userResponseSchema).optional(),
  customerAssignments: z.array(z.object({
    userId: z.string().uuid(),
    customerId: z.string().uuid(),
    roleId: z.string().uuid().nullable().optional(),
    createdAt: z.coerce.date(),
  })).optional(),
});

export type UserWithRelationsResponse = z.infer<typeof userWithRelationsResponseSchema>;

/**
 * User with role (from customer assignment)
 */
export const userWithRoleSchema = userResponseSchema.extend({
  roleId: z.string().uuid().nullable(),
});

export type UserWithRole = z.infer<typeof userWithRoleSchema>;

/**
 * Zod schema for adding a manager
 */
export const addManagerRequestSchema = z.object({
  managerEmail: z.string().email(),
});

export type AddManagerRequest = z.infer<typeof addManagerRequestSchema>;

/**
 * Zod schema for adding a customer
 */
export const addCustomerRequestSchema = z.object({
  customerDomain: z.string().min(1),
  roleId: z.string().uuid().optional(),
});

export type AddCustomerRequest = z.infer<typeof addCustomerRequestSchema>;

/**
 * Zod schema for transferring a user's responsibilities
 */
export const transferUserRequestSchema = z.object({
  targetUserId: z.string().uuid(),
});

export type TransferUserRequest = z.infer<typeof transferUserRequestSchema>;

/**
 * Response from a user transfer operation
 */
export const transferUserResponseSchema = z.object({
  customersTransferred: z.number(),
  tasksTransferred: z.number(),
  managersTransferred: z.number(),
});

export type TransferUserResponse = z.infer<typeof transferUserResponseSchema>;
