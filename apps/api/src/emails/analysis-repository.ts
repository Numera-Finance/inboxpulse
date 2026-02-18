import { injectable, inject } from 'tsyringe';
import type { Database, Transaction } from '@crm/database';
import { emailAnalyses, type AnalysisType, type NewEmailAnalysis } from './analysis-schema';
import { eq, and } from 'drizzle-orm';
import { logger } from '../utils/logger';

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
