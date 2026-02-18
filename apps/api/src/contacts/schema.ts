import { pgTable, text, timestamp, uuid, varchar, jsonb, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { v7 as uuidv7 } from 'uuid';
import { tenants } from '../tenants/schema';
import { customers } from '../customers/schema';

export const contacts = pgTable(
  'contacts',
  {
    id: uuid('id').primaryKey().$defaultFn(() => uuidv7()),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    customerId: uuid('customer_id').references(() => customers.id),
    
    // Contact information
    email: varchar('email', { length: 500 }).notNull(),
    name: text('name'),
    
    // Extracted from signature
    title: varchar('title', { length: 200 }),
    phone: varchar('phone', { length: 50 }),
    mobile: varchar('mobile', { length: 50 }),
    address: text('address'),
    website: varchar('website', { length: 500 }),
    linkedin: varchar('linkedin', { length: 500 }),
    x: varchar('x', { length: 200 }),
    linktree: varchar('linktree', { length: 500 }),

    // Tracking
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    index('idx_contacts_tenant_email').on(table.tenantId, table.email),
    index('idx_contacts_customer').on(table.customerId),
    index('idx_contacts_tenant_customer').on(table.tenantId, table.customerId),
    uniqueIndex('uniq_contacts_tenant_email').on(table.tenantId, table.email),
  ]
);

export type Contact = typeof contacts.$inferSelect;
export type NewContact = typeof contacts.$inferInsert;
