import { z } from 'zod';

/**
 * Zod schema for creating a tenant
 */
export const createTenantRequestSchema = z.object({
  name: z.string().min(1),
});

export type CreateTenantRequest = z.infer<typeof createTenantRequestSchema>;

/**
 * Zod schema for Tenant response
 */
export const tenantSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  domains: z.array(z.string()).default([]),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

export type Tenant = z.infer<typeof tenantSchema>;
