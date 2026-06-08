import { pgTable, text, timestamp, uuid, integer, jsonb, varchar, decimal, smallint, boolean, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { v7 as uuidv7 } from 'uuid';
import { tenants } from '../tenants/schema';
import { integrations } from '../integrations/schema';

/**
 * Email analysis status enum
 * Using SMALLINT for better database performance
 */
export enum EmailAnalysisStatus {
  Pending = 1,
  Processing = 2,
  Completed = 3,
  Failed = 4,
}

// Email threads table
export const emailThreads = pgTable('email_threads', {
  id: uuid('id').primaryKey().$defaultFn(() => uuidv7()),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),

  // Provider info (provider can be derived from integration_id via integrations table)
  integrationId: uuid('integration_id').notNull().references(() => integrations.id),
  providerThreadId: varchar('provider_thread_id', { length: 500 }).notNull(), // provider's thread identifier

  // Thread metadata
  subject: text('subject').notNull(),

  // Timestamps
  firstMessageAt: timestamp('first_message_at').notNull(),
  lastMessageAt: timestamp('last_message_at').notNull(),

  // Provider-specific data
  metadata: jsonb('metadata').$type<Record<string, any>>(),

  // Tracking
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => [
  index('idx_threads_tenant_last_message').on(table.tenantId, table.lastMessageAt),
  index('idx_threads_integration_thread').on(table.integrationId, table.providerThreadId),
  index('idx_threads_integration').on(table.integrationId),
  uniqueIndex('uniq_thread_tenant_integration').on(
    table.tenantId,
    table.integrationId,
    table.providerThreadId
  ),
]);

export type EmailThread = typeof emailThreads.$inferSelect;
export type NewEmailThread = typeof emailThreads.$inferInsert;

// Emails table
export const emails = pgTable('emails', {
  id: uuid('id').primaryKey().$defaultFn(() => uuidv7()),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  threadId: uuid('thread_id').notNull().references(() => emailThreads.id, { onDelete: 'cascade' }),

  // Provider identifiers
  integrationId: uuid('integration_id').references(() => integrations.id),
  provider: varchar('provider', { length: 50 }).notNull(), // 'gmail', 'outlook', etc.
  messageId: varchar('message_id', { length: 500 }).notNull(), // provider's unique message ID

  // Email content
  subject: text('subject').notNull(),
  body: text('body'),

  // Sender
  fromEmail: varchar('from_email', { length: 500 }).notNull(),
  fromName: varchar('from_name', { length: 500 }),

  // Recipients (arrays of objects: [{email, name}])
  tos: jsonb('tos').$type<Array<{ email: string; name?: string }>>(),
  ccs: jsonb('ccs').$type<Array<{ email: string; name?: string }>>(),
  bccs: jsonb('bccs').$type<Array<{ email: string; name?: string }>>(),

  // Metadata
  priority: varchar('priority', { length: 20 }).notNull().default('normal'),
  labels: text('labels').array(),
  receivedAt: timestamp('received_at').notNull(),

  // Provider-specific data (store Gmail labels, Outlook categories, etc.)
  metadata: jsonb('metadata').$type<Record<string, any>>(),

  // Deduplication fields (for detecting forwarded copies of the same email)
  rfcMessageId: varchar('rfc_message_id', { length: 500 }),  // RFC 2822 Message-ID header
  contentHash: varchar('content_hash', { length: 64 }),       // SHA-256 hex of email content

  // Analysis signals (computed async) - array of Signal integers
  // See @crm/shared Signal constants for values (e.g., Signal.SENTIMENT_POSITIVE = 1)
  signals: integer('signals').array().default([]),
  analysisStatus: smallint('analysis_status'), // 1=pending, 2=processing, 3=completed, 4=failed

  // TAT (Turn Around Time) tracking - populated for customer emails
  // isCustomerEmail: true if email is from customer (fromEmail domain != tenant domain)
  // Set during email ingestion to avoid expensive domain matching in queries
  isCustomerEmail: boolean('is_customer_email'),

  // firstReplyEmailId: ID of the first reply email from tenant domain
  // firstReplyAt: Timestamp when the first reply was sent
  // These are populated during email sync when a reply is detected
  firstReplyEmailId: uuid('first_reply_email_id'),
  firstReplyAt: timestamp('first_reply_at'),

  // Tracking
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => [
  index('idx_emails_tenant_received').on(table.tenantId, table.receivedAt),
  index('idx_emails_thread').on(table.threadId, table.receivedAt),
  index('idx_emails_from').on(table.tenantId, table.fromEmail),
  index('idx_emails_provider_message').on(table.provider, table.messageId),
  index('idx_emails_integration').on(table.integrationId),
  uniqueIndex('uniq_emails_tenant_provider_message').on(
    table.tenantId,
    table.provider,
    table.messageId
  ),
  // Index for TAT metrics queries (customer emails only)
  index('idx_emails_tenant_customer').on(table.tenantId, table.isCustomerEmail),
  // Dedup indexes
  index('idx_emails_rfc_message_id').on(table.tenantId, table.rfcMessageId),
  index('idx_emails_content_hash').on(table.tenantId, table.contentHash),
  // GIN index for efficient array containment queries: WHERE signals @> ARRAY[1]
  // Note: Drizzle doesn't support GIN indexes directly, add via SQL migration
]);

export type Email = typeof emails.$inferSelect;
export type NewEmail = typeof emails.$inferInsert;

// Re-export analysis schema types
export type { AnalysisType, AnalysisResult, EmailAnalysis, NewEmailAnalysis } from './analysis-schema';
export { emailAnalyses } from './analysis-schema';

// Re-export thread analysis schema types
export type { ThreadAnalysis, NewThreadAnalysis } from './thread-analysis-schema';
export { threadAnalyses } from './thread-analysis-schema';

// Re-export email participants schema types
export type { EmailParticipant, NewEmailParticipant } from './email-participants-schema';
export { emailParticipants, participantTypeEnum, emailDirectionEnum } from './email-participants-schema';

// Re-export Database type
export type { Database } from '@crm/database';
