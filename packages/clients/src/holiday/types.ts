import { z } from 'zod';

/**
 * Zod schema for Holiday
 */
export const holidaySchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  date: z.string(), // YYYY-MM-DD format
  timezone: z.string(),
  name: z.string(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

export type Holiday = z.infer<typeof holidaySchema>;

/**
 * Request to create a holiday
 */
export interface CreateHolidayRequest {
  date: string; // YYYY-MM-DD format
  timezone: string;
  name: string;
}

/**
 * Request to update a holiday
 */
export interface UpdateHolidayRequest {
  date?: string; // YYYY-MM-DD format
  timezone?: string;
  name?: string;
}

/**
 * Request to bulk create holidays
 */
export interface BulkCreateHolidaysRequest {
  timezone: string;
  holidays: Array<{
    date: string; // YYYY-MM-DD format
    name: string;
  }>;
}

/**
 * Response from bulk create
 */
export interface BulkCreateHolidaysResponse {
  created: number;
  holidays: Holiday[];
}
