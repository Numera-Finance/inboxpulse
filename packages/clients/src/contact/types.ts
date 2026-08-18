import { z } from 'zod';

/**
 * Zod schema for creating/updating a contact
 * Used for validation at API boundaries.
 *
 * Tenant is resolved server-side from the session — never from the request body.
 */
export const createContactRequestSchema = z.object({
  customerId: z.uuid().optional(),
  email: z.string().email().max(500),
  name: z.string().optional(),
  title: z.string().max(200).optional(),
  phone: z.string().max(50).optional(),
  mobile: z.string().max(50).optional(),
  address: z.string().optional(),
  website: z.string().max(500).optional(),
  linkedin: z.string().max(500).optional(),
  x: z.string().max(200).optional(),
  linktree: z.string().max(500).optional(),
});

export type CreateContactRequest = z.infer<typeof createContactRequestSchema>;

/**
 * Assign an email address to a customer.
 *
 * Distinct from a plain contact create: this also re-links the sender's past
 * emails to the customer and, when the domain is unowned or held only by an
 * auto-created placeholder, takes the domain too.
 */
export const assignContactCustomerRequestSchema = z.object({
  email: z.string().email().max(500),
  customerId: z.uuid(),
  name: z.string().max(500).optional(),
});

export type AssignContactCustomerRequest = z.infer<typeof assignContactCustomerRequestSchema>;

/**
 * Zod schema for Contact response
 */
export const contactSchema = z.object({
  id: z.uuid(),
  tenantId: z.uuid(),
  customerId: z.uuid().nullable().optional(),
  email: z.string().email(),
  name: z.string().nullable().optional(),
  title: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  mobile: z.string().nullable().optional(),
  address: z.string().nullable().optional(),
  website: z.string().nullable().optional(),
  linkedin: z.string().nullable().optional(),
  x: z.string().nullable().optional(),
  linktree: z.string().nullable().optional(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

export type Contact = z.infer<typeof contactSchema>;

/**
 * Result of an assignment. `emailsReassigned` counts the distinct emails
 * re-linked, `tasksQueued` the escalation tasks handed to the background worker
 * (queued, not yet created), and `domainMoved` is the domain that changed
 * hands, or null when only this one address was affected.
 */
export const assignContactCustomerResponseSchema = z.object({
  contact: contactSchema,
  emailsReassigned: z.number().int(),
  tasksQueued: z.number().int(),
  domainMoved: z.string().nullable(),
});

export type AssignContactCustomerResponse = z.infer<typeof assignContactCustomerResponseSchema>;
