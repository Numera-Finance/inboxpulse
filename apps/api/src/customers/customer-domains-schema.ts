import { pgTable, text, timestamp, uuid, varchar, boolean, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { v7 as uuidv7 } from 'uuid';
import { tenants } from '../tenants/schema';

/**
 * Customer Domains table
 * Supports multiple domains per customer (for future customer merging)
 * Each domain is unique across all customers (within a tenant)
 * Note: Database table is named 'customer_domains' for backwards compatibility
 */
export const customerDomains = pgTable(
  'customer_domains',
  {
    id: uuid('id').primaryKey().$defaultFn(() => uuidv7()),
    customerId: uuid('customer_id').notNull(), // References customers table, column named customer_id for backwards compatibility
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),

    // Domain stored in lowercase for consistency.
    // Widened to 320 to fit personal-email pseudo-domains
    // (`<local>-<provider>.tld`, up to 64+1+253 chars per RFC 5321).
    domain: varchar('domain', { length: 320 }).notNull(),

    // Metadata
    verified: boolean('verified').notNull().default(false), // Whether domain is verified

    // Tracking
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    // Each domain must be unique per tenant
    uniqueIndex('uniq_customer_domains_tenant_domain').on(table.tenantId, table.domain),
    index('idx_customer_domains_customer_id').on(table.customerId),
    index('idx_customer_domains_tenant_domain').on(table.tenantId, table.domain),
  ]
);

export type CustomerDomain = typeof customerDomains.$inferSelect;
export type NewCustomerDomain = typeof customerDomains.$inferInsert;
