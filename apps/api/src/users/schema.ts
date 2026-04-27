import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  smallint,
  boolean,
  primaryKey,
  index,
  uniqueIndex,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { tenants } from '../tenants/schema';
import { customers } from '../customers/schema';
import { roles } from '../roles/schema';

// Re-export shared RowStatus enum
export { RowStatus } from '@crm/shared';
export type { RowStatusValue as RowStatusType } from '@crm/shared';

/**
 * Users - Core user entity (merged from employees)
 * Users are employees - same entity
 */
export const users = pgTable(
  'users',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),

    // User information
    firstName: varchar('first_name', { length: 60 }).notNull(),
    lastName: varchar('last_name', { length: 60 }).notNull(),
    email: varchar('email', { length: 255 }).notNull(),

    // Role reference (for RBAC)
    roleId: uuid('role_id').references(() => roles.id),

    // API key hash for service/API users (null for regular users)
    // Used for service-to-service authentication
    apiKeyHash: varchar('api_key_hash', { length: 64 }),

    // Whether the user can login to the application
    canLogin: boolean('can_login').notNull().default(true),

    // User's timezone for notification scheduling (IANA timezone)
    timezone: varchar('timezone', { length: 50 }).default('Asia/Kolkata'),

    // Status: 0 = active, 1 = inactive, 2 = archived
    rowStatus: smallint('row_status').notNull().default(0),

    // Timestamps
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('uniq_users_tenant_email').on(
      table.tenantId,
      table.email
    ),
    index('idx_users_tenant').on(table.tenantId),
    index('idx_users_tenant_status').on(
      table.tenantId,
      table.rowStatus
    ),
  ]
);

/**
 * User Managers - Direct manager relationships (source of truth)
 *
 * One user can have multiple managers (matrix organization).
 * Changes trigger async rebuild of user_accessible_customers.
 */
export const userManagers = pgTable(
  'user_managers',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    managerId: uuid('manager_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.managerId] }),
    index('idx_user_managers_manager').on(table.managerId),
    index('idx_user_managers_user').on(table.userId),
    check('chk_no_self_manager', sql`user_id != manager_id`),
  ]
);

/**
 * User Customers - Direct customer assignments (source of truth)
 *
 * A user can be assigned to many customers (50-100+).
 * Changes trigger async rebuild of user_accessible_customers.
 */
export const userCustomers = pgTable(
  'user_customers',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'cascade' }),
    roleId: uuid('role_id'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.customerId] }),
    index('idx_user_customers_customer').on(table.customerId),
    index('idx_user_customers_user').on(table.userId),
  ]
);

/**
 * User Accessible Customers - Denormalized access control table
 *
 * Contains ALL customers a user can access (their own + all descendants').
 * Rebuilt asynchronously via Inngest with 5-minute debounce per tenant.
 *
 * This enables O(1) access control queries instead of recursive hierarchy traversal.
 */
export const userAccessibleCustomers = pgTable(
  'user_accessible_customers',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'cascade' }),
    rebuiltAt: timestamp('rebuilt_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.customerId] }),
    index('idx_uac_customer').on(table.customerId),
    index('idx_uac_user').on(table.userId),
  ]
);

// =============================================================================
// Type Exports
// =============================================================================

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

export type UserManager = typeof userManagers.$inferSelect;
export type NewUserManager = typeof userManagers.$inferInsert;

export type UserCustomer = typeof userCustomers.$inferSelect;
export type NewUserCustomer = typeof userCustomers.$inferInsert;

export type UserAccessibleCustomer = typeof userAccessibleCustomers.$inferSelect;

/**
 * User Subordinates - Denormalized table for efficient subordinate queries
 *
 * Contains ALL subordinates a user has (direct + transitive).
 * Rebuilt asynchronously via Inngest when userManagers changes.
 *
 * This enables O(1) access control queries for tasks (user can see their own
 * tasks + tasks assigned to any subordinate).
 */
export const userSubordinates = pgTable(
  'user_subordinates',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    subordinateId: uuid('subordinate_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    rebuiltAt: timestamp('rebuilt_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.subordinateId] }),
    index('idx_user_subordinates_user').on(table.userId),
    index('idx_user_subordinates_subordinate').on(table.subordinateId),
  ]
);

export type UserSubordinate = typeof userSubordinates.$inferSelect;

/**
 * Login History - Append-only audit log of successful logins.
 *
 * Written by the better-auth session.create.after hook. Pairs with
 * users.lastLoginAt (which only stores the most recent login).
 */
export const loginHistory = pgTable(
  'login_history',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    betterAuthSessionId: varchar('better_auth_session_id', { length: 255 }),
    ipAddress: varchar('ip_address', { length: 64 }),
    userAgent: varchar('user_agent', { length: 512 }),
    loggedInAt: timestamp('logged_in_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('idx_login_history_tenant_logged_in').on(
      table.tenantId,
      table.loggedInAt
    ),
    index('idx_login_history_user_logged_in').on(
      table.userId,
      table.loggedInAt
    ),
  ]
);

export type LoginHistory = typeof loginHistory.$inferSelect;
export type NewLoginHistory = typeof loginHistory.$inferInsert;
