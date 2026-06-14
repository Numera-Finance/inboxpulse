import { z } from 'zod';

/**
 * Signal filter values for analyzed email search
 */
export type AnalyzedEmailSignalFilter = 'positive' | 'negative' | 'neutral' | 'upsell' | 'churn' | 'tat' | 'all';

/**
 * Search request for analyzed emails
 */
export const analyzedEmailSearchRequestSchema = z.object({
  signal: z.enum(['positive', 'negative', 'neutral', 'upsell', 'churn', 'tat', 'all']).optional(),
  status: z.enum(['open', 'done', 'all']).optional(),
  assignedToId: z.string().optional(),
  customerId: z.string().uuid().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  search: z.string().optional(),
  sortBy: z.enum(['receivedAt', 'createdAt']).optional(),
  sortOrder: z.enum(['asc', 'desc']).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

export type AnalyzedEmailSearchRequest = z.infer<typeof analyzedEmailSearchRequestSchema>;

/**
 * Analyzed email response - email with optional task overlay
 */
export const analyzedEmailSchema = z.object({
  // Email fields
  id: z.string().uuid(),
  subject: z.string(),
  body: z.string().nullable(),
  fromEmail: z.string(),
  fromName: z.string().nullable(),
  receivedAt: z.coerce.date(),
  signals: z.array(z.number()).default([]),

  // Customer (from email_participants)
  customerId: z.string().uuid(),
  customerName: z.string().nullable(),

  // Task overlay (NULL when no task exists for this email)
  taskId: z.string().uuid().nullable(),
  taskStatus: z.number().nullable(),
  assignedToId: z.string().uuid().nullable(),
  assignedToName: z.string().nullable(),
  assignedToEmail: z.string().nullable(),
  problem: z.string().nullable(),
  resolution: z.string().nullable(),
  completedAt: z.coerce.date().nullable(),
  completedById: z.string().uuid().nullable(),
  completedByName: z.string().nullable(),
  taskCreatedAt: z.coerce.date().nullable(),
});

export type AnalyzedEmail = z.infer<typeof analyzedEmailSchema>;

/**
 * Search response for analyzed emails
 */
export interface AnalyzedEmailSearchResponse {
  items: AnalyzedEmail[];
  total: number;
  limit: number;
  offset: number;
}

/**
 * Export item for analyzed emails - includes comments and contact roles
 */
export const analyzedEmailExportItemSchema = z.object({
  ...analyzedEmailSchema.shape,
  comments: z.array(z.object({
    userName: z.string(),
    content: z.string(),
    createdAt: z.coerce.date(),
  })).default([]),
  contactRoles: z.object({
    bookKeeping: z.string(),
    accountant: z.string(),
    controller: z.string(),
    srController: z.string(),
  }),
});

export type AnalyzedEmailExportItem = z.infer<typeof analyzedEmailExportItemSchema>;

/**
 * First-reply marker — a header-only signal that the company replied in a thread.
 *
 * Emitted by the Gmail sync for outbound/reply messages it drops at the
 * domain-blacklist stage (tenant-domain senders are never stored or analyzed).
 * We forward just enough metadata for the API to apply the same reply rules as
 * the full-email path (isReplyEmail + isCountableReply) and set first_reply_at
 * on the customer email being answered — without ever fetching the body.
 */
export const firstReplyMarkerSchema = z.object({
  /** Provider's thread id (Gmail threadId) = email_threads.provider_thread_id */
  providerThreadId: z.string().min(1),
  /** Reply sender address (expected to be on a tenant domain) */
  fromEmail: z.string().min(1),
  /** Recipients — used to require an external (customer) recipient */
  tos: z.array(z.object({ email: z.string(), name: z.string().optional() })).default([]),
  ccs: z.array(z.object({ email: z.string(), name: z.string().optional() })).default([]),
  /** Gmail labels (e.g. SENT) */
  labels: z.array(z.string()).default([]),
  /** Reply timestamp (Gmail internalDate), ISO string */
  receivedAt: z.string().min(1),
  /** RFC 3834 Auto-Submitted header value, if present (filters auto-replies) */
  autoSubmitted: z.string().nullable().optional(),
  /** Precedence header value, if present (filters bulk/auto mail) */
  precedence: z.string().nullable().optional(),
});

export type FirstReplyMarker = z.infer<typeof firstReplyMarkerSchema>;

/**
 * Request body for POST /api/internal/emails/first-reply-markers
 */
export const firstReplyMarkersRequestSchema = z.object({
  tenantId: z.string().uuid(),
  integrationId: z.string().uuid(),
  markers: z.array(firstReplyMarkerSchema).default([]),
});

export type FirstReplyMarkersRequest = z.infer<typeof firstReplyMarkersRequestSchema>;
