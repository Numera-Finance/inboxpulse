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
