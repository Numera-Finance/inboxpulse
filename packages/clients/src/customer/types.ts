import { z } from 'zod';

/**
 * Zod schema for creating/updating a customer
 * Used for validation at API boundaries
 *
 * Note: domains array is serialized to customer_domains table internally
 * Physical implementation (customers + customer_domains) is hidden from callers.
 * Tenant is resolved server-side from the session (browser) or `x-tenant-id`
 * header (internal service-to-service via `requireInternalAuth`), not from the body.
 */
export const createCustomerRequestSchema = z.object({
  domains: z.array(z.string().min(1).max(255)).min(1), // At least one domain required
  name: z.string().optional(),
  website: z.string().url().optional(),
  industry: z.string().max(100).optional(),
  externalId: z.string().max(255).optional(), // External system identifier (e.g., Client ID)
  metadata: z.record(z.string(), z.any()).optional(),
  isAutoCreated: z.boolean().optional(), // Set by email analysis, not by manual creation
});

export type CreateCustomerRequest = z.infer<typeof createCustomerRequestSchema>;

/**
 * Zod schema for Customer response
 *
 * This is the logical Customer model exposed to clients.
 * Physical implementation (customers + customer_domains tables) is hidden.
 */
export const customerSchema = z.object({
  id: z.uuid(),
  tenantId: z.uuid(),
  domains: z.array(z.string()), // Array of domains (serialized from customer_domains table)
  name: z.string().nullable().optional(),
  website: z.string().nullable().optional(),
  industry: z.string().nullable().optional(),
  labels: z.array(z.string()).optional(), // Customer labels/tags
  externalId: z.string().nullable().optional(), // External system identifier (e.g., Client ID)
  metadata: z.record(z.string(), z.any()).nullable().optional(),
  isAutoCreated: z.boolean().optional(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
  // Optional aggregated fields (populated when requested via include parameter)
  emailCount: z.number().int().optional(),
  contactCount: z.number().int().optional(),
  escalationCount: z.number().int().optional(),
  upsellCount: z.number().int().optional(),
  churnCount: z.number().int().optional(),
  positiveCount: z.number().int().optional(),
  lastContactDate: z.coerce.date().optional(),
  sentiment: z.object({
    value: z.enum(['positive', 'negative', 'neutral']),
    confidence: z.number().min(0).max(1),
  }).optional(),
  averageTat: z.number().nullable().optional(), // Average TAT in hours
});

export type Customer = z.infer<typeof customerSchema>;

// Merge customer types
export const mergeCustomerRequestSchema = z.object({
  sourceCustomerId: z.string().uuid(),
});

export type MergeCustomerRequest = z.infer<typeof mergeCustomerRequestSchema>;

export const mergeCustomerResponseSchema = z.object({
  targetCustomerId: z.string().uuid(),
  sourceCustomerId: z.string().uuid(),
  movedDomains: z.number().int(),
  movedContacts: z.number().int(),
  movedTasks: z.number().int(),
  movedEmailParticipants: z.number().int(),
  movedUserAssignments: z.number().int(),
});

export type MergeCustomerResponse = z.infer<typeof mergeCustomerResponseSchema>;
