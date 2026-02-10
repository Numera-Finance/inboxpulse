import { Inngest } from 'inngest';
import { container } from 'tsyringe';
import { EmailService } from '../service';
import { EmailAnalysisService } from '../analysis-service';
import { dbEmailToEmail } from '../converter';
import { logger } from '../../utils/logger';
import { EmailAnalysisStatus } from '../schema';

/**
 * Maximum number of emails to include in thread context
 * Limits token usage and memory for large threads
 * 
 * Phase 1: Includes limited recent emails (MAX_THREAD_CONTEXT_EMAILS)
 * Phase 2: LLM will query for additional thread context via tools when needed
 */
const MAX_THREAD_CONTEXT_EMAILS = 5;
const MAX_BODY_PREVIEW_LENGTH = 300;

/**
 * Inngest function to analyze emails after insertion
 * Triggered by 'email/inserted' event from EmailService
 * 
 * Uses idempotency key to prevent duplicate processing
 */
export const createAnalyzeEmailFunction = (inngest: Inngest) => {
  return inngest.createFunction(
    {
      id: 'analyze-email',
      name: 'Analyze Email After Insertion',
      retries: 9, // Retry up to 9 times with exponential backoff
      // Idempotency: normal events dedupe on emailId, retry events include retryKey to bypass
      // CEL syntax: has() checks field existence, ternary provides default
      idempotency: 'event.data.emailId + (has(event.data.retryKey) ? event.data.retryKey : "")',
    },
    { event: 'email/inserted' },
    async ({ event, step }: { event: any; step: any }) => {
      const { tenantId, emailId, threadId } = event.data;
      const attemptTimestamp = new Date().toISOString();

      // IDEMPOTENCY LOG: Track every analysis attempt
      logger.info(
        {
          tenantId,
          emailId,
          threadId,
          eventId: event.id,
          attemptTimestamp,
          idempotencyKey: emailId,
          logType: 'ANALYSIS_ATTEMPT_START',
        },
        'Inngest: Analysis attempt started - checking idempotency'
      );

      // Step 1: Fetch email and thread data in single query (optimized)
      // Avoids duplicate DB queries by fetching all needed data at once
      const { dbEmail, threadEmails } = await step.run('fetch-email-and-thread', async () => {
        const emailService = container.resolve(EmailService);

        // Fetch current email (tenantId will be extracted from email record)
        const email = await emailService.findById(emailId);
        if (!email) {
          throw new Error(`Email ${emailId} not found`);
        }

        // Fetch thread emails for context (if needed)
        const threadResult = await emailService.findByThread(tenantId, threadId);

        return {
          dbEmail: email,
          threadEmails: threadResult.emails,
        };
      });

      // Step 2: Check if already analyzed (DB-level idempotency check)
      const alreadyAnalyzed = dbEmail.analysisStatus === EmailAnalysisStatus.Completed;

      // IDEMPOTENCY LOG: Track DB-level check result
      logger.info(
        {
          tenantId,
          emailId,
          threadId,
          eventId: event.id,
          attemptTimestamp,
          analysisStatus: dbEmail.analysisStatus,
          alreadyAnalyzed,
          logType: 'ANALYSIS_DB_CHECK',
        },
        `Inngest: DB idempotency check - analysisStatus=${dbEmail.analysisStatus}, alreadyAnalyzed=${alreadyAnalyzed}`
      );

      if (alreadyAnalyzed) {
        // IDEMPOTENCY LOG: Skipping due to already analyzed
        logger.warn(
          {
            tenantId,
            emailId,
            threadId,
            eventId: event.id,
            attemptTimestamp,
            logType: 'ANALYSIS_SKIPPED_ALREADY_DONE',
          },
          'Inngest: SKIPPING - Email already analyzed (analysisStatus=Completed)'
        );
        return {
          tenantId,
          emailId,
          threadId,
          skipped: true,
          reason: 'already_analyzed',
        };
      }

      // Step 3: Execute analysis (durable step - will retry on failure)
      // Uses shared EmailAnalysisService for both batch and interactive operations
      const analysisResults = await step.run('execute-analysis', async () => {
        const analysisService = container.resolve(EmailAnalysisService);
        const executionStartTime = Date.now();

        // IDEMPOTENCY LOG: About to execute analysis (this is the costly part)
        logger.warn(
          {
            tenantId,
            emailId,
            threadId,
            eventId: event.id,
            attemptTimestamp,
            executionStartTime,
            logType: 'ANALYSIS_EXECUTION_START',
          },
          'Inngest: EXECUTING ANALYSIS - LLM calls will be made (cost incurred)'
        );

        // Build limited thread context (avoids memory issues with large threads)
        const threadContext = buildThreadContext(threadEmails, dbEmail.messageId);

        // Convert DB email to shared Email type for analysis service
        const email = dbEmailToEmail(dbEmail);

        logger.debug(
          {
            tenantId,
            emailId,
            emailFrom: email.from.email,
            emailSubject: email.subject,
            hasBody: !!email.body,
            bodyLength: email.body?.length || 0,
            threadEmailsCount: threadEmails.length,
          },
          'Inngest: Email data prepared for analysis'
        );

        // Execute analysis using shared service (persist=true for Inngest)
        // Uses thread summaries as context (if available), falls back to raw thread context
        const result = await analysisService.executeAnalysis({
          tenantId,
          emailId,
          email,
          threadId,
          threadContext: threadContext.threadContext, // Fallback if no summaries exist
          persist: true, // Always persist in Inngest
          useThreadSummaries: false, // Disabled - thread summaries not used in UI yet
        });

        const executionEndTime = Date.now();
        const executionDurationMs = executionEndTime - executionStartTime;

        // IDEMPOTENCY LOG: Analysis execution completed
        logger.warn(
          {
            tenantId,
            emailId,
            threadId,
            eventId: event.id,
            attemptTimestamp,
            executionStartTime,
            executionEndTime,
            executionDurationMs,
            analysisTypesExecuted: result.analysisResults ? Object.keys(result.analysisResults) : [],
            customersCreated: result.domainResult?.customers?.length || 0,
            contactsCreated: result.contactResult?.contacts?.length || 0,
            logType: 'ANALYSIS_EXECUTION_COMPLETE',
          },
          `Inngest: Analysis execution completed in ${executionDurationMs}ms`
        );

        return result;
      });

      // Analysis results are already persisted by EmailAnalysisService when persist=true
      // No need for separate persistence step

      // Summary log with what was created
      logger.info(
        {
          tenantId,
          emailId,
          threadId,
          customersCreated: analysisResults.domainResult?.customers?.length || 0,
          contactsCreated: analysisResults.contactResult?.contacts?.length || 0,
          analysesSaved: analysisResults.analysisResults ? Object.keys(analysisResults.analysisResults).length : 0,
          summary: {
            customers: analysisResults.domainResult?.customers?.map((c: any) => ({
              id: c.id,
              domains: c.domains,
            })) || [],
            contacts: analysisResults.contactResult?.contacts?.map((c: any) => ({
              id: c.id,
              email: c.email,
              name: c.name,
              customerId: c.customerId,
            })) || [],
            analyses: analysisResults.analysisResults ? Object.keys(analysisResults.analysisResults) : [],
          },
        },
        'Inngest: Email analysis completed successfully'
      );

      return {
        tenantId,
        emailId,
        threadId,
        success: true,
        customersCreated: analysisResults.domainResult?.customers?.length || 0,
        contactsCreated: analysisResults.contactResult?.contacts?.length || 0,
        analysesSaved: analysisResults.analysisResults ? Object.keys(analysisResults.analysisResults).length : 0,
      };
    }
  );
};

/**
 * Build thread context string for analyses that require it
 * Limits context size to reduce token usage and prevent memory issues with large threads
 *
 * Phase 1: Includes limited recent emails (MAX_THREAD_CONTEXT_EMAILS)
 * Phase 2: LLM will query for additional thread context via tools when needed
 *
 * Performance optimizations:
 * 1. Limits to MAX_THREAD_CONTEXT_EMAILS most recent emails
 * 2. Truncates body previews to MAX_BODY_PREVIEW_LENGTH
 * 3. Prioritizes emails around the current email
 */
function buildThreadContext(threadEmails: any[], currentMessageId: string): { threadContext: string } {
  if (!threadEmails || threadEmails.length === 0) {
    return { threadContext: 'No thread history available' };
  }

  // Sort by received date
  const sortedEmails = [...threadEmails].sort((a, b) => {
    const dateA = a.receivedAt ? new Date(a.receivedAt).getTime() : 0;
    const dateB = b.receivedAt ? new Date(b.receivedAt).getTime() : 0;
    return dateA - dateB;
  });

  // Select emails to include (limit to MAX_THREAD_CONTEXT_EMAILS)
  let emailsToInclude: any[];
  if (sortedEmails.length <= MAX_THREAD_CONTEXT_EMAILS) {
    emailsToInclude = sortedEmails;
  } else {
    // Take the most recent MAX_THREAD_CONTEXT_EMAILS emails
    emailsToInclude = sortedEmails.slice(-MAX_THREAD_CONTEXT_EMAILS);
  }

  const contextParts: string[] = [];
  if (sortedEmails.length > emailsToInclude.length) {
    contextParts.push(
      `Thread History (showing ${emailsToInclude.length} of ${sortedEmails.length} messages, most recent):\n`
    );
  } else {
    contextParts.push(`Thread History (${sortedEmails.length} messages):\n`);
  }

  for (const dbEmail of emailsToInclude) {
    const isCurrent = dbEmail.messageId === currentMessageId;
    const marker = isCurrent ? '[CURRENT]' : '';

    contextParts.push(`${marker} From: ${dbEmail.fromName || dbEmail.fromEmail} (${dbEmail.fromEmail})`);
    contextParts.push(`Subject: ${dbEmail.subject}`);
    if (dbEmail.receivedAt) {
      contextParts.push(`Date: ${new Date(dbEmail.receivedAt).toISOString()}`);
    }

    if (dbEmail.body) {
      const bodyPreview = dbEmail.body.length > MAX_BODY_PREVIEW_LENGTH
        ? dbEmail.body.substring(0, MAX_BODY_PREVIEW_LENGTH) + '...'
        : dbEmail.body;
      contextParts.push(`Body: ${bodyPreview}`);
    }

    contextParts.push('---');
  }

  return {
    threadContext: contextParts.join('\n'),
  };
}
