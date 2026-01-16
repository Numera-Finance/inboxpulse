import { pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
import { v7 as uuidv7 } from 'uuid';

export const tenants = pgTable('tenants', {
  id: uuid('id').primaryKey().$defaultFn(() => uuidv7()),
  name: text('name').notNull(),
  domain: varchar('domain', { length: 255 }), // Email domain for tenant users (e.g., 'acme.com')

  // TAT Configuration
  // controllerRoleId: The role that identifies Controllers (Account Managers)
  // Used for TAT metrics dashboard to track response times by controller
  controllerRoleId: uuid('controller_role_id'), // References roles.id (no FK to avoid circular dep)

  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export type Tenant = typeof tenants.$inferSelect;
export type NewTenant = typeof tenants.$inferInsert;
