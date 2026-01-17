import {
  pgTable,
  uuid,
  varchar,
  date,
  timestamp,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { v7 as uuidv7 } from 'uuid';
import { tenants } from '../tenants/schema';

/**
 * Holiday Calendars - Store holidays by tenant and timezone
 *
 * Used for TAT (Turn Around Time) calculation to exclude holidays
 * from business days calculation.
 *
 * Each tenant can have holidays configured per timezone to support
 * teams in different regions.
 */
export const holidayCalendars = pgTable(
  'holiday_calendars',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),

    // Holiday details
    date: date('date').notNull(), // '2026-01-01'
    timezone: varchar('timezone', { length: 100 }).notNull(), // 'America/New_York'
    name: varchar('name', { length: 255 }).notNull(), // 'New Year\'s Day'

    // Timestamps
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // For querying holidays by tenant and date range
    index('idx_holidays_tenant_date').on(table.tenantId, table.date),
    // For querying holidays by tenant and timezone
    index('idx_holidays_tenant_timezone').on(table.tenantId, table.timezone),
    // Prevent duplicate holidays on same date/timezone for a tenant
    uniqueIndex('uniq_holidays_tenant_date_timezone').on(
      table.tenantId,
      table.date,
      table.timezone
    ),
  ]
);

// =============================================================================
// Type Exports
// =============================================================================

export type HolidayCalendar = typeof holidayCalendars.$inferSelect;
export type NewHolidayCalendar = typeof holidayCalendars.$inferInsert;
