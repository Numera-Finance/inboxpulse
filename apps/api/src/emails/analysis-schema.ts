import { pgTable, text, timestamp, uuid, integer, jsonb, varchar, decimal, boolean, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { v7 as uuidv7 } from 'uuid';
import { emails } from './schema';
import { tenants } from '../tenants/schema';

/**
 * Analysis type enum - all possible analysis types
 */
export type AnalysisType =
  | 'sentiment'
  | 'escalation'
  | 'upsell'
  | 'churn'
  | 'kudos'
  | 'competitor'
  | 'signature-extraction'
  | 'context-search-string';

/**
 * Union type for all analysis result structures
 * This matches the schemas defined in apps/analysis/src/analyses/schemas.ts
 */
export type AnalysisResult =
  | {
      // Sentiment
      value: 'positive' | 'negative' | 'neutral';
      confidence: number;
      reason?: string;
      /**
       * Who the sentiment is aimed at. Absent on keyword-matched results,
       * which assert a sentiment value without establishing a target.
       */
      target?: 'us' | 'third_party' | 'none';
    }
  | {
      // Escalation
      detected: boolean;
      confidence: number;
      reason?: string;
      urgency?: 'low' | 'medium' | 'high' | 'critical';
    }
  | {
      // Upsell
      detected: boolean;
      confidence: number;
      opportunity?: string;
      product?: string;
    }
  | {
      // Churn
      riskLevel: 'low' | 'medium' | 'high' | 'critical';
      confidence: number;
      indicators: string[];
      reason?: string;
    }
  | {
      // Kudos
      detected: boolean;
      confidence: number;
      message?: string;
      category?: 'product' | 'service' | 'team' | 'other';
    }
  | {
      // Competitor
      detected: boolean;
      confidence: number;
      competitors?: string[];
      context?: string;
    }
  | {
      // Signature
      name?: string;
      title?: string;
      company?: string;
      email?: string;
      phone?: string;
      mobile?: string;
      address?: string;
      website?: string;
      linkedin?: string;
      twitter?: string;
    }
  | {
      // Context search string
      intent: string;
      query: string;
      confidence: number;
    };

/**
 * Email analyses table
 * Stores analysis results for individual emails
 * Each email can have multiple analysis results (one per analysis type)
 */
export const emailAnalyses = pgTable(
  'email_analyses',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),

    // Foreign keys
    emailId: uuid('email_id')
      .notNull()
      .references(() => emails.id, { onDelete: 'cascade' }),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),

    // Analysis type and result
    analysisType: varchar('analysis_type', { length: 50 }).notNull(), // 'sentiment', 'escalation', etc.
    result: jsonb('result').$type<AnalysisResult>().notNull(), // The analysis result (validated by schema)

    // Extracted fields for indexing and querying
    // These fields are extracted from the result JSONB for efficient querying
    // Not all fields apply to all analysis types (NULL when not applicable)
    confidence: decimal('confidence', { precision: 3, scale: 2 }), // Extracted from result (0.00-1.00) - applies to all types
    detected: boolean('detected'), // For escalation, upsell, kudos, competitor (NULL for sentiment, churn)
    riskLevel: varchar('risk_level', { length: 20 }), // For churn: 'low' | 'medium' | 'high' | 'critical' (NULL for others)
    urgency: varchar('urgency', { length: 20 }), // For escalation: 'low' | 'medium' | 'high' | 'critical' (NULL for others)
    sentimentValue: varchar('sentiment_value', { length: 20 }), // For sentiment: 'positive' | 'negative' | 'neutral' (NULL for others)
    // For sentiment: 'us' | 'third_party' | 'none' — who the sentiment is aimed
    // at. NULL for other analysis types, and for keyword-matched sentiment
    // (which sets a value without establishing a target).
    sentimentTarget: varchar('sentiment_target', { length: 20 }),

    // User-submitted corrections. A human reviewing the message in Gmail can
    // suggest an alternative tag; it lands here instead of overwriting the
    // model's verdict above, so the two stay comparable. The analysis pipeline
    // never writes these (see analysis-repository.upsertAnalysis's update set).
    userSubmittedRiskLevel: varchar('user_submitted_risk_level', { length: 20 }), // For churn
    userSubmittedSentimentValue: varchar('user_submitted_sentiment_value', { length: 20 }), // For sentiment

    // Metadata
    modelUsed: varchar('model_used', { length: 100 }), // Which model was used (primary or fallback)
    reasoning: text('reasoning'), // LLM reasoning/thinking steps if available

    // Token usage tracking
    promptTokens: integer('prompt_tokens'),
    completionTokens: integer('completion_tokens'),
    totalTokens: integer('total_tokens'),

    // Timestamps
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    // Unique constraint: one analysis result per email per analysis type
    uniqueIndex('uniq_email_analysis_type').on(
      table.emailId,
      table.analysisType
    ),

    // Indexes for common queries
    index('idx_email_analyses_email').on(table.emailId),
    index('idx_email_analyses_tenant').on(table.tenantId),
    index('idx_email_analyses_type').on(table.analysisType),
    index('idx_email_analyses_confidence').on(table.confidence),
    index('idx_email_analyses_detected').on(table.detected), // For escalation, upsell, kudos, competitor
    index('idx_email_analyses_risk_level').on(table.riskLevel), // For churn
    index('idx_email_analyses_urgency').on(table.urgency), // For escalation
    index('idx_email_analyses_sentiment_value').on(table.sentimentValue), // For sentiment
    // Sentiment attribution: filtering "negative AND aimed at us" is the main
    // consumer (escalation creation, dashboards), so index the pair.
    index('idx_email_analyses_sentiment_value_target').on(
      table.sentimentValue,
      table.sentimentTarget
    ),
    index('idx_email_analyses_tenant_type').on(table.tenantId, table.analysisType),
    index('idx_email_analyses_tenant_type_detected').on(
      table.tenantId,
      table.analysisType,
      table.detected
    ), // For querying detected escalations/upsells/etc.
    index('idx_email_analyses_tenant_type_risk').on(
      table.tenantId,
      table.analysisType,
      table.riskLevel
    ), // For querying churn risk
    index('idx_email_analyses_created_at').on(table.createdAt),
    // Partial in SQL (WHERE ... IS NOT NULL) — Drizzle records the column only.
    index('idx_email_analyses_user_submitted_risk_level').on(table.userSubmittedRiskLevel),
    index('idx_email_analyses_user_submitted_sentiment_value').on(table.userSubmittedSentimentValue),
  ]
);

export type EmailAnalysis = typeof emailAnalyses.$inferSelect;
export type NewEmailAnalysis = typeof emailAnalyses.$inferInsert;
