import { injectable, inject } from 'tsyringe';
import { AnalysisClient } from '@crm/clients';
import { ThreadAnalysisRepository } from './thread-analysis-repository';
import type { Email } from '@crm/shared';
import type { AnalysisType } from '@crm/shared';
import { logger } from '../utils/logger';

export interface ThreadSummaryContext {
  summaries: Array<{
    analysisType: string;
    summary: string;
    lastAnalyzedAt: Date;
  }>;
  contextString: string; // Formatted string to use as threadContext
}

/**
 * Thread Analysis Service
 * Generates and maintains thread-level summaries that act as "memory" for conversations
 */
@injectable()
export class ThreadAnalysisService {
  constructor(
    @inject(AnalysisClient) private analysisClient: AnalysisClient,
    private threadAnalysisRepo: ThreadAnalysisRepository
  ) { }

  /**
   * Get thread summaries for use as context
   * Returns formatted context string ready to pass to analysis service
   * Special handling: prioritizes sentiment summary when analyzing sentiment
   */
  async getThreadContext(threadId: string, forAnalysisType?: AnalysisType): Promise<ThreadSummaryContext> {
    const analyses = await this.threadAnalysisRepo.getByThread(threadId);

    // If requesting context for sentiment analysis, prioritize sentiment summary
    let summaries = analyses.map((a) => ({
      analysisType: a.analysisType,
      summary: a.summary,
      lastAnalyzedAt: a.lastAnalyzedAt,
      metadata: a.metadata, // Include metadata for sentiment score extraction
    }));

    // Sort: if sentiment analysis, put sentiment summary first
    if (forAnalysisType === 'sentiment') {
      summaries = summaries.sort((a, b) => {
        if (a.analysisType === 'sentiment') return -1;
        if (b.analysisType === 'sentiment') return 1;
        return 0;
      });
    }

    const contextString = this.buildContextFromSummaries(summaries, forAnalysisType);

    return {
      summaries: summaries.map((s) => ({
        analysisType: s.analysisType,
        summary: s.summary,
        lastAnalyzedAt: s.lastAnalyzedAt,
      })),
      contextString,
    };
  }

  /**
   * Build context string from thread summaries
   * Enhanced formatting for sentiment analysis
   */
  private buildContextFromSummaries(
    summaries: Array<{ analysisType: string; summary: string; lastAnalyzedAt: Date; metadata?: any }>,
    forAnalysisType?: AnalysisType
  ): string {
    if (summaries.length === 0) {
      return 'No thread history available';
    }

    const contextParts: string[] = [];

    // Special header for sentiment analysis
    if (forAnalysisType === 'sentiment') {
      contextParts.push('Thread Sentiment History (Conversation Memory):\n');
      contextParts.push('Use this context to understand the sentiment trend and provide consistent sentiment analysis.\n');
    } else {
      contextParts.push('Thread Summary (Conversation Memory):\n');
    }

    for (const summary of summaries) {
      const analysisTypeName = summary.analysisType.toUpperCase().replace(/-/g, ' ');
      contextParts.push(`\n[${analysisTypeName} Summary]`);

      // For sentiment, add sentiment score info if available
      if (summary.analysisType === 'sentiment' && summary.metadata) {
        const currentSentiment = summary.metadata.currentEmailSentiment;
        const currentScore = summary.metadata.currentEmailSentimentScore;
        if (currentSentiment || currentScore !== null) {
          contextParts.push(`Last Email Sentiment: ${currentSentiment || 'unknown'}${currentScore !== null ? ` (score: ${currentScore})` : ''}`);
        }
      }

      contextParts.push(summary.summary);
      contextParts.push(`(Last updated: ${new Date(summary.lastAnalyzedAt).toISOString()})`);
      contextParts.push('---');
    }

    return contextParts.join('\n');
  }

  /**
   * Update thread summaries after analyzing a new email
   * Generates/updates summaries for each analysis type that was run
   * Special handling for sentiment: tracks sentiment score and trend
   */
  async updateThreadSummaries(
    tenantId: string,
    threadId: string,
    emailId: string,
    email: Email,
    analysisResults: Record<string, any>
  ): Promise<void> {
    logger.info(
      {
        tenantId,
        threadId,
        emailId,
        analysisTypes: Object.keys(analysisResults),
      },
      'Updating thread summaries'
    );

    // Update summaries for each analysis type
    for (const [analysisType, result] of Object.entries(analysisResults)) {
      try {
        // Get existing summary (if any)
        const existing = await this.threadAnalysisRepo.getByThreadAndType(threadId, analysisType);

        // Special handling for sentiment: extract sentiment value and score
        let sentimentMetadata: Record<string, any> = {
          emailSubject: email.subject,
          emailReceivedAt: email.receivedAt,
        };

        if (analysisType === 'sentiment' && result) {
          // Extract sentiment value and score from result
          const sentimentValue = result.value || result.sentiment || null;
          const sentimentScore = result.score !== undefined ? result.score : null;

          sentimentMetadata = {
            ...sentimentMetadata,
            currentEmailSentiment: sentimentValue,
            currentEmailSentimentScore: sentimentScore,
          };

          // If existing summary has sentiment metadata, include it for trend tracking
          if (existing?.metadata) {
            sentimentMetadata.previousSentiment = existing.metadata.currentEmailSentiment;
            sentimentMetadata.previousSentimentScore = existing.metadata.currentEmailSentimentScore;
          }
        }

        // Optimization: For first email in thread, use email analysis result directly as thread summary
        // For subsequent emails, use LLM to merge old summary + new email analysis
        let updatedSummary: {
          summary: string;
          modelUsed: string;
          promptTokens?: number;
          completionTokens?: number;
          totalTokens?: number;
        };

        if (!existing) {
          // First email in thread: Use email analysis result directly (no LLM call)
          updatedSummary = this.createInitialThreadSummary(analysisType as AnalysisType, email, result);
          logger.info(
            {
              tenantId,
              threadId,
              emailId,
              analysisType,
              summaryLength: updatedSummary.summary.length,
            },
            'Created initial thread summary from email analysis (no LLM call)'
          );
        } else {
          // Subsequent emails: Use LLM to merge old summary + new email analysis
          updatedSummary = await this.generateThreadSummary(
            analysisType as AnalysisType,
            existing.summary,
            email,
            result
          );
          logger.info(
            {
              tenantId,
              threadId,
              emailId,
              analysisType,
              summaryLength: updatedSummary.summary.length,
            },
            'Updated thread summary using LLM merge'
          );
        }

        // Upsert thread analysis
        await this.threadAnalysisRepo.upsert({
          threadId,
          tenantId,
          analysisType,
          summary: updatedSummary.summary,
          lastAnalyzedEmailId: emailId,
          lastAnalyzedAt: new Date(),
          modelUsed: updatedSummary.modelUsed,
          summaryVersion: 'v1.0',
          promptTokens: updatedSummary.promptTokens,
          completionTokens: updatedSummary.completionTokens,
          totalTokens: updatedSummary.totalTokens,
          metadata: sentimentMetadata,
        });

        logger.info(
          {
            tenantId,
            threadId,
            emailId,
            analysisType,
            summaryLength: updatedSummary.summary.length,
          },
          'Thread summary updated'
        );
      } catch (error: any) {
        logger.error(
          {
            error: {
              message: error.message,
              stack: error.stack,
            },
            tenantId,
            threadId,
            emailId,
            analysisType,
          },
          'Failed to update thread summary'
        );
        // Continue with other analyses
      }
    }
  }

  /**
   * Create initial thread summary from email analysis result (first email in thread)
   * No LLM call needed - formats the analysis result directly
   */
  private createInitialThreadSummary(
    analysisType: AnalysisType,
    email: Email,
    result: any
  ): {
    summary: string;
    modelUsed: string;
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  } {
    const analysisTypeName = analysisType.replace(/-/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase());
    const date = email.receivedAt ? new Date(email.receivedAt).toISOString().split('T')[0] : 'Unknown';

    // Format the analysis result as a summary
    let summary: string;

    if (analysisType === 'sentiment') {
      const sentimentValue = result?.value || result?.sentiment || 'unknown';
      const sentimentScore = result?.score !== undefined ? ` (score: ${result.score})` : '';
      summary = `Thread sentiment analysis started on ${date}. First email sentiment: ${sentimentValue}${sentimentScore}. ${this.formatAnalysisResult(analysisType, result)}`;
    } else {
      summary = `Thread ${analysisTypeName} analysis started on ${date}. First email analysis: ${this.formatAnalysisResult(analysisType, result)}`;
    }

    return {
      summary,
      modelUsed: 'direct-format', // Indicates no LLM was used
    };
  }

  /**
   * Format analysis result into readable text
   */
  private formatAnalysisResult(analysisType: AnalysisType, result: any): string {
    if (!result) return 'No analysis result available.';

    // For sentiment, provide more detail
    if (analysisType === 'sentiment') {
      const sentimentValue = result.value || result.sentiment || 'unknown';
      const sentimentScore = result.score !== undefined ? ` (score: ${result.score})` : '';
      const reasoning = result.reasoning ? ` Reasoning: ${result.reasoning.substring(0, 200)}` : '';
      return `Sentiment: ${sentimentValue}${sentimentScore}.${reasoning}`;
    }

    // For other types, format JSON result
    try {
      const formatted = JSON.stringify(result, null, 2);
      // Limit length to avoid huge summaries
      return formatted.length > 500 ? formatted.substring(0, 500) + '...' : formatted;
    } catch {
      return String(result);
    }
  }

  /**
   * Generate thread summary using LLM
   * Updates existing summary with new email and analysis result
   * Only called for subsequent emails (not first email)
   */
  private async generateThreadSummary(
    analysisType: AnalysisType,
    existingSummary: string,
    newEmail: Email,
    newResult: any
  ): Promise<{
    summary: string;
    modelUsed: string;
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  }> {
    logger.debug(
      {
        analysisType,
        hasExistingSummary: !!existingSummary,
        emailSubject: newEmail.subject,
      },
      'Generating thread summary via LLM (merging with existing summary)'
    );

    // Generate summary via LLM (merging old summary + new email analysis)
    return await this.generateSummaryViaLLM(analysisType, existingSummary, newEmail, newResult);
  }

  /**
   * Build prompt for thread summary generation
   * Special handling for sentiment to include sentiment scores and trends
   */
  private buildSummaryPrompt(
    analysisType: AnalysisType,
    existingSummary: string | null,
    newEmail: Email,
    newResult: any
  ): string {
    const analysisTypeName = analysisType.replace(/-/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase());

    // Special prompt for sentiment analysis
    // Note: This is only called for subsequent emails (existingSummary is always provided)
    if (analysisType === 'sentiment') {
      const sentimentValue = newResult?.value || newResult?.sentiment || 'unknown';
      const sentimentScore = newResult?.score !== undefined ? newResult.score : null;

      return `Update the thread sentiment summary by merging the existing summary with the new email sentiment analysis.

Current Thread Sentiment Summary:
${existingSummary}

New Email Sentiment Analysis:
Subject: ${newEmail.subject}
Body: ${newEmail.body?.substring(0, 1000) || 'No body'}
Date: ${newEmail.receivedAt ? new Date(newEmail.receivedAt).toISOString() : 'Unknown'}
From: ${newEmail.from.name || newEmail.from.email}
Sentiment: ${sentimentValue}${sentimentScore !== null ? ` (score: ${sentimentScore})` : ''}

Full Analysis Result:
${JSON.stringify(newResult, null, 2)}

Generate an updated thread sentiment summary that:
1. Incorporates the new email sentiment (${sentimentValue}${sentimentScore !== null ? `, score: ${sentimentScore}` : ''})
2. Tracks sentiment trends over time (positive → negative shifts, neutral → emotional changes, etc.)
3. Maintains continuity with the existing summary above
4. Highlights sentiment patterns and changes
5. Includes overall thread sentiment assessment (e.g., "Overall positive trend", "Mixed sentiment", "Escalating negativity")
6. Keeps summary concise (max 300 words)
7. Focuses on sentiment-specific insights and emotional trajectory

Return only the updated summary text, no JSON, no markdown.`;
    }

    // Generic prompt for other analysis types
    // Note: This is only called for subsequent emails (existingSummary is always provided)
    return `Update the thread summary for ${analysisTypeName} analysis by merging the existing summary with the new email analysis.

Current Summary:
${existingSummary}

New Email:
Subject: ${newEmail.subject}
Body: ${newEmail.body?.substring(0, 1000) || 'No body'}
Date: ${newEmail.receivedAt ? new Date(newEmail.receivedAt).toISOString() : 'Unknown'}
From: ${newEmail.from.name || newEmail.from.email}

Analysis Result:
${JSON.stringify(newResult, null, 2)}

Generate an updated thread summary that:
1. Incorporates the new email and analysis result
2. Maintains continuity with the existing summary above
3. Highlights trends and changes over time
4. Keeps summary concise (max 300 words)
5. Focuses on ${analysisTypeName}-specific insights

Return only the updated summary text, no JSON, no markdown.`;
  }

  /**
   * Generate summary via LLM call using analysis service
   */
  private async generateSummaryViaLLM(
    analysisType: AnalysisType,
    existingSummary: string | null,
    newEmail: Email,
    newResult: any
  ): Promise<{
    summary: string;
    modelUsed: string;
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  }> {
    const prompt = this.buildSummaryPrompt(analysisType, existingSummary, newEmail, newResult);

    try {
      // Use analysis client's summarize method
      const result = await this.analysisClient.summarizeThread(analysisType, prompt, 'gemini-2.0-flash');

      return {
        summary: result.summary,
        modelUsed: result.modelUsed,
        promptTokens: result.tokens?.prompt,
        completionTokens: result.tokens?.completion,
        totalTokens: result.tokens?.total,
      };
    } catch (error: any) {
      logger.warn(
        {
          error: {
            message: error.message,
            stack: error.stack,
          },
          analysisType,
        },
        'Failed to generate summary via LLM, using simple summary'
      );
      // Fallback: Generate simple summary without LLM
      return {
        summary: this.generateSimpleSummary(analysisType, existingSummary, newEmail, newResult),
        modelUsed: 'fallback',
      };
    }
  }

  /**
   * Generate simple summary without LLM (fallback)
   */
  private generateSimpleSummary(
    analysisType: AnalysisType,
    existingSummary: string | null,
    newEmail: Email,
    newResult: any
  ): string {
    const analysisTypeName = analysisType.replace(/-/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase());
    const date = newEmail.receivedAt ? new Date(newEmail.receivedAt).toISOString().split('T')[0] : 'Unknown';

    if (!existingSummary) {
      return `Thread ${analysisTypeName} Summary: First email analyzed on ${date}. ${JSON.stringify(newResult).substring(0, 200)}`;
    }

    return `${existingSummary}\n\nUpdate (${date}): New email analyzed. ${JSON.stringify(newResult).substring(0, 200)}`;
  }
}
