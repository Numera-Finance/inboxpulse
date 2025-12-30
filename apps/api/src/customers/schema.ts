import { pgTable, text, timestamp, uuid, varchar, jsonb } from 'drizzle-orm/pg-core';
import { v7 as uuidv7 } from 'uuid';
import { tenants } from '../tenants/schema';
import { customerDomains } from './customer-domains-schema';

// Note: Database table is named 'customers' for backwards compatibility
export const customers = pgTable(
  'customers',
  {
    id: uuid('id').primaryKey().$defaultFn(() => uuidv7()),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),

    // Customer information
    name: text('name'), // Extracted from emails or manual entry
    website: text('website'),
    industry: varchar('industry', { length: 100 }),
    labels: jsonb('labels').$type<string[]>().default([]),

    // Metadata
    metadata: jsonb('metadata').$type<Record<string, any>>(),

    // Tracking
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  }
);

export type Customer = typeof customers.$inferSelect;
export type NewCustomer = typeof customers.$inferInsert;

// Re-export customer domains schema for repository use
export { customerDomains };
export type { CustomerDomain, NewCustomerDomain } from './customer-domains-schema';
