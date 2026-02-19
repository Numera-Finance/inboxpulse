import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { tenants } from '../tenants/schema';

export const analysisKeywords = pgTable(
  'analysis_keywords',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    category: varchar('category', { length: 50 }).notNull(),
    keywords: text('keywords').notNull().default(''),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('idx_analysis_keywords_tenant').on(table.tenantId),
    uniqueIndex('uniq_analysis_keywords_tenant_category').on(
      table.tenantId,
      table.category
    ),
  ]
);

export type AnalysisKeyword = typeof analysisKeywords.$inferSelect;
export type NewAnalysisKeyword = typeof analysisKeywords.$inferInsert;
