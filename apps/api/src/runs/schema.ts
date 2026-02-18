import { pgTable, text, timestamp, uuid, integer, pgEnum, index } from 'drizzle-orm/pg-core';
import { v7 as uuidv7 } from 'uuid';
import { z } from 'zod';
import { integrations } from '../integrations/schema';

export const runStatusEnum = pgEnum('run_status', ['running', 'completed', 'failed']);

export const runTypeEnum = pgEnum('run_type', [
  'initial',
  'incremental',
  'historical',
  'webhook',
]);

export const runs = pgTable(
  'runs',
  {
    id: uuid('id').primaryKey().$defaultFn(() => uuidv7()),

    // Link to specific integration
    integrationId: uuid('integration_id')
      .notNull()
      .references(() => integrations.id),
    tenantId: uuid('tenant_id').notNull(), // Denormalized for easier querying

    status: runStatusEnum('status').notNull(),
    runType: runTypeEnum('run_type').notNull(),

    // Generic metrics (emails, messages, events, etc.)
    itemsProcessed: integer('items_processed').default(0).notNull(),
    itemsInserted: integer('items_inserted').default(0).notNull(),
    itemsSkipped: integer('items_skipped').default(0).notNull(),

    // Token tracking
    startToken: text('start_token'), // Gmail historyId we started from
    endToken: text('end_token'), // Gmail historyId where we ended

    // Error tracking
    errorMessage: text('error_message'),
    errorStack: text('error_stack'),
    retryCount: integer('retry_count').default(0).notNull(),

    // Timing
    startedAt: timestamp('started_at').notNull().defaultNow(),
    completedAt: timestamp('completed_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    index('idx_runs_tenant_status').on(
      table.tenantId,
      table.status,
      table.startedAt
    ),
    index('idx_runs_integration_status').on(
      table.integrationId,
      table.status,
      table.startedAt
    ),
  ]
);

export type Run = typeof runs.$inferSelect;
export type NewRun = typeof runs.$inferInsert;
export type UpdateRun = Partial<Omit<NewRun, 'id' | 'integrationId' | 'tenantId' | 'runType' | 'createdAt'>>;
