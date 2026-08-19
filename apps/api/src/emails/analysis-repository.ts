import { injectable, inject } from 'tsyringe';
import type { Database, Transaction } from '@crm/database';
import { emailAnalyses, type AnalysisType, type NewEmailAnalysis } from './analysis-schema';
import { eq, and } from 'drizzle-orm';
import { logger } from '../utils/logger';

/**
 * model_used marker on rows created purely to hold a user suggestion (no AI ran).
 * Distinguishes them from real analyses in reporting.
 */
const USER_SUGGESTION_MODEL = 'user-suggestion';

@injectable()
export class EmailAnalysisRepository {
  constructor(@inject('Database') private db: Database) {}

  /**
   * Save or update analysis result for an email
   * Uses upsert pattern: insert if not exists, update if exists
   */
  async upsertAnalysis(analysis: NewEmailAnalysis): Promise<void> {
    await this.db
      .insert(emailAnalyses)
      .values(analysis)
      .onConflictDoUpdate({
        target: [emailAnalyses.emailId, emailAnalyses.analysisType],
        set: {
          result: analysis.result,
          confidence: analysis.confidence,
          detected: analysis.detected,
          riskLevel: analysis.riskLevel,
          urgency: analysis.urgency,
          sentimentValue: analysis.sentimentValue,
          modelUsed: analysis.modelUsed,
          reasoning: analysis.reasoning,
          promptTokens: analysis.promptTokens,
          completionTokens: analysis.completionTokens,
          totalTokens: analysis.totalTokens,
          updatedAt: new Date(),
        },
      });

    logger.debug(
      {
        emailId: analysis.emailId,
        analysisType: analysis.analysisType,
        hasConfidence: !!analysis.confidence,
        hasDetected: analysis.detected !== undefined,
      },
      'Analysis result saved/updated'
    );
  }

  /**
   * Save multiple analysis results for an email
   * @param analyses - Array of analyses to upsert
   * @param tx - Optional transaction context. If not provided, creates its own transaction.
   */
  async upsertAnalyses(analyses: NewEmailAnalysis[], tx?: Transaction): Promise<void> {
    if (analyses.length === 0) {
      return;
    }

    const doUpsert = async (db: Database | Transaction) => {
      for (const analysis of analyses) {
        await db
          .insert(emailAnalyses)
          .values(analysis)
          .onConflictDoUpdate({
            target: [emailAnalyses.emailId, emailAnalyses.analysisType],
            set: {
              result: analysis.result,
              confidence: analysis.confidence,
              detected: analysis.detected,
              riskLevel: analysis.riskLevel,
              urgency: analysis.urgency,
              sentimentValue: analysis.sentimentValue,
              modelUsed: analysis.modelUsed,
              reasoning: analysis.reasoning,
              promptTokens: analysis.promptTokens,
              completionTokens: analysis.completionTokens,
              totalTokens: analysis.totalTokens,
              updatedAt: new Date(),
            },
          });
      }
    };

    if (tx) {
      await doUpsert(tx);
    } else {
      await this.db.transaction(doUpsert);
    }

    logger.info(
      {
        emailId: analyses[0]?.emailId,
        count: analyses.length,
        types: analyses.map((a) => a.analysisType),
      },
      'Multiple analysis results saved/updated'
    );
  }

  /**
   * Persist a user's suggested tag onto the analysis row for `analysisType`,
   * writing ONLY the user_submitted_* column — the model's own verdict
   * (result / risk_level / sentiment_value / confidence) is never touched.
   *
   * When no row exists yet for that type (e.g. the message has a sentiment
   * analysis but was never scored for churn, and the user suggests a churn
   * level) we insert a suggestion-only row: `result` is `{}` and every
   * extracted column stays NULL, so existing readers — which all key off
   * detected / risk_level / sentiment_value — treat it as absent.
   *
   * @param value The suggested value, or null to clear a previous suggestion.
   */
  async upsertUserSubmission(
    emailId: string,
    tenantId: string,
    analysisType: Extract<AnalysisType, 'churn' | 'sentiment'>,
    value: string | null
  ): Promise<void> {
    const column =
      analysisType === 'churn'
        ? { userSubmittedRiskLevel: value }
        : { userSubmittedSentimentValue: value };

    await this.db
      .insert(emailAnalyses)
      .values({
        emailId,
        tenantId,
        analysisType,
        // Suggestion-only placeholder; `result` is NOT NULL in the schema.
        result: {} as NewEmailAnalysis['result'],
        modelUsed: USER_SUGGESTION_MODEL,
        ...column,
      })
      .onConflictDoUpdate({
        target: [emailAnalyses.emailId, emailAnalyses.analysisType],
        // Deliberately narrow: only the user column and updated_at.
        set: { ...column, updatedAt: new Date() },
      });

    logger.info({ emailId, tenantId, analysisType, value }, 'User-submitted analysis tag saved');
  }

  /**
   * Get analysis result for an email by type
   */
  async getAnalysis(
    emailId: string,
    analysisType: AnalysisType
  ): Promise<typeof emailAnalyses.$inferSelect | null> {
    const result = await this.db
      .select()
      .from(emailAnalyses)
      .where(
        and(
          eq(emailAnalyses.emailId, emailId),
          eq(emailAnalyses.analysisType, analysisType)
        )
      )
      .limit(1);

    return result[0] || null;
  }

  /**
   * Get all analysis results for an email
   */
  async getAnalysesByEmail(emailId: string): Promise<typeof emailAnalyses.$inferSelect[]> {
    return await this.db
      .select()
      .from(emailAnalyses)
      .where(eq(emailAnalyses.emailId, emailId));
  }

  /**
   * Get all analysis results for a tenant by type
   */
  async getAnalysesByTenantAndType(
    tenantId: string,
    analysisType: AnalysisType
  ): Promise<typeof emailAnalyses.$inferSelect[]> {
    return await this.db
      .select()
      .from(emailAnalyses)
      .where(
        and(
          eq(emailAnalyses.tenantId, tenantId),
          eq(emailAnalyses.analysisType, analysisType)
        )
      );
  }

  /**
   * Delete analysis result for an email by type
   */
  async deleteAnalysis(emailId: string, analysisType: AnalysisType): Promise<void> {
    await this.db
      .delete(emailAnalyses)
      .where(
        and(
          eq(emailAnalyses.emailId, emailId),
          eq(emailAnalyses.analysisType, analysisType)
        )
      );

    logger.debug({ emailId, analysisType }, 'Analysis result deleted');
  }
}
