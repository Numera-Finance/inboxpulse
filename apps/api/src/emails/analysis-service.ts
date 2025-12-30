import { injectable, inject } from 'tsyringe';
import { AnalysisClient, type ClassificationResult } from '@crm/clients';
import type { Database } from '@crm/database';
import { EmailAnalysisRepository } from './analysis-repository';
import { EmailRepository } from './repository';
import { ThreadAnalysisService } from './thread-analysis-service';
import { createEmailAnalysisRecord } from './analysis-utils';
import type { Email, AnalysisType } from '@crm/shared';
import { Signal } from '@crm/shared';
import type { AnalysisType as EmailAnalysisType } from './analysis-schema';
import { EmailAnalysisStatus, type NewEmailParticipant } from './schema';
import { UserRepository } from '../users/repository';
import { UserService } from '../users/service';
import { ContactRepository } from '../contacts/repository';
import { ContactService, type SignatureData } from '../contacts/service';
import { CustomerRepository } from '../customers/repository';
import { TaskService } from '../tasks/service';
import { TenantService } from '../tenants/service';
import { logger } from '../utils/logger';
import { extractLatestReply, hasAnalyzableSignatureContent } from './extraction/extractor';

// =============================================================================
// Types
// =============================================================================

export interface AnalysisExecutionResult {
  domainResult?: {
    customers?: Array<{ id: string; domains: string[] }>;
  };
  contactResult?: {
    contacts?: Array<{ id: string; email: string; name?: string; customerId?: string }>;
  };
  analysisResults?: Record<string, any>;
}

export interface AnalysisExecutionOptions {
  tenantId: string;
  emailId: string;
  email: Email;
  threadId: string;
  threadContext?: string;
  persist?: boolean;
  analysisTypes?: AnalysisType[];
  useThreadSummaries?: boolean;
}

/**
 * Internal context passed between pipeline steps
 */
interface AnalysisContext {
  tenantId: string;
  emailId: string;
  email: Email;
  threadId: string;
  persist: boolean;
  analysisTypes?: AnalysisType[];
  useThreadSummaries: boolean;
  threadContext?: string;
  result: AnalysisExecutionResult;
}

/**
 * Data collected during Phase 1 (gather phase)
 * This data will be written to DB in Phase 2 (commit phase)
 */
interface CollectedData {
  // From external API calls
  domainResult?: { customers?: Array<{ id: string; domains: string[] }> };
  contactResult?: { contacts?: Array<{ id: string; email: string; name?: string; customerId?: string }> };
  analysisResults?: Record<string, any>;
  classificationResult?: ClassificationResult;

  // Data prepared for DB writes
  participantsToCreate?: NewEmailParticipant[];
  contactsToEnsure?: Array<{ email: string; name?: string }>;
  ensuredContacts?: Array<{ id: string; email: string; name?: string; customerId?: string; created: boolean }>;
}

// =============================================================================
// Email Analysis Service
// =============================================================================

/**
 * Email Analysis Service
 * Handles analysis execution for both batch (Inngest) and interactive (API) operations
 *
 * Uses a two-phase approach for data consistency:
 * - Phase 1: Gather data from external services (no local DB writes)
 * - Phase 2: Write all data to local DB in a single transaction
 */
@injectable()
export class EmailAnalysisService {
  constructor(
    @inject('Database') private db: Database,
    @inject(AnalysisClient) private analysisClient: AnalysisClient,
    private analysisRepo: EmailAnalysisRepository,
    private emailRepo: EmailRepository,
    private threadAnalysisService: ThreadAnalysisService,
    private userService: UserService,
    private contactService: ContactService,
    private taskService: TaskService,
    private tenantService: TenantService
  ) { }

  // ===========================================================================
  // Main Entry Point
  // ===========================================================================

  /**
   * Execute full analysis pipeline for an email
   *
   * Two-phase approach:
   * - Phase 1: Gather all data from external services
   * - Phase 2: Write everything to DB in a single transaction
   */
  async executeAnalysis(options: AnalysisExecutionOptions): Promise<AnalysisExecutionResult> {
    const ctx = this.createContext(options);

    logger.info(
      {
        tenantId: ctx.tenantId,
        emailId: ctx.emailId,
        threadId: ctx.threadId,
        persist: ctx.persist,
        analysisTypes: ctx.analysisTypes || 'default',
        logType: 'ANALYSIS_PIPELINE_START',
      },
      'Analysis pipeline started'
    );

    // =========================================================================
    // PHASE 1: Gather data from external services (no local DB writes)
    // =========================================================================

    // Step 1: Get thread context
    ctx.threadContext = await this.getThreadContext(ctx, options.threadContext);

    // Step 2: Call external APIs to gather data
    const collectedData = await this.gatherDataFromExternalServices(ctx);

    // =========================================================================
    // PHASE 2: Write all data to DB in a single transaction
    // =========================================================================

    if (ctx.persist) {
      await this.commitAllDataToDatabase(ctx, collectedData);
    }

    // Build result
    ctx.result = {
      domainResult: collectedData.domainResult,
      contactResult: collectedData.contactResult,
      analysisResults: collectedData.analysisResults,
    };

    logger.info(
      {
        tenantId: ctx.tenantId,
        emailId: ctx.emailId,
        logType: 'ANALYSIS_PIPELINE_COMPLETE',
      },
      'Analysis pipeline completed'
    );

    return ctx.result;
  }

  // ===========================================================================
  // Phase 1: Gather Data
  // ===========================================================================

  /**
   * Gather all data from external services without writing to local DB
   */
  private async gatherDataFromExternalServices(ctx: AnalysisContext): Promise<CollectedData> {
    const data: CollectedData = {};

    // Step 2a: Extract domains (external API call)
    data.domainResult = await this.callDomainExtraction(ctx);

    // Step 2b: Extract contacts (external API call)
    data.contactResult = await this.callContactExtraction(ctx, data.domainResult?.customers);

    // Step 2c: Prepare contacts to ensure for all email participants
    data.contactsToEnsure = this.collectEmailParticipantsForContacts(ctx.email);

    // Step 2d: Extract reply and signature from email body
    // This strips quoted content and separates signature for token savings
    this.extractEmailContent(ctx);

    // Step 2e: Run main analyses (external API call) with classification
    const { results, classificationResult } = await this.callMainAnalyses(ctx);
    data.analysisResults = results;
    data.classificationResult = classificationResult;

    return data;
  }

  /**
   * Extract reply and signature from email body
   * Updates ctx.email with:
   * - body: stripped of quoted content (reply only)
   * - signature: only if it has analyzable content (phone, title, company, etc.)
   */
  private extractEmailContent(ctx: AnalysisContext): void {
    const originalBody = ctx.email.body;
    if (!originalBody) return;

    // Check if body looks like HTML
    const isHtml = /<\/?[a-z][\s\S]*>/i.test(originalBody);

    try {
      const extraction = extractLatestReply(originalBody, isHtml);

      // Update body with extracted reply (quotes stripped)
      ctx.email = {
        ...ctx.email,
        body: extraction.messageBody,
      };

      // Only set signature if it has analyzable content (not just a name)
      if (extraction.signature && hasAnalyzableSignatureContent(extraction.signature)) {
        ctx.email = {
          ...ctx.email,
          signature: extraction.signature,
        };

        logger.debug(
          {
            tenantId: ctx.tenantId,
            emailId: ctx.emailId,
            originalLength: extraction.originalLength,
            replyLength: extraction.messageBody.length,
            signatureLength: extraction.signature.length,
            tokenSavingsPercent: extraction.tokenSavingsPercent,
            logType: 'EMAIL_EXTRACTION_WITH_SIGNATURE',
          },
          'Email content extracted with analyzable signature'
        );
      } else {
        logger.debug(
          {
            tenantId: ctx.tenantId,
            emailId: ctx.emailId,
            originalLength: extraction.originalLength,
            replyLength: extraction.messageBody.length,
            tokenSavingsPercent: extraction.tokenSavingsPercent,
            hasSignature: !!extraction.signature,
            logType: 'EMAIL_EXTRACTION_NO_SIGNATURE',
          },
          'Email content extracted (no analyzable signature)'
        );
      }
    } catch (error: any) {
      logger.warn(
        { error: error.message, tenantId: ctx.tenantId, emailId: ctx.emailId },
        'Email extraction failed, using original body'
      );
      // Keep original body on failure
    }
  }

  /**
   * Call domain extraction API
   */
  private async callDomainExtraction(
    ctx: AnalysisContext
  ): Promise<{ customers?: Array<{ id: string; domains: string[] }> } | undefined> {
    const startTime = Date.now();

    logger.info(
      { tenantId: ctx.tenantId, emailId: ctx.emailId, logType: 'DOMAIN_EXTRACTION_START' },
      'Starting domain extraction'
    );

    try {
      const result = await this.analysisClient.extractDomains(ctx.tenantId, ctx.email);

      logger.info(
        {
          tenantId: ctx.tenantId,
          emailId: ctx.emailId,
          durationMs: Date.now() - startTime,
          customersCreated: result?.customers?.length || 0,
          logType: 'DOMAIN_EXTRACTION_COMPLETE',
        },
        'Domain extraction completed'
      );

      return result;
    } catch (error: any) {
      logger.error(
        { tenantId: ctx.tenantId, emailId: ctx.emailId, error: error.message },
        'Domain extraction FAILED'
      );
      throw error;
    }
  }

  /**
   * Call contact extraction API
   */
  private async callContactExtraction(
    ctx: AnalysisContext,
    customers?: Array<{ id: string; domains: string[] }>
  ): Promise<{ contacts?: Array<{ id: string; email: string; name?: string; customerId?: string }> } | undefined> {
    const startTime = Date.now();

    logger.info(
      { tenantId: ctx.tenantId, emailId: ctx.emailId, logType: 'CONTACT_EXTRACTION_START' },
      'Starting contact extraction'
    );

    try {
      const result = await this.analysisClient.extractContacts(ctx.tenantId, ctx.email, customers);

      logger.info(
        {
          tenantId: ctx.tenantId,
          emailId: ctx.emailId,
          durationMs: Date.now() - startTime,
          contactsCreated: result?.contacts?.length || 0,
          logType: 'CONTACT_EXTRACTION_COMPLETE',
        },
        'Contact extraction completed'
      );

      return result;
    } catch (error: any) {
      logger.error(
        { tenantId: ctx.tenantId, emailId: ctx.emailId, error: error.message },
        'Contact extraction FAILED'
      );
      throw error;
    }
  }

  /**
   * Call main analyses API (sentiment, escalation, signature-extraction)
   * Also runs email classification via filter (classify but don't skip)
   */
  private async callMainAnalyses(ctx: AnalysisContext): Promise<{ results: Record<string, any>; classificationResult?: ClassificationResult }> {
    const startTime = Date.now();

    // Filter out signature-extraction if no signature available (saves tokens)
    let analysisTypes = ctx.analysisTypes;
    if (analysisTypes && !ctx.email.signature) {
      const filtered = analysisTypes.filter(t => t !== 'signature-extraction');
      if (filtered.length < analysisTypes.length) {
        logger.debug(
          { tenantId: ctx.tenantId, emailId: ctx.emailId, logType: 'SKIP_SIGNATURE_ANALYSIS' },
          'Skipping signature-extraction (no analyzable signature)'
        );
        analysisTypes = filtered.length > 0 ? filtered : undefined;
      }
    }

    logger.info(
      {
        tenantId: ctx.tenantId,
        emailId: ctx.emailId,
        analysisTypes: analysisTypes || 'default',
        hasSignature: !!ctx.email.signature,
        logType: 'MAIN_ANALYSIS_START',
      },
      'Starting main analysis with classification'
    );

    try {
      const response = await this.analysisClient.analyze(ctx.tenantId, ctx.email, {
        threadContext: ctx.threadContext,
        analysisTypes: analysisTypes,
        // Enable classification but don't filter (empty filterCategories = classify all, skip none)
        filter: {
          enabled: true,
          filterCategories: [],
        },
      });

      const results = response?.results || {};
      const classificationResult = response?.filterResult;

      logger.info(
        {
          tenantId: ctx.tenantId,
          emailId: ctx.emailId,
          durationMs: Date.now() - startTime,
          analysisTypes: Object.keys(results),
          classification: classificationResult?.category,
          classificationConfidence: classificationResult?.confidence,
          classificationStage: classificationResult?.stage,
          logType: 'MAIN_ANALYSIS_COMPLETE',
        },
        'Main analysis completed'
      );

      return { results, classificationResult };
    } catch (error: any) {
      logger.warn(
        { error: error.message, tenantId: ctx.tenantId, emailId: ctx.emailId },
        'Main analysis failed (non-blocking)'
      );
      return { results: {} };
    }
  }

  // ===========================================================================
  // Phase 2: Commit to Database
  // ===========================================================================

  /**
   * Write all collected data to database in a single transaction
   */
  private async commitAllDataToDatabase(
    ctx: AnalysisContext,
    data: CollectedData
  ): Promise<void> {
    logger.info(
      { tenantId: ctx.tenantId, emailId: ctx.emailId, logType: 'DB_TRANSACTION_START' },
      'Starting database transaction for all writes'
    );

    // Step 0: Ensure users exist for tenant domain email addresses
    // This runs outside the transaction since user creation is idempotent
    const participants = this.collectEmailParticipantsForContacts(ctx.email);
    await this.userService.ensureUsersFromEmails(ctx.tenantId, participants);

    try {
      await this.db.transaction(async (tx) => {
        // Step 1: Ensure all email participants have contacts and customers
        const ensuredContacts = await this.ensureContactsInTransaction(
          tx,
          ctx.tenantId,
          ctx.email,
          data.contactsToEnsure || []
        );

        // Merge with contacts from external API
        const allContacts = this.mergeContacts(
          data.contactResult?.contacts || [],
          ensuredContacts
        );

        // Step 2: Create email participants
        await this.createEmailParticipantsInTransaction(
          tx,
          ctx.tenantId,
          ctx.emailId,
          ctx.email,
          allContacts
        );

        // Step 3: Persist analysis results
        if (data.analysisResults && Object.keys(data.analysisResults).length > 0) {
          await this.persistAnalysisResultsInTransaction(
            tx,
            ctx.tenantId,
            ctx.emailId,
            data.analysisResults
          );

          // Step 4: Update email signals (classification, sentiment, escalation, upsell, churn, etc.)
          await this.updateEmailSignalsInTransaction(
            tx,
            ctx.emailId,
            data.analysisResults,
            data.classificationResult
          );

          // Step 5: Enrich contacts from signature
          await this.enrichContactsFromSignatureInTransaction(
            tx,
            ctx.tenantId,
            ctx.emailId,
            ctx.email,
            data.analysisResults['signature-extraction'],
            allContacts
          );

          // Step 6: Update thread summaries
          if (ctx.useThreadSummaries) {
            await this.updateThreadSummariesInTransaction(
              tx,
              ctx.tenantId,
              ctx.threadId,
              ctx.emailId,
              ctx.email,
              data.analysisResults
            );
          }
        }

        // Step 7: Always mark email as analyzed (regardless of sentiment)
        await this.emailRepo.updateAnalysisStatus(ctx.emailId, EmailAnalysisStatus.Completed, tx);
      });

      logger.info(
        { tenantId: ctx.tenantId, emailId: ctx.emailId, logType: 'DB_TRANSACTION_COMPLETE' },
        'Database transaction completed successfully'
      );

      // Step 8: Auto-create task for negative sentiment emails (outside transaction)
      await this.maybeCreateTaskForNegativeEmail(ctx, data);
    } catch (error: any) {
      logger.error(
        { tenantId: ctx.tenantId, emailId: ctx.emailId, error: error.message },
        'Database transaction FAILED - all changes rolled back'
      );
      throw error;
    }
  }

  /**
   * Ensure contacts exist for all email participants (within transaction)
   */
  private async ensureContactsInTransaction(
    tx: any,
    tenantId: string,
    email: Email,
    participantsToEnsure: Array<{ email: string; name?: string }>
  ): Promise<Array<{ id: string; email: string; name?: string; customerId?: string; created: boolean }>> {
    // Use ContactService but pass the transaction
    // For now, we'll use the existing method which has its own upsert logic
    // TODO: Refactor ContactService to accept transaction
    return await this.contactService.ensureContactsFromEmail(tenantId, email);
  }

  /**
   * Create email participants (within transaction)
   */
  private async createEmailParticipantsInTransaction(
    tx: any,
    tenantId: string,
    emailId: string,
    email: Email,
    contacts: Array<{ id: string; email: string; name?: string; customerId?: string }>
  ): Promise<void> {
    const participants = this.collectEmailParticipants(email);

    if (participants.size === 0) {
      return;
    }

    const emailArray = Array.from(participants.keys());
    const [usersMap, contactsMap] = await Promise.all([
      this.userService.findByEmails(tenantId, emailArray),
      this.contactService.findByEmails(tenantId, emailArray),
    ]);

    const newContactsMap = new Map(
      contacts.map((c) => [c.email.toLowerCase(), { id: c.id, customerId: c.customerId }])
    );

    const participantRecords: NewEmailParticipant[] = [];

    for (const [emailAddr, info] of participants) {
      const record = this.buildParticipantRecord(
        tenantId,
        emailId,
        emailAddr,
        info,
        usersMap,
        contactsMap,
        newContactsMap
      );

      if (record) {
        participantRecords.push(record);
      }
    }

    if (participantRecords.length > 0) {
      await this.emailRepo.createParticipants(participantRecords, tx);
      logger.info(
        {
          tenantId,
          emailId,
          participantsCreated: participantRecords.length,
          logType: 'EMAIL_PARTICIPANTS_CREATED',
        },
        'Created email participants'
      );
    }
  }

  /**
   * Persist analysis results (within transaction)
   */
  private async persistAnalysisResultsInTransaction(
    tx: any,
    tenantId: string,
    emailId: string,
    analysisResults: Record<string, any>
  ): Promise<void> {
    const recordsToSave: any[] = [];

    for (const [analysisType, result] of Object.entries(analysisResults)) {
      try {
        const record = createEmailAnalysisRecord(
          emailId,
          tenantId,
          analysisType as EmailAnalysisType,
          result as any,
          {}
        );
        recordsToSave.push(record);
      } catch (error: any) {
        logger.error(
          { error: error.message, tenantId, emailId, analysisType },
          'Failed to create analysis record'
        );
      }
    }

    if (recordsToSave.length > 0) {
      await this.analysisRepo.upsertAnalyses(recordsToSave, tx);
      logger.info(
        {
          tenantId,
          emailId,
          savedCount: recordsToSave.length,
          analysisTypes: recordsToSave.map((r) => r.analysisType),
          logType: 'ANALYSIS_RESULTS_PERSISTED',
        },
        'Analysis results persisted'
      );
    }
  }

  /**
   * Update email signals from all analysis results (within transaction)
   * Converts analysis results to Signal integers and updates the signals array
   */
  private async updateEmailSignalsInTransaction(
    tx: any,
    emailId: string,
    analysisResults: Record<string, any>,
    classificationResult?: ClassificationResult
  ): Promise<void> {
    const signals: number[] = [];

    // Classification
    if (classificationResult?.category) {
      switch (classificationResult.category) {
        case 'spam':
          signals.push(Signal.CLASSIFICATION_SPAM);
          break;
        case 'marketing':
          signals.push(Signal.CLASSIFICATION_MARKETING);
          break;
        case 'transactional':
          signals.push(Signal.CLASSIFICATION_TRANSACTIONAL);
          break;
        case 'automated':
          signals.push(Signal.CLASSIFICATION_AUTOMATED);
          break;
        case 'business':
          signals.push(Signal.CLASSIFICATION_BUSINESS);
          break;
      }
    }

    // Sentiment
    const sentimentResult = analysisResults['sentiment'];
    if (sentimentResult?.value) {
      switch (sentimentResult.value) {
        case 'positive':
          signals.push(Signal.SENTIMENT_POSITIVE);
          break;
        case 'negative':
          signals.push(Signal.SENTIMENT_NEGATIVE);
          break;
        case 'neutral':
          signals.push(Signal.SENTIMENT_NEUTRAL);
          break;
      }
    }

    // Escalation
    const escalationResult = analysisResults['escalation'];
    if (escalationResult?.detected === true) {
      signals.push(Signal.ESCALATION);
    }

    // Upsell
    const upsellResult = analysisResults['upsell'];
    if (upsellResult?.detected === true) {
      signals.push(Signal.UPSELL);
    }

    // Churn
    const churnResult = analysisResults['churn'];
    if (churnResult?.riskLevel) {
      switch (churnResult.riskLevel) {
        case 'low':
          signals.push(Signal.CHURN_LOW);
          break;
        case 'medium':
          signals.push(Signal.CHURN_MEDIUM);
          break;
        case 'high':
          signals.push(Signal.CHURN_HIGH);
          break;
        case 'critical':
          signals.push(Signal.CHURN_CRITICAL);
          break;
      }
    }

    // Kudos
    const kudosResult = analysisResults['kudos'];
    if (kudosResult?.detected === true) {
      signals.push(Signal.KUDOS);
    }

    // Competitor
    const competitorResult = analysisResults['competitor'];
    if (competitorResult?.detected === true) {
      signals.push(Signal.COMPETITOR);
    }

    // Update signals array
    await this.emailRepo.updateSignals(emailId, signals, tx);

    logger.info(
      { emailId, signals, classification: classificationResult?.category, logType: 'EMAIL_SIGNALS_UPDATED' },
      'Updated email signals'
    );
  }

  /**
   * Enrich contacts from signature (within transaction)
   */
  private async enrichContactsFromSignatureInTransaction(
    tx: any,
    tenantId: string,
    emailId: string,
    email: Email,
    signatureData: SignatureData | undefined,
    contacts: Array<{ id: string; email: string; name?: string; customerId?: string }>
  ): Promise<void> {
    if (!signatureData) {
      return;
    }

    // Use ContactService - it has its own upsert logic
    // TODO: Refactor to accept transaction
    try {
      await this.contactService.enrichFromSignature(
        tenantId,
        emailId,
        email,
        signatureData,
        contacts
      );
    } catch (error: any) {
      logger.warn(
        { error: error.message, tenantId, emailId },
        'Failed to enrich contacts from signature (non-blocking within transaction)'
      );
    }
  }

  /**
   * Update thread summaries (within transaction)
   */
  private async updateThreadSummariesInTransaction(
    tx: any,
    tenantId: string,
    threadId: string,
    emailId: string,
    email: Email,
    analysisResults: Record<string, any>
  ): Promise<void> {
    try {
      // ThreadAnalysisService has its own transaction handling
      // TODO: Refactor to accept transaction
      await this.threadAnalysisService.updateThreadSummaries(
        tenantId,
        threadId,
        emailId,
        email,
        analysisResults
      );

      logger.info(
        {
          tenantId,
          emailId,
          threadId,
          analysisTypes: Object.keys(analysisResults),
          logType: 'THREAD_SUMMARIES_UPDATED',
        },
        'Thread summaries updated'
      );
    } catch (error: any) {
      logger.warn(
        { error: error.message, tenantId, emailId },
        'Failed to update thread summaries (non-blocking within transaction)'
      );
    }
  }

  // ===========================================================================
  // Helper Methods
  // ===========================================================================

  /**
   * Auto-create task for negative sentiment emails
   * Conditions:
   * - Email has negative sentiment
   * - Email is NOT classified as spam, marketing, or automated
   * - Email has a valid customer association
   */
  private async maybeCreateTaskForNegativeEmail(
    ctx: AnalysisContext,
    data: CollectedData
  ): Promise<void> {
    try {
      const sentimentResult = data.analysisResults?.['sentiment'];
      const classificationResult = data.classificationResult;

      // Check if sentiment is negative
      if (sentimentResult?.value !== 'negative') {
        return;
      }

      // Check if email is spam, marketing, or automated
      const skipCategories = ['spam', 'marketing', 'automated'];
      if (classificationResult?.category && skipCategories.includes(classificationResult.category)) {
        logger.debug(
          {
            emailId: ctx.emailId,
            category: classificationResult.category,
            logType: 'SKIP_TASK_CREATION_CATEGORY'
          },
          'Skipping task creation for marketing/spam/automated email'
        );
        return;
      }

      // Get customer ID from email participants
      const email = await this.emailRepo.findById(ctx.emailId);
      if (!email) {
        logger.warn({ emailId: ctx.emailId }, 'Email not found for task creation');
        return;
      }

      // Skip task creation for internal emails (sender domain = tenant domain)
      if (email.fromEmail) {
        const senderDomain = email.fromEmail.split('@')[1]?.toLowerCase();
        if (senderDomain) {
          const tenant = await this.tenantService.findById(ctx.tenantId);
          if (tenant?.domain && senderDomain === tenant.domain.toLowerCase()) {
            logger.debug(
              {
                emailId: ctx.emailId,
                senderDomain,
                tenantDomain: tenant.domain,
                logType: 'SKIP_TASK_CREATION_INTERNAL_EMAIL'
              },
              'Skipping task creation for internal email (sender domain matches tenant domain)'
            );
            return;
          }
        }
      }

      // Find customer ID from email participants
      const participants = await this.emailRepo.getParticipants(ctx.emailId);
      const participantWithCustomer = participants.find(p => p.customerId);

      if (!participantWithCustomer?.customerId) {
        logger.debug(
          { emailId: ctx.emailId, logType: 'SKIP_TASK_CREATION_NO_CUSTOMER' },
          'Skipping task creation - no customer associated'
        );
        return;
      }

      // Create task
      const task = await this.taskService.createFromEmail(
        ctx.tenantId,
        participantWithCustomer.customerId,
        ctx.emailId,
        email.subject || 'Negative sentiment email'
      );

      logger.info(
        {
          emailId: ctx.emailId,
          taskId: task.id,
          customerId: participantWithCustomer.customerId,
          logType: 'TASK_AUTO_CREATED'
        },
        'Auto-created task for negative sentiment email'
      );
    } catch (error: any) {
      // Non-blocking - log and continue
      logger.warn(
        { emailId: ctx.emailId, error: error.message },
        'Failed to auto-create task for negative email (non-blocking)'
      );
    }
  }

  /**
   * Create analysis context from options
   */
  private createContext(options: AnalysisExecutionOptions): AnalysisContext {
    return {
      tenantId: options.tenantId,
      emailId: options.emailId,
      email: options.email,
      threadId: options.threadId,
      persist: options.persist ?? false,
      analysisTypes: options.analysisTypes,
      useThreadSummaries: options.useThreadSummaries ?? true,
      result: {},
    };
  }

  /**
   * Get thread context from summaries or use provided context
   */
  private async getThreadContext(
    ctx: AnalysisContext,
    providedContext?: string
  ): Promise<string | undefined> {
    if (providedContext) {
      return providedContext;
    }

    if (!ctx.useThreadSummaries) {
      return undefined;
    }

    try {
      const primaryAnalysisType = ctx.analysisTypes?.[0];
      const threadSummaryContext = await this.threadAnalysisService.getThreadContext(
        ctx.threadId,
        primaryAnalysisType
      );
      return threadSummaryContext.contextString;
    } catch (error: any) {
      logger.warn(
        { error: error.message, tenantId: ctx.tenantId, emailId: ctx.emailId },
        'Failed to fetch thread summaries'
      );
      return undefined;
    }
  }

  /**
   * Collect email participants for contact creation
   */
  private collectEmailParticipantsForContacts(
    email: Email
  ): Array<{ email: string; name?: string }> {
    const participants: Array<{ email: string; name?: string }> = [];
    const seen = new Set<string>();

    if (email.from?.email) {
      const emailLower = email.from.email.toLowerCase();
      if (!seen.has(emailLower)) {
        seen.add(emailLower);
        participants.push({ email: email.from.email, name: email.from.name });
      }
    }

    for (const to of email.tos || []) {
      if (to.email) {
        const emailLower = to.email.toLowerCase();
        if (!seen.has(emailLower)) {
          seen.add(emailLower);
          participants.push({ email: to.email, name: to.name });
        }
      }
    }

    for (const cc of email.ccs || []) {
      if (cc.email) {
        const emailLower = cc.email.toLowerCase();
        if (!seen.has(emailLower)) {
          seen.add(emailLower);
          participants.push({ email: cc.email, name: cc.name });
        }
      }
    }

    for (const bcc of email.bccs || []) {
      if (bcc.email) {
        const emailLower = bcc.email.toLowerCase();
        if (!seen.has(emailLower)) {
          seen.add(emailLower);
          participants.push({ email: bcc.email, name: bcc.name });
        }
      }
    }

    return participants;
  }

  /**
   * Collect all email addresses from email with their directions
   */
  private collectEmailParticipants(
    email: Email
  ): Map<string, { direction: 'from' | 'to' | 'cc' | 'bcc'; name?: string }> {
    const participants = new Map<string, { direction: 'from' | 'to' | 'cc' | 'bcc'; name?: string }>();

    if (email.from?.email) {
      participants.set(email.from.email.toLowerCase(), {
        direction: 'from',
        name: email.from.name,
      });
    }

    for (const to of email.tos || []) {
      if (to.email && !participants.has(to.email.toLowerCase())) {
        participants.set(to.email.toLowerCase(), { direction: 'to', name: to.name });
      }
    }

    for (const cc of email.ccs || []) {
      if (cc.email && !participants.has(cc.email.toLowerCase())) {
        participants.set(cc.email.toLowerCase(), { direction: 'cc', name: cc.name });
      }
    }

    for (const bcc of email.bccs || []) {
      if (bcc.email && !participants.has(bcc.email.toLowerCase())) {
        participants.set(bcc.email.toLowerCase(), { direction: 'bcc', name: bcc.name });
      }
    }

    return participants;
  }

  /**
   * Merge contacts from API response with ensured contacts
   */
  private mergeContacts(
    apiContacts: Array<{ id: string; email: string; name?: string; customerId?: string }>,
    ensuredContacts: Array<{ id: string; email: string; name?: string; customerId?: string }>
  ): Array<{ id: string; email: string; name?: string; customerId?: string }> {
    const result = [...apiContacts];
    const existingEmails = new Set(apiContacts.map((c) => c.email.toLowerCase()));

    for (const contact of ensuredContacts) {
      if (!existingEmails.has(contact.email.toLowerCase())) {
        result.push(contact);
      }
    }

    return result;
  }

  /**
   * Build a single participant record
   *
   * Note: Even for internal users, we check if there's a contact record with a customerId.
   * This allows emails involving internal users (who are also contacts) to be linked to customers,
   * enabling proper email counting in customer views.
   */
  private buildParticipantRecord(
    tenantId: string,
    emailId: string,
    emailAddr: string,
    info: { direction: 'from' | 'to' | 'cc' | 'bcc'; name?: string },
    usersMap: Map<string, any>,
    contactsMap: Map<string, any>,
    newContactsMap: Map<string, { id: string; customerId?: string }>
  ): NewEmailParticipant | null {
    const user = usersMap.get(emailAddr);

    // Check for contact with customerId (used for both users and contacts)
    const newContact = newContactsMap.get(emailAddr);
    const dbContact = contactsMap.get(emailAddr);
    const contactCustomerId = newContact?.customerId || dbContact?.customerId || null;

    if (user) {
      return {
        tenantId,
        emailId,
        participantType: 'user',
        participantId: user.id,
        email: emailAddr,
        name: info.name || `${user.firstName} ${user.lastName}`.trim(),
        direction: info.direction,
        customerId: contactCustomerId, // Use contact's customerId if available
      };
    }

    const contact = newContact || (dbContact ? { id: dbContact.id, customerId: dbContact.customerId } : null);

    if (contact) {
      return {
        tenantId,
        emailId,
        participantType: 'contact',
        participantId: contact.id,
        email: emailAddr,
        name: info.name || dbContact?.name,
        direction: info.direction,
        customerId: contact.customerId || null,
      };
    }

    return null;
  }
}
