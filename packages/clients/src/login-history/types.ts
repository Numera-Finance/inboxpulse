import { z } from 'zod';

/**
 * Single login history entry as returned by the API. Currently the only
 * surface is the CSV export endpoint, but this schema is here so future
 * list endpoints have a shared type.
 */
export const loginHistoryEntrySchema = z.object({
  loggedInAt: z.coerce.date(),
  email: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  ipAddress: z.string().nullable(),
  userAgent: z.string().nullable(),
});

export type LoginHistoryEntry = z.infer<typeof loginHistoryEntrySchema>;
