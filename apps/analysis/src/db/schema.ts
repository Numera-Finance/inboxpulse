import { pgTable, text, uuid, jsonb, timestamp, primaryKey } from 'drizzle-orm/pg-core';

/**
 * Analysis cache table
 * Stores LLM analysis results to avoid re-processing on retries
 * TTL: 7 days (enforced on read + lazy cleanup)
 */
export const analysisCache = pgTable('analysis_cache', {
  messageId: text('message_id').notNull(),
  modelId: text('model_id').notNull(),
  tenantId: uuid('tenant_id').notNull(),
  results: jsonb('results').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.messageId, table.modelId] }),
]);

export type AnalysisCacheRecord = typeof analysisCache.$inferSelect;
export type NewAnalysisCacheRecord = typeof analysisCache.$inferInsert;
