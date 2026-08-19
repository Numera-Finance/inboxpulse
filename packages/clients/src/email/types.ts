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
 * A single email address with an optional display name, as stored in the
 * `tos`/`ccs`/`bccs` JSONB columns on `emails`.
 */
export const emailAddressSchema = z.object({
  email: z.string(),
  name: z.string().optional(),
});

export type EmailAddress = z.infer<typeof emailAddressSchema>;

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
  // Recipients as received on the message headers. Empty arrays when the
  // provider gave us no To/Cc (rather than absent) so the UI can render
  // unconditionally.
  tos: z.array(emailAddressSchema).default([]),
  ccs: z.array(emailAddressSchema).default([]),
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
 * Row shape for the analyzed-email list. Recipients are omitted: the list
 * renders sender/subject/status only, and the detail view fetches its own row
 * via `getAnalyzedById`, so carrying them would be dead payload on every page.
 */
export type AnalyzedEmailListItem = Omit<AnalyzedEmail, 'tos' | 'ccs'>;

/**
 * Search response for analyzed emails
 */
export interface AnalyzedEmailSearchResponse {
  items: AnalyzedEmailListItem[];
  total: number;
  limit: number;
  offset: number;
}

/**
 * Export item for analyzed emails - includes comments and contact roles
 */
export const analyzedEmailExportItemSchema = z.object({
  // Recipients are deliberately absent: the XLSX builder maps a fixed column
  // list with no To/Cc columns, so carrying them would be dead weight on an
  // unpaginated export.
  ...analyzedEmailSchema.omit({ tos: true, ccs: true }).shape,
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
 * Request body for PATCH /api/emails/:emailId/signals — a manual correction of
 * an email's signals (sentiment / churn / tags). `signals` is the full desired
 * set of Signal integers (see @crm/shared Signal constants); it replaces the
 * existing set. `reason` is an optional note on why the correction was made.
 */
export const updateEmailSignalsRequestSchema = z.object({
  signals: z.array(z.number().int()).max(20),
  reason: z.string().trim().max(1000).optional(),
});

export type UpdateEmailSignalsRequest = z.infer<typeof updateEmailSignalsRequestSchema>;

/**
 * Response for a signal override — the persisted signals and the lock flag.
 */
export const updateEmailSignalsResponseSchema = z.object({
  emailId: z.string().uuid(),
  signals: z.array(z.number()).default([]),
  signalsOverridden: z.boolean(),
});

export type UpdateEmailSignalsResponse = z.infer<typeof updateEmailSignalsResponseSchema>;

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
  tos: z.array(emailAddressSchema).default([]),
  ccs: z.array(emailAddressSchema).default([]),
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

// ---------------------------------------------------------------------------
// User-submitted tag suggestions (Gmail extension → email_analyses)
// ---------------------------------------------------------------------------

/** Churn risk levels a user can suggest — mirrors the churn analysis result. */
export const userSubmittedRiskLevelSchema = z.enum(['low', 'medium', 'high', 'critical']);
export type UserSubmittedRiskLevel = z.infer<typeof userSubmittedRiskLevelSchema>;

/** Sentiment values a user can suggest — mirrors the sentiment analysis result. */
export const userSubmittedSentimentSchema = z.enum(['positive', 'negative', 'neutral']);
export type UserSubmittedSentiment = z.infer<typeof userSubmittedSentimentSchema>;

/**
 * Request body for POST /api/emails/tag-suggestion (and the internal mount).
 *
 * Identifies the message the way the Gmail surfaces already do — by provider
 * message id, since neither the extension nor the add-on knows our email UUID.
 * At least one of `riskLevel` / `sentimentValue` must be present; `null` clears
 * a previously submitted suggestion, `undefined` (omitted) leaves it untouched.
 */
export const submitTagSuggestionRequestSchema = z
  .object({
    /** Provider (Gmail) message id of the message being re-tagged. */
    messageId: z.string().min(1).max(500),
    /** Defaults to 'gmail' server-side when omitted. */
    provider: z.string().min(1).max(50).optional(),
    /** Suggested churn risk → email_analyses.user_submitted_risk_level. */
    riskLevel: userSubmittedRiskLevelSchema.nullish(),
    /** Suggested sentiment → email_analyses.user_submitted_sentiment_value. */
    sentimentValue: userSubmittedSentimentSchema.nullish(),
  })
  .refine((v) => v.riskLevel !== undefined || v.sentimentValue !== undefined, {
    message: 'At least one of riskLevel or sentimentValue must be provided',
  });

export type SubmitTagSuggestionRequest = z.infer<typeof submitTagSuggestionRequestSchema>;

/** What was persisted, echoed back so the UI can render the saved state. */
export const submitTagSuggestionResponseSchema = z.object({
  emailId: z.string().uuid(),
  messageId: z.string(),
  /** Suggestion now stored on the churn row (null = none). */
  userSubmittedRiskLevel: userSubmittedRiskLevelSchema.nullable(),
  /** Suggestion now stored on the sentiment row (null = none). */
  userSubmittedSentimentValue: userSubmittedSentimentSchema.nullable(),
});

export type SubmitTagSuggestionResponse = z.infer<typeof submitTagSuggestionResponseSchema>;

/* ------------------------------------------------------------------------- *
 * Thread view — the whole conversation, so a reader can triage it
 *
 * A single message with no recipients answers none of the questions triage
 * actually asks: who is on this, whose turn is it, and how long has it sat.
 * `analyzedEmailSchema` carries only `fromEmail`, which is why the detail
 * panel's "To:" line rendered empty — there was never a field behind it.
 * ------------------------------------------------------------------------- */

/**
 * One address on a message.
 *
 * `isStaff` mirrors `email_participants.participant_type = 'user'`. It is the
 * single most useful bit on this object: "who is us and who is them" is the
 * first thing a reader needs and the slowest thing to work out by squinting at
 * domains.
 */
export const threadParticipantSchema = z.object({
  email: z.string(),
  name: z.string().nullable(),
  isStaff: z.boolean(),
});

export type ThreadParticipant = z.infer<typeof threadParticipantSchema>;

/** One message in the conversation, with everyone it was addressed to. */
export const threadMessageSchema = z.object({
  id: z.string().uuid(),
  subject: z.string(),
  receivedAt: z.coerce.date(),
  from: threadParticipantSchema,
  to: z.array(threadParticipantSchema).default([]),
  cc: z.array(threadParticipantSchema).default([]),
  /** First ~200 chars of the body, for the timeline rail. */
  snippet: z.string(),
  /** True for the message the reader opened, so the rail can mark it. */
  isFocused: z.boolean(),
  /** True when nobody from the firm is on `from` — i.e. they wrote, not us. */
  inbound: z.boolean(),
  /** Hours since the previous message. Null on the first. The gap is the story. */
  hoursSincePrevious: z.number().nullable(),
});

export type ThreadMessage = z.infer<typeof threadMessageSchema>;

export const emailThreadSchema = z.object({
  threadId: z.string().nullable(),
  messages: z.array(threadMessageSchema),
});

export type EmailThread = z.infer<typeof emailThreadSchema>;
