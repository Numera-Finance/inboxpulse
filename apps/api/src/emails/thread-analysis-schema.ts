import { pgTable, text, timestamp, uuid, integer, jsonb, varchar, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { v7 as uuidv7 } from 'uuid';
import { emailThreads } from './schema';
import { tenants } from '../tenants/schema';
import { emails } from './schema';

/**
 * Thread analyses table
 * Stores thread-level summaries for each analysis type
 * Acts as "memory" for the conversation, used as context for new email analysis
 */
export const threadAnalyses = pgTable(
  'thread_analyses',
  {
    id: uuid('id').primaryKey().$defaultFn(() => uuidv7()),
    threadId: uuid('thread_id').notNull().references(() => emailThreads.id, { onDelete: 'cascade' }),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),

    // Analysis type (sentiment, escalation, churn, etc.)
    analysisType: varchar('analysis_type', { length: 50 }).notNull(),

    // Thread summary for this analysis type
    summary: text('summary').notNull(), // LLM-generated summary of thread for this analysis type

    // Analysis metadata
    lastAnalyzedEmailId: uuid('last_analyzed_email_id').references(() => emails.id),
    lastAnalyzedAt: timestamp('last_analyzed_at').notNull().defaultNow(),

    // Model and version used for summary
    modelUsed: varchar('model_used', { length: 100 }),
    summaryVersion: varchar('summary_version', { length: 20 }).default('v1.0'),

    // Token usage tracking
    promptTokens: integer('prompt_tokens'),
    completionTokens: integer('completion_tokens'),
    totalTokens: integer('total_tokens'),

    // Metadata
    metadata: jsonb('metadata').$type<Record<string, any>>(),

    // Tracking
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    index('idx_thread_analyses_thread').on(table.threadId),
    index('idx_thread_analyses_tenant_type').on(table.tenantId, table.analysisType),
    index('idx_thread_analyses_last_analyzed').on(table.lastAnalyzedAt),
    index('idx_thread_analyses_thread_type').on(table.threadId, table.analysisType),
    uniqueIndex('uniq_thread_analysis_type').on(table.threadId, table.analysisType),
  ]
);

export type ThreadAnalysis = typeof threadAnalyses.$inferSelect;
export type NewThreadAnalysis = typeof threadAnalyses.$inferInsert;
