import { injectable, inject } from 'tsyringe';
import { EmailRepository } from './repository';
import { EmailThreadRepository } from './thread-repository';
import { TenantRepository } from '../tenants/repository';
import { ContactRepository } from '../contacts/repository';
import type { NewEmail, NewEmailThread } from './schema';
import { EmailAnalysisStatus } from './schema';
import { threadToDb, emailToDb, computeEmailContentHash, isReplyEmail } from './converter';
import { emailCollectionSchema, type EmailCollection, type Email, type RequestHeader } from '@crm/shared';
import type { AnalyzedEmailSearchRequest, AnalyzedEmailSearchResponse, AnalyzedEmail, AnalyzedEmailExportItem } from '@crm/clients';
import type { Database, Transaction } from '@crm/database';
import { emails, emailThreads } from './schema';
import { eq, and, sql, inArray } from 'drizzle-orm';
import { createHash } from 'crypto';
import { logger } from '../utils/logger';
import { getEnv } from '../env';

@injectable()
export class EmailService {
  constructor(
    @inject(EmailRepository) private emailRepo: EmailRepository,
    @inject(EmailThreadRepository) private threadRepo: EmailThreadRepository,
    @inject(TenantRepository) private tenantRepo: TenantRepository,
    @inject(ContactRepository) private contactRepo: ContactRepository,
    @inject('Database') private db: Database
  ) {}

  /**
   * Bulk insert emails with threads
   * Accepts email collections and handles thread creation/updates
   * Validates input using Zod schemas
   */
  async bulkInsertWithThreads(
    tenantId: string,
    integrationId: string,
    emailCollections: EmailCollection[]
  ): Promise<{ insertedCount: number; skippedCount: number; threadsCreated: number }> {
    if (!emailCollections || !Array.isArray(emailCollections)) {
      throw new Error('emailCollections array is required');
    }

    if (!integrationId) {
      throw new Error('integrationId is required');
    }

    // Validate all email collections
    for (let i = 0; i < emailCollections.length; i++) {
      const result = emailCollectionSchema.safeParse(emailCollections[i]);
      if (!result.success) {
        // Log the validation error with the actual data for debugging
        const errorDetails = result.error.issues.map(issue => ({
          path: issue.path.join('.'),
          message: issue.message,
          code: issue.code,
        }));

        // Extract the failing value from the path
        let failingValue: unknown = emailCollections[i];
        for (const pathPart of result.error.issues[0]?.path || []) {
          if (failingValue && typeof failingValue === 'object' && (typeof pathPart === 'string' || typeof pathPart === 'number')) {
            failingValue = (failingValue as Record<string | number, unknown>)[pathPart];
          }
        }

        logger.error({
          index: i,
          errors: errorDetails,
          failingValue,
          threadId: emailCollections[i]?.thread?.threadId,
          emailCount: emailCollections[i]?.emails?.length,
        }, 'Email collection validation failed');

        throw new Error(`Invalid email collection at index ${i}: ${result.error.message}`);
      }
    }

    // Fetch tenant domains for TAT tracking (firstReplyAt updates)
    const tenant = await this.tenantRepo.findById(tenantId);
    const tenantDomains = tenant?.domains?.length ? tenant.domains : null;

    let totalInserted = 0;
    let totalSkipped = 0;
    let threadsCreated = 0;
    const emailsToAnalyze: Array<{ emailId: string; threadId: string }> = [];
    // Reply markers for first-reply (TAT) tracking. Reply emails (SENT label or
    // tenant-domain sender) are never stored — we only record their timestamp so
    // we can set firstReplyAt on the customer email they answered.
    const replyMarkers: Array<{ threadId: string; receivedAt: Date }> = [];

    // Batch-level dedup sets — shared across all collections in this batch
    // Catches forwarded copies that land in different Gmail threads
    const batchSeenRfcIds = new Set<string>();
    const batchSeenHashes = new Set<string>();

    for (const collection of emailCollections) {
      // Save thread and emails transactionally
      // Ensures data consistency: either both succeed or both fail
      const result = await this.saveThreadWithEmailsTransactionally(
        tenantId,
        integrationId,
        collection,
        tenantDomains,
        batchSeenRfcIds,
        batchSeenHashes
      );

      threadsCreated += result.threadCreated ? 1 : 0;
      totalInserted += result.insertedCount;
      totalSkipped += result.skippedCount;

      // Collect emails that need analysis
      for (const emailId of result.emailsToAnalyze) {
        emailsToAnalyze.push({
          emailId,
          threadId: result.threadId,
        });
      }

      // Collect reply markers for first-reply (TAT) tracking. Reply emails are
      // detected and excluded from storage inside the transaction; here we only
      // carry their timestamps so we can set firstReplyAt afterwards.
      if (result.threadId) {
        for (const receivedAt of result.replyReceivedAts) {
          replyMarkers.push({ threadId: result.threadId, receivedAt });
        }
      }
    }

    // Update firstReplyAt for customer emails in threads with replies (outside transaction).
    // Process replies oldest-first so each customer email is matched to its first
    // subsequent reply (updateFirstReplyForThread only fills rows where first_reply_at IS NULL).
    if (replyMarkers.length > 0) {
      const sortedReplies = [...replyMarkers].sort(
        (a, b) => a.receivedAt.getTime() - b.receivedAt.getTime()
      );
      for (const reply of sortedReplies) {
        try {
          await this.emailRepo.updateFirstReplyForThread(
            tenantId,
            reply.threadId,
            reply.receivedAt
          );
        } catch (error) {
          // Log but don't fail - TAT data is not critical
          logger.warn(
            {
              tenantId,
              threadId: reply.threadId,
              error: error instanceof Error ? error.message : 'Unknown error',
            },
            'Failed to update firstReplyAt for customer emails'
          );
        }
      }
    }

    // Log batch-level dedup summary
    const batchDedupTotal = batchSeenRfcIds.size + batchSeenHashes.size;
    logger.info(
      {
        tenantId,
        integrationId,
        collections: emailCollections.length,
        threadsCreated,
        totalInserted,
        totalSkipped,
        analysisQueued: emailsToAnalyze.length,
        dedupTracked: {
          rfcMessageIds: batchSeenRfcIds.size,
          contentHashes: batchSeenHashes.size,
        },
      },
      'Email bulk insert complete'
    );

    // Trigger analysis for emails that need it (outside transaction)
    // If Inngest event send fails, email is still saved and can be retried later
    for (const { emailId, threadId } of emailsToAnalyze) {
      await this.triggerEmailAnalysis(tenantId, emailId, threadId);
    }

    return {
      insertedCount: totalInserted,
      skippedCount: totalSkipped,
      threadsCreated,
    };
  }

  /**
   * Bulk insert emails (legacy method for backward compatibility)
   * @deprecated Use bulkInsertWithThreads instead
   */
  async bulkInsert(emails: NewEmail[]) {
    if (!emails || !Array.isArray(emails)) {
      throw new Error('emails array is required');
    }

    return this.emailRepo.bulkInsert(emails);
  }

  /**
   * List emails for tenant with pagination
   */
  async findByTenant(tenantId: string, options?: { limit?: number; offset?: number }) {
    if (!tenantId) {
      throw new Error('tenantId is required');
    }

    const limit = options?.limit || 50;
    const offset = options?.offset || 0;

    const emails = await this.emailRepo.findByTenant(tenantId, { limit, offset });

    return {
      emails,
      count: emails.length,
      limit,
      offset,
    };
  }

  /**
   * Get emails by thread
   */
  /**
   * Find email by ID
   * @param emailId - Email UUID
   * Note: tenantId will be extracted from the email record
   * Future: tenant isolation will be handled via requestHeader middleware
   */
  async findById(emailId: string) {
    if (!emailId) {
      throw new Error('emailId is required');
    }

    return this.emailRepo.findById(emailId);
  }

  async findByThread(tenantId: string, threadId: string) {
    if (!tenantId) {
      throw new Error('tenantId is required');
    }

    if (!threadId) {
      throw new Error('threadId is required');
    }

    const emails = await this.emailRepo.findByThread(tenantId, threadId);

    return {
      emails,
      threadId,
      count: emails.length,
    };
  }

  /**
   * Check if email exists
   */
  async exists(tenantId: string, provider: string, messageId: string): Promise<boolean> {
    if (!tenantId || !provider || !messageId) {
      throw new Error('tenantId, provider, and messageId are required');
    }

    return this.emailRepo.exists(tenantId, provider, messageId);
  }

  /**
   * Get emails by customer (via domain matching)
   * @deprecated Use findByCustomerScoped for user-facing queries
   */
  async findByCustomer(
    tenantId: string,
    customerId: string,
    options?: { limit?: number; offset?: number }
  ) {
    if (!tenantId) {
      throw new Error('tenantId is required');
    }

    if (!customerId) {
      throw new Error('customerId is required');
    }

    const limit = options?.limit || 50;
    const offset = options?.offset || 0;

    const [emails, total] = await Promise.all([
      this.emailRepo.findByCustomer(tenantId, customerId, { limit, offset }),
      this.emailRepo.countByCustomer(tenantId, customerId),
    ]);

    return {
      emails,
      total,
      count: emails.length,
      limit,
      offset,
      hasMore: offset + emails.length < total,
    };
  }

  // ===========================================================================
  // Access-Controlled Methods
  // ===========================================================================

  /**
   * List emails for tenant with access control
   * Only returns emails the user has access to via customer assignments
   */
  async findByTenantScoped(requestHeader: RequestHeader, options?: { limit?: number; offset?: number }) {
    const limit = options?.limit || 50;
    const offset = options?.offset || 0;

    const emails = await this.emailRepo.findByTenantScoped(requestHeader, { limit, offset });

    return {
      emails,
      count: emails.length,
      limit,
      offset,
    };
  }

  /**
   * Get email by ID with access control
   * Returns null if user doesn't have access
   */
  async findByIdScoped(requestHeader: RequestHeader, emailId: string) {
    if (!emailId) {
      throw new Error('emailId is required');
    }

    return this.emailRepo.findByIdScoped(requestHeader, emailId);
  }

  /**
   * Get emails by customer with access control
   * Uses email_participants for efficient access-controlled queries
   * Supports filtering by sentiment, escalation, upsell, churn signals, and date range
   */
  async findByCustomerScoped(
    requestHeader: RequestHeader,
    customerId: string,
    options?: {
      limit?: number;
      offset?: number;
      sentiment?: 'positive' | 'negative' | 'neutral';
      escalation?: boolean;
      signal?: 'upsell' | 'churn';
      tatViolation?: boolean;
      dateFrom?: string;
      dateTo?: string;
      query?: string;
    }
  ) {
    if (!customerId) {
      throw new Error('customerId is required');
    }

    const limit = options?.limit || 50;
    const offset = options?.offset || 0;
    const filters = {
      sentiment: options?.sentiment,
      escalation: options?.escalation,
      signal: options?.signal,
      tatViolation: options?.tatViolation,
      dateFrom: options?.dateFrom,
      dateTo: options?.dateTo,
      query: options?.query,
    };

    const [emails, total] = await Promise.all([
      this.emailRepo.findByCustomerScoped(requestHeader, customerId, { limit, offset, ...filters }),
      this.emailRepo.countByCustomerScoped(requestHeader, customerId, filters),
    ]);

    return {
      emails,
      total,
      count: emails.length,
      limit,
      offset,
      hasMore: offset + emails.length < total,
    };
  }

  /**
   * Save thread and emails atomically in a transaction
   * Ensures data consistency: either both are saved or neither
   * Returns emails that need analysis (new or changed)
   */
  private async saveThreadWithEmailsTransactionally(
    tenantId: string,
    integrationId: string,
    collection: EmailCollection,
    tenantDomains: string[] | null,
    batchSeenRfcIds: Set<string>,
    batchSeenHashes: Set<string>
  ): Promise<{
    threadId: string;
    threadCreated: boolean;
    insertedCount: number;
    skippedCount: number;
    emailsToAnalyze: string[]; // Email IDs that need analysis
    replyReceivedAts: Date[]; // Timestamps of reply (SENT/tenant-domain) emails — not stored
  }> {
    return await this.db.transaction(async (tx) => {
      // Step 1: Dedup check — filter out emails that are forwarded copies
      // Run before thread upsert to avoid creating empty threads when all emails are deduped.
      // Layer 1: Check by RFC 2822 Message-ID (exact match on original message)
      // Layer 2: Check by content hash (fallback when RFC Message-ID is unavailable)
      // Checks both DB and batch-level in-memory sets (for cross-collection dedup)
      const dedupResult = await this.filterDuplicateEmails(
        tx,
        tenantId,
        collection.thread.provider,
        collection.emails,
        batchSeenRfcIds,
        batchSeenHashes
      );
      const dedupSkipped = collection.emails.length - dedupResult.emails.length;

      // Log per-collection dedup results
      logger.info(
        {
          tenantId,
          providerThreadId: collection.thread.threadId,
          totalEmails: collection.emails.length,
          dedupSkipped,
          existingMessageUpdates: dedupResult.existingMessageIds.size,
          accepted: dedupResult.emails.length,
          acceptedMessageIds: dedupResult.emails.map(e => e.messageId),
          acceptedSubjects: dedupResult.emails.map(e => e.subject?.substring(0, 80)),
        },
        dedupSkipped > 0
          ? 'Dedup: skipped forwarded copies of existing emails'
          : 'Dedup: all emails accepted (no duplicates found)'
      );

      // Partition deduped emails:
      //   - storable: incoming/customer emails we persist and analyze
      //   - replies:  SENT-label OR tenant-domain sender emails. These are NEVER
      //               stored or analyzed — we keep only their timestamp to set
      //               firstReplyAt on the customer email they answered.
      const replyEmails = dedupResult.emails.filter((e) => isReplyEmail(e, tenantDomains));
      const storableEmails = dedupResult.emails.filter((e) => !isReplyEmail(e, tenantDomains));
      const replyReceivedAts = replyEmails.map((e) => new Date(e.receivedAt));

      // Nothing to store and no reply timestamps to record → no-op
      if (storableEmails.length === 0 && replyEmails.length === 0) {
        return {
          threadId: '',
          threadCreated: false,
          insertedCount: 0,
          skippedCount: collection.emails.length,
          emailsToAnalyze: [],
          replyReceivedAts: [],
        };
      }

      // Step 2: Resolve the thread.
      // When there are storable emails we upsert the thread. When this batch
      // contains ONLY replies, look up the existing thread so we can still set
      // firstReplyAt on customer emails stored in a previous batch.
      let threadId: string;
      let threadCreated = false;

      if (storableEmails.length === 0) {
        const existingThread = await tx
          .select({ id: emailThreads.id })
          .from(emailThreads)
          .where(
            and(
              eq(emailThreads.tenantId, tenantId),
              eq(emailThreads.integrationId, integrationId),
              eq(emailThreads.providerThreadId, collection.thread.threadId)
            )
          )
          .limit(1);

        // No existing thread → the reply has no customer email to attach to. Skip.
        if (!existingThread[0]) {
          return {
            threadId: '',
            threadCreated: false,
            insertedCount: 0,
            skippedCount: collection.emails.length,
            emailsToAnalyze: [],
            replyReceivedAts: [],
          };
        }

        return {
          threadId: existingThread[0].id,
          threadCreated: false,
          insertedCount: 0,
          skippedCount: dedupSkipped,
          emailsToAnalyze: [],
          replyReceivedAts,
        };
      }

      const threadDb = threadToDb(collection.thread, tenantId, integrationId);
      const threadResult = await tx
        .insert(emailThreads)
        .values(threadDb)
        .onConflictDoUpdate({
          target: [
            emailThreads.tenantId,
            emailThreads.integrationId,
            emailThreads.providerThreadId,
          ],
          set: {
            subject: threadDb.subject,
            lastMessageAt: sql`GREATEST(${emailThreads.lastMessageAt}, EXCLUDED.last_message_at)`,
            updatedAt: sql`CURRENT_TIMESTAMP`,
          },
        })
        .returning({ id: emailThreads.id });

      threadId = threadResult[0].id;
      threadCreated = threadResult.length > 0;

      // Step 3: Convert storable emails to database format with thread ID
      // Pass tenant domains for TAT classification (isCustomerEmail)
      const emailsDb: NewEmail[] = storableEmails.map((email) =>
        emailToDb(email, tenantId, threadId, integrationId, tenantDomains)
      );

      // Step 4: Check existing emails before insert/update (for change detection)
      const existingEmailsMap = new Map<string, { id: string; body: string | null; analysisStatus: EmailAnalysisStatus | null }>();

      const messageIds = emailsDb.map(e => e.messageId);
      const existingEmails = await tx
        .select({
          id: emails.id,
          messageId: emails.messageId,
          body: emails.body,
          analysisStatus: emails.analysisStatus,
        })
        .from(emails)
        .where(
          and(
            eq(emails.tenantId, tenantId),
            eq(emails.provider, collection.thread.provider),
            inArray(emails.messageId, messageIds)
          )
        );

      for (const existing of existingEmails) {
        existingEmailsMap.set(existing.messageId, {
          id: existing.id,
          body: existing.body,
          analysisStatus: existing.analysisStatus || null,
        });
      }

      // Step 5: Bulk insert emails atomically (skip duplicates)
      const insertedEmails = await tx
        .insert(emails)
        .values(emailsDb)
        .onConflictDoUpdate({
          target: [emails.tenantId, emails.provider, emails.messageId],
          set: {
            body: sql`EXCLUDED.body`,
            subject: sql`EXCLUDED.subject`,
            metadata: sql`EXCLUDED.metadata`,
            labels: sql`EXCLUDED.labels`,
            updatedAt: sql`CURRENT_TIMESTAMP`,
          },
        })
        .returning({
          id: emails.id,
          messageId: emails.messageId,
        });

      // Step 6: Determine which emails need analysis (within transaction)
      const emailsToAnalyze: string[] = [];

      for (const emailResult of insertedEmails) {
        const originalEmail = storableEmails.find(
          (e) => e.messageId === emailResult.messageId && e.provider === collection.thread.provider
        );

        if (!originalEmail) {
          continue; // Skip if we can't find original email
        }

        const existing = existingEmailsMap.get(emailResult.messageId);

        if (!existing) {
          // New email - always analyze
          emailsToAnalyze.push(emailResult.id);
        } else {
          // Existing email - check if body content changed and not already analyzed
          const hasChanged = this.emailBodyChanged(
            existing.body,
            originalEmail.body || ''
          );
          const alreadyAnalyzed = existing.analysisStatus === EmailAnalysisStatus.Completed;

          if (hasChanged && !alreadyAnalyzed) {
            emailsToAnalyze.push(emailResult.id);
          }
        }
      }

      // Calculate inserted vs updated counts
      const insertedCount = insertedEmails.filter(
        (e) => !existingEmailsMap.has(e.messageId)
      ).length;
      const skippedCount = dedupSkipped + (emailsDb.length - insertedEmails.length);

      // Transaction commits here - ALL OR NOTHING
      // If anything fails, entire transaction rolls back
      return {
        threadId,
        threadCreated,
        insertedCount,
        skippedCount,
        emailsToAnalyze,
        replyReceivedAts,
      };
    });
  }

  /**
   * Check if email body content has changed
   * Only compares body hash (ignores labels, metadata, etc.)
   */
  private emailBodyChanged(
    currentBody: string | null,
    newBody: string
  ): boolean {
    // Compare body hash
    const currentBodyHash = this.hashString(currentBody || '');
    const newBodyHash = this.hashString(newBody || '');

    return currentBodyHash !== newBodyHash;
  }

  /**
   * Hash a string for comparison (SHA256 hash)
   */
  private hashString(str: string): string {
    return createHash('sha256').update(str).digest('hex');
  }

  /**
   * Filter out duplicate emails that are forwarded copies of already-stored emails.
   * Uses two-layer detection:
   *   Layer 1: RFC 2822 Message-ID match (same original email)
   *   Layer 2: Content hash match (fallback when RFC Message-ID is unavailable)
   *
   * Checks against:
   *   - Existing emails in the database
   *   - Batch-level in-memory sets (forwarded copies across different collections/threads)
   *
   * Updates batchSeenRfcIds/batchSeenHashes with newly accepted emails so
   * subsequent collections in the same batch are deduped without a DB round-trip.
   *
   * Returns only the emails that are NOT duplicates.
   */
  private async filterDuplicateEmails(
    tx: Transaction,
    tenantId: string,
    provider: string,
    incomingEmails: Email[],
    batchSeenRfcIds: Set<string>,
    batchSeenHashes: Set<string>
  ): Promise<{ emails: Email[]; existingMessageIds: Set<string> }> {
    if (incomingEmails.length === 0) {
      return { emails: [], existingMessageIds: new Set<string>() };
    }

    const candidates = incomingEmails.map((email) => ({
      email,
      rfcMessageId: (email.metadata?.rfcMessageId as string | undefined) || null,
      contentHash: computeEmailContentHash(email),
    }));

    const messageIds = candidates.map(c => c.email.messageId);

    const existingMessageIds = new Set<string>();
    if (messageIds.length > 0) {
      const existing = await tx
        .select({ messageId: emails.messageId })
        .from(emails)
        .where(
          and(
            eq(emails.tenantId, tenantId),
            eq(emails.provider, provider),
            inArray(emails.messageId, messageIds)
          )
        );
      for (const row of existing) {
        existingMessageIds.add(row.messageId);
      }
    }

    // Collect rfcMessageIds and fallback contentHashes to check against DB
    // Hash matching is fallback-only when RFC Message-ID is missing.
    const rfcMessageIds = candidates
      .map(c => c.rfcMessageId)
      .filter((id): id is string => !!id && !batchSeenRfcIds.has(id));
    const contentHashes = candidates
      .filter(c => !c.rfcMessageId)
      .map(c => c.contentHash)
      .filter((hash): hash is string => !!hash && !batchSeenHashes.has(hash));

    // Batch query: find existing emails in DB with matching rfcMessageId or contentHash
    const dbRfcIds = new Set<string>();
    const dbHashes = new Set<string>();

    if (rfcMessageIds.length > 0) {
      const existing = await tx
        .select({ rfcMessageId: emails.rfcMessageId })
        .from(emails)
        .where(
          and(
            eq(emails.tenantId, tenantId),
            inArray(emails.rfcMessageId, rfcMessageIds)
          )
        );
      for (const row of existing) {
        if (row.rfcMessageId) dbRfcIds.add(row.rfcMessageId);
      }
    }

    if (contentHashes.length > 0) {
      const existing = await tx
        .select({ contentHash: emails.contentHash })
        .from(emails)
        .where(
          and(
            eq(emails.tenantId, tenantId),
            inArray(emails.contentHash, contentHashes)
          )
        );
      for (const row of existing) {
        if (row.contentHash) dbHashes.add(row.contentHash);
      }
    }

    // Filter: keep only emails that don't match DB or batch-level sets
    const skippedByRfc: Array<{ messageId: string; rfcMessageId: string; source: string }> = [];
    const skippedByHash: Array<{ messageId: string; contentHash: string; source: string }> = [];

    const filtered = candidates.filter(({ email, rfcMessageId, contentHash }) => {
      // Preserve existing provider message IDs so upsert can refresh metadata/labels/body.
      if (existingMessageIds.has(email.messageId)) {
        return true;
      }

      // Layer 1: RFC Message-ID match
      if (rfcMessageId) {
        if (dbRfcIds.has(rfcMessageId) || batchSeenRfcIds.has(rfcMessageId)) {
          skippedByRfc.push({
            messageId: email.messageId,
            rfcMessageId,
            source: dbRfcIds.has(rfcMessageId) ? 'db' : 'batch',
          });
          return false;
        }
      }

      // Layer 2: Content hash match (fallback only when RFC Message-ID missing)
      if (!rfcMessageId && contentHash) {
        if (dbHashes.has(contentHash) || batchSeenHashes.has(contentHash)) {
          skippedByHash.push({
            messageId: email.messageId,
            contentHash,
            source: dbHashes.has(contentHash) ? 'db' : 'batch',
          });
          return false;
        }
      }

      // Accept this email — track in batch sets for subsequent collections
      if (rfcMessageId) batchSeenRfcIds.add(rfcMessageId);
      if (!rfcMessageId && contentHash) batchSeenHashes.add(contentHash);

      return true;
    });

    // Log dedup decisions at info level for production visibility
    if (skippedByRfc.length > 0 || skippedByHash.length > 0) {
      logger.info(
        {
          tenantId,
          provider,
          incoming: incomingEmails.length,
          accepted: filtered.length,
          skippedByRfc: skippedByRfc.length,
          skippedByHash: skippedByHash.length,
          existingMessageUpdates: existingMessageIds.size,
          rfcDetails: skippedByRfc,
          hashDetails: skippedByHash,
        },
        'Dedup: filtered duplicate emails'
      );
    }

    return {
      emails: filtered.map(c => c.email),
      existingMessageIds,
    };
  }

  /**
   * Trigger durable email analysis via Inngest
   * This ensures analysis survives service restarts and failures
   *
   * Idempotency is ensured at multiple levels:
   * 1. Event ID: Uses emailId as event ID for Inngest deduplication
   * 2. Function idempotency: Inngest function uses emailId as idempotency key
   * 3. DB check: Function checks analysisStatus before executing
   */
  private async triggerEmailAnalysis(
    tenantId: string,
    emailId: string,
    threadId: string
  ): Promise<void> {
    try {
      // Import Inngest client dynamically to avoid circular dependencies
      const { inngest } = await import('../inngest/client');

      // Use emailId as event ID for deduplication at Inngest level
      const eventId = `email-analysis-${emailId}`;

      const eventData = {
        id: eventId, // Idempotency key - Inngest will dedupe events with same ID
        name: 'email/inserted' as const,
        data: {
          tenantId,
          emailId, // Database UUID
          threadId, // Database UUID
          // NO email content - fetched from DB when processing
        },
      };

      // IDEMPOTENCY LOG: Track event creation attempt
      logger.warn(
        {
          tenantId,
          emailId,
          threadId,
          eventId,
          eventName: eventData.name,
          inngestEventKey: getEnv().INNGEST_EVENT_KEY ? 'configured' : 'missing',
          logType: 'INNGEST_EVENT_SEND_ATTEMPT',
        },
        'INNGEST EVENT: Attempting to send email/inserted event'
      );

      // Send event to Inngest for durable processing
      // Inngest will dedupe based on event ID and retry on failures
      const sendResult = await inngest.send(eventData);

      // IDEMPOTENCY LOG: Event sent successfully
      logger.warn(
        {
          tenantId,
          emailId,
          threadId,
          eventId,
          sendResult: sendResult ? 'success' : 'unknown',
          logType: 'INNGEST_EVENT_SENT',
        },
        'INNGEST EVENT: Successfully sent email/inserted event'
      );
    } catch (error: any) {
      // Log error but don't fail email insertion
      // Email is already saved, analysis can be retried later
      logger.error(
        {
          error: {
            message: error.message,
            stack: error.stack,
            name: error.name,
            code: error.code,
          },
          tenantId,
          emailId,
          threadId,
          inngestEventKey: getEnv().INNGEST_EVENT_KEY ? 'configured' : 'missing',
          logType: 'INNGEST_EVENT_FAILED',
        },
        'INNGEST EVENT: Failed to send (email saved, analysis may need manual retry)'
      );
    }
  }

  // ===========================================================================
  // Dashboard Statistics Methods
  // ===========================================================================

  /**
   * Get dashboard email statistics with access control
   */
  async getDashboardStats(
    requestHeader: RequestHeader,
    filters?: {
      customerId?: string;
      dateFrom?: string;
      dateTo?: string;
    }
  ) {
    return this.emailRepo.getDashboardStatsScoped(requestHeader, filters);
  }

  /**
   * Get sentiment distribution for dashboard with access control
   */
  async getSentimentStats(
    requestHeader: RequestHeader,
    filters?: {
      customerId?: string;
      dateFrom?: string;
      dateTo?: string;
    }
  ) {
    return this.emailRepo.getSentimentStatsScoped(requestHeader, filters);
  }

  /**
   * Get upsell opportunity count for dashboard with access control
   */
  async getUpsellCount(
    requestHeader: RequestHeader,
    filters?: {
      customerId?: string;
      dateFrom?: string;
      dateTo?: string;
    }
  ) {
    return this.emailRepo.getUpsellCountScoped(requestHeader, filters);
  }

  /**
   * Get sentiment trend data for dashboard with access control
   * Returns monthly percentages over last 6 months
   */
  async getSentimentTrend(
    requestHeader: RequestHeader,
    filters?: {
      customerId?: string;
    }
  ) {
    return this.emailRepo.getSentimentTrendScoped(requestHeader, filters);
  }

  /**
   * Get email volume trend data for dashboard with access control
   * Returns weekly counts for last 4 weeks
   */
  async getEmailVolumeTrend(
    requestHeader: RequestHeader,
    filters?: {
      customerId?: string;
    }
  ) {
    return this.emailRepo.getEmailVolumeTrendScoped(requestHeader, filters);
  }

  /**
   * Get TAT metrics for dashboard
   * Returns SLA breach counts grouped by customer and controller
   */
  async getTATMetrics(
    requestHeader: RequestHeader,
    filters?: {
      customerId?: string;
      dateFrom?: string;
      dateTo?: string;
    }
  ) {
    return this.emailRepo.getTATMetricsScoped(requestHeader, filters);
  }

  // ===========================================================================
  // Analyzed Email Search
  // ===========================================================================

  /**
   * Search analyzed emails with optional task overlay
   */
  async searchAnalyzedEmails(
    requestHeader: RequestHeader,
    request: AnalyzedEmailSearchRequest
  ): Promise<AnalyzedEmailSearchResponse> {
    return this.emailRepo.searchAnalyzedEmails(requestHeader, request);
  }

  /**
   * Get a single analyzed email with task overlay.
   * `id` may be an email id or a task id (task→email is resolved in the repo),
   * so escalation links that carry a task id still open the right email.
   */
  async getAnalyzedEmailById(
    requestHeader: RequestHeader,
    id: string
  ): Promise<AnalyzedEmail | null> {
    return this.emailRepo.getAnalyzedEmailById(requestHeader, id);
  }

  /**
   * Export analyzed emails with comments and contact roles
   * No pagination - returns all matching results for XLSX export
   */
  async exportAnalyzedEmails(
    requestHeader: RequestHeader,
    request: AnalyzedEmailSearchRequest
  ): Promise<AnalyzedEmailExportItem[]> {
    const rows = await this.emailRepo.exportAnalyzedEmails(requestHeader, request);

    if (rows.length === 0) {
      return [];
    }

    // Collect unique customerIds for contact role lookup
    const uniqueCustomerIds = [...new Set(rows.map(r => r.customerId))];

    // Fetch contacts for all customers in parallel
    const contactsByCustomer = new Map<string, Array<{ name: string | null; title: string | null }>>();
    const contactResults = await Promise.all(
      uniqueCustomerIds.map(async (customerId) => {
        const contacts = await this.contactRepo.findByCustomerId(customerId);
        return { customerId, contacts };
      })
    );
    for (const { customerId, contacts } of contactResults) {
      contactsByCustomer.set(customerId, contacts.map(c => ({ name: c.name, title: c.title })));
    }

    return rows.map(row => ({
      ...row,
      comments: row.taskComments,
      contactRoles: this.matchContactRoles(contactsByCustomer.get(row.customerId)),
    }));
  }

  /**
   * Match contact titles to standard roles (Book Keeping, Accountant, Controller, Sr Controller)
   */
  private matchContactRoles(
    contacts?: Array<{ name: string | null; title: string | null }>
  ): { bookKeeping: string; accountant: string; controller: string; srController: string } {
    const result = { bookKeeping: '', accountant: '', controller: '', srController: '' };
    if (!contacts) return result;

    const matchers: Array<{ key: keyof typeof result; patterns: string[] }> = [
      { key: 'srController', patterns: ['sr controller', 'sr. controller', 'senior controller'] },
      { key: 'controller', patterns: ['controller'] },
      { key: 'bookKeeping', patterns: ['book keeping', 'bookkeeping', 'book keeper', 'bookkeeper'] },
      { key: 'accountant', patterns: ['accountant'] },
    ];

    for (const contact of contacts) {
      const titleLower = (contact.title || '').toLowerCase().trim();
      if (!titleLower) continue;
      for (const { key, patterns } of matchers) {
        if (result[key]) continue;
        if (patterns.some(p => titleLower.includes(p))) {
          result[key] = contact.name || contact.title || '';
        }
      }
    }
    return result;
  }
}
