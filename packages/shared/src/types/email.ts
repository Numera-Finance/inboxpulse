import { z } from 'zod';

/**
 * Provider-agnostic email types
 * Each email provider (Gmail, Outlook, etc.) will normalize their data to these types
 */

export const emailProviderSchema = z.enum(['gmail', 'outlook', 'slack', 'other']);
export type EmailProvider = z.infer<typeof emailProviderSchema>;

export const emailPrioritySchema = z.enum(['high', 'normal', 'low']);
export type EmailPriority = z.infer<typeof emailPrioritySchema>;

export const emailSentimentSchema = z.enum(['positive', 'negative', 'neutral']);
export type EmailSentiment = z.infer<typeof emailSentimentSchema>;

// More permissive email validation that accepts real-world email formats
// Zod's built-in .email() is too strict and rejects some valid RFC-compliant emails
const permissiveEmailSchema = z.string().refine(
  (val) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val) || val.includes('@'),
  { message: 'Invalid email address' }
);

export const emailAddressSchema = z.object({
  email: permissiveEmailSchema,
  name: z.string().optional(),
});
export type EmailAddress = z.infer<typeof emailAddressSchema>;

/**
 * Email message structure
 * This is what each provider should convert their messages to
 */
export const emailSchema = z.object({
  // Provider identifiers
  provider: emailProviderSchema,
  messageId: z.string().min(1), // Provider's unique message ID
  threadId: z.string().min(1), // Provider's thread ID

  // Email content
  subject: z.string().min(1),
  body: z.string().optional(),

  // Extracted signature (populated by extraction service before analysis)
  // Only set if signature has analyzable content (phone, title, company, etc.)
  signature: z.string().optional(),

  // Sender
  from: emailAddressSchema,

  // Recipients
  tos: z.array(emailAddressSchema).min(1),
  ccs: z.array(emailAddressSchema).optional(),
  bccs: z.array(emailAddressSchema).optional(),

  // Metadata
  priority: emailPrioritySchema.optional(),
  labels: z.array(z.string()).optional(),
  receivedAt: z.coerce.date(), // Accepts Date objects or ISO date strings

  // Provider-specific data (store Gmail labels, Outlook categories, etc.)
  metadata: z.record(z.string(), z.any()).optional(),
});
export type Email = z.infer<typeof emailSchema>;

/**
 * Email thread structure
 */
export const emailThreadSchema = z.object({
  // Provider identifiers
  provider: emailProviderSchema,
  threadId: z.string().min(1), // Provider's thread ID

  // Thread metadata
  subject: z.string().min(1),
  firstMessageAt: z.coerce.date(), // Accepts Date objects or ISO date strings
  lastMessageAt: z.coerce.date(), // Accepts Date objects or ISO date strings
  messageCount: z.number().int().min(1),

  // Provider-specific data
  metadata: z.record(z.string(), z.any()).optional(),
});
export type EmailThread = z.infer<typeof emailThreadSchema>;

/**
 * Collection of emails grouped by thread
 * This is what each provider should return when parsing messages
 */
export const emailCollectionSchema = z.object({
  thread: emailThreadSchema,
  emails: z.array(emailSchema).min(1),
});
export type EmailCollection = z.infer<typeof emailCollectionSchema>;

/**
 * TAT (Turn Around Time) metric row for dashboard
 * Represents SLA breach counts for a customer-controller pair
 */
export const tatMetricRowSchema = z.object({
  customerId: z.string().uuid(),
  customerName: z.string(),
  controllerId: z.string().uuid().nullable(),
  controllerName: z.string().nullable(),
  onePlusDays: z.number().int().min(0),
  twoPlusDays: z.number().int().min(0),
  threePlusDays: z.number().int().min(0),
  fivePlusDays: z.number().int().min(0),
  sixPlusDays: z.number().int().min(0),
});
export type TATMetricRow = z.infer<typeof tatMetricRowSchema>;
