import { pgTable, uuid, integer, jsonb, text, timestamp, index } from 'drizzle-orm/pg-core';
import { v7 as uuidv7 } from 'uuid';
import { emails } from './schema';
import { tenants } from '../tenants/schema';

/**
 * Email signal overrides table
 *
 * Audit + learning log: one row per manual correction of an email's signals
 * (sentiment / churn / tags). Captures the model's original signals (`previousSignals`)
 * alongside the human-corrected signals (`newSignals`), plus an optional reason and a
 * snapshot of the analysis output at edit time.
 *
 * This is intentionally append-only. It is the labelled dataset used to measure and
 * improve the analysis prompts: (email content) + (model verdict) + (human correction)
 * + (why). The live display value lives on `emails.signals`; this table is history.
 */
export const emailSignalOverrides = pgTable(
  'email_signal_overrides',
  {
    id: uuid('id').primaryKey().$defaultFn(() => uuidv7()),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    emailId: uuid('email_id').notNull().references(() => emails.id, { onDelete: 'cascade' }),

    // Signals the analysis pipeline produced, captured just before the override.
    previousSignals: integer('previous_signals').array().notNull().default([]),
    // Signals the user chose (the new source of truth on emails.signals).
    newSignals: integer('new_signals').array().notNull().default([]),

    // Optional free-text reason the user gave for the correction — the most
    // valuable field for diagnosing why the model was wrong.
    reason: text('reason'),

    // Snapshot of the email_analyses reasoning/confidence at edit time, so a
    // correction can be correlated to the exact model output that produced it.
    analysisSnapshot: jsonb('analysis_snapshot').$type<Record<string, unknown>>(),

    // Who made the correction.
    editedByUserId: uuid('edited_by_user_id').notNull(),

    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    index('idx_email_signal_overrides_email').on(table.emailId),
    index('idx_email_signal_overrides_tenant_created').on(table.tenantId, table.createdAt),
  ]
);

export type EmailSignalOverride = typeof emailSignalOverrides.$inferSelect;
export type NewEmailSignalOverride = typeof emailSignalOverrides.$inferInsert;
