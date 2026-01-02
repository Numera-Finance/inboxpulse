import {
  pgTable,
  uuid,
  timestamp,
  jsonb,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { v7 as uuidv7 } from 'uuid';
import { tenants } from '../tenants/schema';
import { users } from '../users/schema';

/**
 * Dashboards - User dashboard layout configurations
 * Each user has one dashboard config per tenant
 */
export const dashboards = pgTable(
  'dashboards',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    // Dashboard layout configuration (react-grid-layout format)
    config: jsonb('config').notNull(),

    // Timestamps
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // Each user has one dashboard per tenant
    uniqueIndex('uniq_dashboards_tenant_user').on(
      table.tenantId,
      table.userId
    ),
  ]
);

// =============================================================================
// Type Exports
// =============================================================================

export type Dashboard = typeof dashboards.$inferSelect;
export type NewDashboard = typeof dashboards.$inferInsert;

// Dashboard config type (react-grid-layout format)
export interface DashboardLayoutConfig {
  [breakpoint: string]: Array<{
    i: string;
    x: number;
    y: number;
    w: number;
    h: number;
    minW?: number;
    minH?: number;
    maxW?: number;
    maxH?: number;
    static?: boolean;
  }>;
}
