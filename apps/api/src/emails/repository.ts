import { injectable, inject } from 'tsyringe';
import { ScopedRepository } from '@crm/database';
import type { Database, Transaction } from '@crm/database';
import { isAdmin, type RequestHeader, type TATMetricRow, Signal, getSentimentFromSignals } from '@crm/shared';
import type { NewEmail, NewEmailParticipant } from './schema';
import { emails, EmailAnalysisStatus, emailParticipants, emailAnalyses } from './schema';
import { taskComments } from '../tasks/schema';
import { customers } from '../customers/schema';
import { users } from '../users/schema';
import { eq, and, desc, asc, sql, inArray, or, ilike, isNotNull, SQL } from 'drizzle-orm';
import { logger } from '../utils/logger';
import type { AnalyzedEmail, AnalyzedEmailListItem, AnalyzedEmailSearchRequest, AnalyzedEmailSearchResponse } from '@crm/clients';

/**
 * One outbound reply, as far as first-reply (TAT) attribution is concerned.
 * Reply messages are never stored, so this is all we carry into the UPDATE.
 */
export interface FirstReplyCandidate {
  /** When the reply was sent. */
  receivedAt: Date;
  /**
   * Lowercased To + Cc addresses of the reply. A customer email is only answered
   * by this reply if its own sender (the originator) appears here.
   */
  recipients: string[];
  /** users.id of the sender, or null when the address matches no user in the tenant. */
  repliedById: string | null;
}

// Re-export TATMetricRow from shared
export type { TATMetricRow } from '@crm/shared';

// Helper to build signal containment condition
// PostgreSQL: signals @> ARRAY[signalValue]
function signalContains(signalValue: number): SQL {
  return sql`${emails.signals} @> ARRAY[${signalValue}]::integer[]`;
}

// Helper to build signal overlap condition (has any of the signals)
// PostgreSQL: signals && ARRAY[...]
function signalOverlaps(signalValues: number[]): SQL {
  return sql`${emails.signals} && ARRAY[${sql.join(signalValues.map(v => sql`${v}`), sql`, `)}]::integer[]`;
}

@injectable()
export class EmailRepository extends ScopedRepository {
  /**
   * Render a reply's recipient list as a typed Postgres array literal. An empty
   * list yields `ARRAY[]::text[]`, which matches nothing under the originator
   * rule — the correct outcome for a reply with no addressable recipients.
   */
  private static recipientsArray(recipients: string[]): SQL {
    return sql`ARRAY[${sql.join(
      recipients.map((r) => sql`${r}`),
      sql`, `
    )}]::text[]`;
  }

  constructor(@inject('Database') db: Database) {
    super(db);
  }

  /**
   * Build freeform search condition for emails.
   * Searches across: subject and participant emails/names.
   */
  override buildFreeformSearch(searchTerm: string): SQL | undefined {
    if (!searchTerm || searchTerm.trim() === '') {
      return undefined;
    }
    const term = `%${searchTerm}%`;
    return sql`(
      ${emails.subject} ILIKE ${term} OR
      ${emails.id} IN (
        SELECT ${emailParticipants.emailId}
        FROM ${emailParticipants}
        WHERE ${emailParticipants.email} ILIKE ${term}
          OR ${emailParticipants.name} ILIKE ${term}
      )
    )`;
  }

  async bulkInsert(emailData: NewEmail[]) {
    if (emailData.length === 0) {
      return { insertedCount: 0, skippedCount: 0 };
    }

    try {
      // Insert emails, skip duplicates based on (tenantId, provider, messageId) unique constraint
      const result = await this.db
        .insert(emails)
        .values(emailData)
        .onConflictDoNothing({
          target: [emails.tenantId, emails.provider, emails.messageId],
        })
        .returning({ id: emails.id });

      return {
        insertedCount: result.length,
        skippedCount: emailData.length - result.length,
      };
    } catch (error: any) {
      logger.error({
        error: {
          message: error.message,
          stack: error.stack,
          name: error.name,
          code: error.code,
        },
        emailCount: emailData.length,
        sampleTenantId: emailData[0]?.tenantId,
      }, 'Failed to bulk insert emails');
      throw error;
    }
  }

  async findByTenant(tenantId: string, options?: { limit?: number; offset?: number }) {
    const limit = options?.limit || 50;
    const offset = options?.offset || 0;

    return this.db
      .select()
      .from(emails)
      .where(eq(emails.tenantId, tenantId))
      .orderBy(desc(emails.receivedAt))
      .limit(limit)
      .offset(offset);
  }

  async findByThread(tenantId: string, threadId: string) {
    return this.db
      .select()
      .from(emails)
      .where(and(eq(emails.tenantId, tenantId), eq(emails.threadId, threadId)))
      .orderBy(desc(emails.receivedAt));
  }

  async exists(tenantId: string, provider: string, messageId: string): Promise<boolean> {
    const result = await this.db
      .select({ id: emails.id })
      .from(emails)
      .where(
        and(
          eq(emails.tenantId, tenantId),
          eq(emails.provider, provider),
          eq(emails.messageId, messageId)
        )
      )
      .limit(1);

    return result.length > 0;
  }

  /**
   * Find email by ID
   * @param emailId - Email UUID
   * Note: tenantId will be extracted from the email record
   * Future: tenant isolation will be handled via requestHeader middleware
   */
  /**
   * Every message on the thread that holds `emailId`, with everyone addressed
   * on each one.
   *
   * Two round trips rather than one join: joining a per-participant table onto
   * a per-message query fans out — one message with four recipients returns
   * four rows, and the counts downstream are silently wrong. That mistake has
   * already been made once in this codebase (501 threads became 2,089), so the
   * participants are fetched separately and grouped in memory.
   *
   * Tenant-scoped on the emails query. Participants are then constrained to the
   * ids that query returned, so they inherit the same scope.
   */
  async findThreadWithParticipants(tenantId: string, emailId: string) {
    const focused = await this.db
      .select({ threadId: emails.threadId })
      .from(emails)
      .where(and(eq(emails.id, emailId), eq(emails.tenantId, tenantId)))
      .limit(1);

    const threadId = focused[0]?.threadId ?? null;

    // A message with no thread_id is its own thread of one. Falling back to the
    // email id keeps the panel working rather than rendering an empty rail.
    const messages = await this.db
      .select({
        id: emails.id,
        subject: emails.subject,
        body: emails.body,
        fromEmail: emails.fromEmail,
        fromName: emails.fromName,
        receivedAt: emails.receivedAt,
      })
      .from(emails)
      .where(
        and(
          eq(emails.tenantId, tenantId),
          threadId ? eq(emails.threadId, threadId) : eq(emails.id, emailId)
        )
      )
      .orderBy(asc(emails.receivedAt));

    if (messages.length === 0) return { threadId, messages: [], participants: [] };

    const participants = await this.db
      .select({
        emailId: emailParticipants.emailId,
        email: emailParticipants.email,
        name: emailParticipants.name,
        direction: emailParticipants.direction,
        participantType: emailParticipants.participantType,
      })
      .from(emailParticipants)
      .where(
        and(
          eq(emailParticipants.tenantId, tenantId),
          inArray(
            emailParticipants.emailId,
            messages.map((m) => m.id)
          )
        )
      );

    return { threadId, messages, participants };
  }

  async findById(emailId: string) {
    const result = await this.db
      .select()
      .from(emails)
      .where(eq(emails.id, emailId))
      .limit(1);

    return result[0] || null;
  }

  /**
   * Update email signals after analysis, unless they've been manually overridden.
   *
   * A single conditional UPDATE (`WHERE signals_overridden = false`) enforces the
   * lock without an extra read on the hot path: an overridden email simply matches
   * no rows and is left untouched.
   *
   * @param emailId - Email UUID
   * @param signals - Array of Signal integers (from @crm/shared Signal constants)
   * @param tx - Optional transaction context
   * @returns true if signals were written, false if skipped due to an override
   */
  async updateSignalsUnlessOverridden(
    emailId: string,
    signals: number[],
    tx?: Transaction
  ): Promise<boolean> {
    const db = tx ?? this.db;
    const rows = await db
      .update(emails)
      .set({
        signals,
        updatedAt: new Date(),
      })
      .where(and(eq(emails.id, emailId), eq(emails.signalsOverridden, false)))
      .returning({ id: emails.id });
    return rows.length > 0;
  }

  /**
   * Manually override an email's signals and lock them.
   * Sets `signalsOverridden = true` so the analysis pipeline will skip
   * overwriting these signals on any future re-analysis.
   * @param emailId - Email UUID
   * @param signals - Array of Signal integers (from @crm/shared Signal constants)
   * @param tx - Optional transaction context
   */
  async overrideSignals(
    emailId: string,
    signals: number[],
    tx?: Transaction
  ): Promise<void> {
    const db = tx ?? this.db;
    await db
      .update(emails)
      .set({
        signals,
        signalsOverridden: true,
        updatedAt: new Date(),
      })
      .where(eq(emails.id, emailId));
  }

  /**
   * Update email analysis status
   * @param emailId - Email UUID
   * @param status - Analysis status
   * @param tx - Optional transaction context
   */
  async updateAnalysisStatus(
    emailId: string,
    status: EmailAnalysisStatus,
    tx?: Transaction
  ): Promise<void> {
    const db = tx ?? this.db;
    await db
      .update(emails)
      .set({
        analysisStatus: status,
        updatedAt: new Date(),
      })
      .where(eq(emails.id, emailId));
  }

  /**
   * Find emails by customer using email_participants
   */
  async findByCustomer(
    tenantId: string,
    customerId: string,
    options?: { limit?: number; offset?: number }
  ) {
    const limit = options?.limit || 50;
    const offset = options?.offset || 0;

    // ATTRIBUTED TWO WAYS, BECAUSE THE PANEL AND THIS PAGE DISAGREED.
    //
    // This filtered on email_participants.customer_id alone. "Where the fires
    // are" counts by SENDER DOMAIN, because participant attribution credits a
    // client for mail they merely received — of 1,484 participant rows behind
    // that population, only 275 were cases where the customer actually wrote.
    //
    // The panel was fixed and this was not, so a row reading "Berolzheimer, 3
    // unanswered" linked to a page that answered "No analyzed emails found":
    // six emails by sender domain, one by participant link, zero after the
    // status and date filters. A destination that contradicts the row it came
    // from is worse than no link.
    //
    // Both paths are kept rather than swapping to domain alone: participant
    // links are often wrong but not always absent, and narrowing this would
    // silently drop mail the page shows today.
    const attributedToCustomer = or(
      eq(emailParticipants.customerId, customerId),
      sql`EXISTS (
        SELECT 1 FROM customer_domains cd
        WHERE cd.customer_id = ${customerId}
          AND cd.tenant_id = ${emails.tenantId}
          AND lower(cd.domain) = split_part(lower(${emails.fromEmail}), '@', 2)
      )`
    );

    return this.db
      .selectDistinct({ emails })
      .from(emails)
      .leftJoin(emailParticipants, eq(emails.id, emailParticipants.emailId))
      .where(and(eq(emails.tenantId, tenantId), attributedToCustomer))
      .orderBy(desc(emails.receivedAt))
      .limit(limit)
      .offset(offset)
      .then(rows => rows.map(r => r.emails));
  }

  /**
   * Count emails by customer using email_participants
   */
  async countByCustomer(tenantId: string, customerId: string): Promise<number> {
    // ATTRIBUTED TWO WAYS, BECAUSE THE PANEL AND THIS PAGE DISAGREED.
    //
    // This filtered on email_participants.customer_id alone. "Where the fires
    // are" counts by SENDER DOMAIN, because participant attribution credits a
    // client for mail they merely received — of 1,484 participant rows behind
    // that population, only 275 were cases where the customer actually wrote.
    //
    // The panel was fixed and this was not, so a row reading "Berolzheimer, 3
    // unanswered" linked to a page that answered "No analyzed emails found":
    // six emails by sender domain, one by participant link, zero after the
    // status and date filters. A destination that contradicts the row it came
    // from is worse than no link.
    //
    // Both paths are kept rather than swapping to domain alone: participant
    // links are often wrong but not always absent, and narrowing this would
    // silently drop mail the page shows today.
    const attributedToCustomer = or(
      eq(emailParticipants.customerId, customerId),
      sql`EXISTS (
        SELECT 1 FROM customer_domains cd
        WHERE cd.customer_id = ${customerId}
          AND cd.tenant_id = ${emails.tenantId}
          AND lower(cd.domain) = split_part(lower(${emails.fromEmail}), '@', 2)
      )`
    );

    const result = await this.db
      .select({ count: sql<number>`count(DISTINCT ${emails.id})::int` })
      .from(emails)
      .leftJoin(emailParticipants, eq(emails.id, emailParticipants.emailId))
      .where(and(eq(emails.tenantId, tenantId), attributedToCustomer));

    return result[0]?.count || 0;
  }

  /**
   * Get email counts for multiple customers in a single query
   * Uses email_participants table for efficient lookup
   */
  async getCountsByCustomerIds(
    tenantId: string,
    customerIds: string[]
  ): Promise<Record<string, number>> {
    if (customerIds.length === 0) {
      return {};
    }

    // Count emails per customer using email_participants
    const result = await this.db
      .select({
        customerId: emailParticipants.customerId,
        count: sql<number>`count(DISTINCT ${emails.id})::int`,
      })
      .from(emailParticipants)
      .innerJoin(emails, eq(emails.id, emailParticipants.emailId))
      .where(
        and(
          eq(emails.tenantId, tenantId),
          inArray(emailParticipants.customerId, customerIds)
        )
      )
      .groupBy(emailParticipants.customerId);

    // Build result map with zeros for customers with no emails
    const counts: Record<string, number> = {};
    for (const customerId of customerIds) {
      counts[customerId] = 0;
    }
    for (const row of result) {
      if (row.customerId) {
        counts[row.customerId] = row.count;
      }
    }

    return counts;
  }

  /**
   * Get the last contact date for multiple customers
   * Uses email_participants table for efficient lookup
   */
  async getLastContactDatesByCustomerIds(
    tenantId: string,
    customerIds: string[]
  ): Promise<Record<string, Date>> {
    if (customerIds.length === 0) {
      return {};
    }

    // Get the most recent email date per customer using email_participants
    const result = await this.db
      .select({
        customerId: emailParticipants.customerId,
        lastContactAt: sql<Date>`max(${emails.receivedAt})`,
      })
      .from(emailParticipants)
      .innerJoin(emails, eq(emails.id, emailParticipants.emailId))
      .where(
        and(
          eq(emails.tenantId, tenantId),
          inArray(emailParticipants.customerId, customerIds)
        )
      )
      .groupBy(emailParticipants.customerId);

    const lastContacts: Record<string, Date> = {};
    for (const row of result) {
      if (row.customerId && row.lastContactAt) {
        lastContacts[row.customerId] = row.lastContactAt;
      }
    }

    return lastContacts;
  }

  /**
   * Get aggregate sentiment for multiple customers
   * Uses email_participants table for efficient lookup
   * Reads sentiment from signals array using Signal constants
   */
  async getAggregateSentimentByCustomerIds(
    tenantId: string,
    customerIds: string[]
  ): Promise<Record<string, { value: 'positive' | 'negative' | 'neutral'; confidence: number }>> {
    if (customerIds.length === 0) {
      return {};
    }

    // Query emails with sentiment signals via email_participants
    const emailsResult = await this.db
      .select({
        customerId: emailParticipants.customerId,
        signals: emails.signals,
      })
      .from(emailParticipants)
      .innerJoin(emails, eq(emails.id, emailParticipants.emailId))
      .where(
        and(
          eq(emails.tenantId, tenantId),
          inArray(emailParticipants.customerId, customerIds),
          // Has any sentiment signal
          signalOverlaps([Signal.SENTIMENT_POSITIVE, Signal.SENTIMENT_NEGATIVE, Signal.SENTIMENT_NEUTRAL])
        )
      )
      .orderBy(desc(emails.receivedAt))
      .limit(1000);

    // Aggregate sentiment per customer
    const customerSentiments: Record<string, {
      positive: number;
      negative: number;
      neutral: number;
      count: number;
    }> = {};

    // Initialize all customers
    for (const customerId of customerIds) {
      customerSentiments[customerId] = {
        positive: 0,
        negative: 0,
        neutral: 0,
        count: 0,
      };
    }

    // Process emails
    for (const row of emailsResult) {
      if (!row.customerId) continue;
      const sentiment = getSentimentFromSignals(row.signals);

      if (!sentiment) continue;

      customerSentiments[row.customerId][sentiment]++;
      customerSentiments[row.customerId].count++;
    }

    // Calculate dominant sentiment for each customer
    const result: Record<string, { value: 'positive' | 'negative' | 'neutral'; confidence: number }> = {};

    for (const [customerId, counts] of Object.entries(customerSentiments)) {
      if (counts.count === 0) continue;

      let dominant: 'positive' | 'negative' | 'neutral' = 'neutral';
      let maxCount = counts.neutral;

      if (counts.positive > maxCount) {
        dominant = 'positive';
        maxCount = counts.positive;
      }
      if (counts.negative > maxCount) {
        dominant = 'negative';
        maxCount = counts.negative;
      }

      // Confidence is the proportion of the dominant sentiment
      const confidence = maxCount / counts.count;

      result[customerId] = {
        value: dominant,
        confidence: Math.round(confidence * 100) / 100,
      };
    }

    return result;
  }

  // ===========================================================================
  // Access-Controlled Queries (using email_participants)
  // ===========================================================================

  /**
   * Returns SQL for filtering emails by user's accessible customers.
   * Uses email_participants table to join emails to customers.
   * Admins bypass this filter.
   *
   * Query pattern:
   * - Joins emails → email_participants → user_accessible_customers
   * - Only returns emails where at least one participant is from an accessible customer
   */
  private emailAccessSubquery(header: RequestHeader): ReturnType<typeof sql> {
    if (isAdmin(header.permissions)) {
      return sql`true`;
    }
    return sql`${emails.id} IN (
      SELECT DISTINCT ep.email_id
      FROM email_participants ep
      INNER JOIN user_accessible_customers uac ON ep.customer_id = uac.customer_id
      WHERE uac.user_id = ${header.userId}
    )`;
  }

  /**
   * Returns SQL for filtering email_analyses by user's accessible customers.
   * Uses email_participants table to join via emailId.
   * Admins bypass this filter.
   */
  private emailAnalysesAccessFilter(header: RequestHeader): ReturnType<typeof sql> {
    if (isAdmin(header.permissions)) {
      return sql`true`;
    }
    return sql`${emailAnalyses.emailId} IN (
      SELECT DISTINCT ep.email_id
      FROM email_participants ep
      INNER JOIN user_accessible_customers uac ON ep.customer_id = uac.customer_id
      WHERE uac.user_id = ${header.userId}
    )`;
  }

  /**
   * Find emails with access control
   */
  async findByTenantScoped(
    header: RequestHeader,
    options?: { limit?: number; offset?: number }
  ) {
    const limit = options?.limit || 50;
    const offset = options?.offset || 0;

    return this.db
      .select()
      .from(emails)
      .where(
        and(
          this.tenantFilter(emails.tenantId, header),
          this.emailAccessSubquery(header)
        )
      )
      .orderBy(desc(emails.receivedAt))
      .limit(limit)
      .offset(offset);
  }

  /**
   * Find emails by customer with access control
   * Uses email_participants table
   * Supports filtering by sentiment, escalation, upsell, and churn signals
   */
  async findByCustomerScoped(
    header: RequestHeader,
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
    const limit = options?.limit || 50;
    const offset = options?.offset || 0;

    const hasAccess = await this.hasCustomerAccess(header, customerId);
    if (!hasAccess) {
      return [];
    }

    // Build base conditions
    const conditions: SQL[] = [
      eq(emails.tenantId, header.tenantId),
      // ATTRIBUTED BY PARTICIPANT LINK **OR** SENDER DOMAIN, matching
      // findByCustomer and matching the add-on panel.
      //
      // The panel attributes a fire by who WROTE the mail, via the sender's
      // domain. This filtered on the participant link alone, so a row claiming
      // "Berolzheimer, 3 unanswered" led to a page saying "No analyzed emails
      // found" — the panel reading as though it had made the client up.
      //
      // The participant link is not merely absent, it is usually pointing
      // somewhere else: of five negative Berolzheimer emails, ONE carries a
      // participant row for Berolzheimer and the rest name Mystartupcfo (us) or
      // an unrelated auto-created record.
      //
      // Both paths are kept rather than swapping to domain alone: participant
      // links are often wrong but not always absent, and narrowing to one would
      // silently drop mail this page shows today.
      or(
        eq(emailParticipants.customerId, customerId),
        sql`EXISTS (
          SELECT 1 FROM customer_domains cd
          WHERE cd.customer_id = ${customerId}
            AND cd.tenant_id = ${emails.tenantId}
            AND lower(cd.domain) = split_part(lower(${emails.fromEmail}), '@', 2)
        )`
      )!,
    ];

    // Add text search filter (ILIKE on subject, from name/email)
    if (options?.query) {
      const search = `%${options.query}%`;
      conditions.push(or(
        ilike(emails.subject, search),
        ilike(emails.fromEmail, search),
        ilike(emails.fromName, search),
      )!);
    }

    // Add date range filter
    if (options?.dateFrom) {
      conditions.push(sql`${emails.receivedAt} >= ${options.dateFrom}::timestamp`);
    }
    if (options?.dateTo) {
      conditions.push(sql`${emails.receivedAt} <= ${options.dateTo}::timestamp`);
    }

    // Add TAT violation filter as subquery (uses same CTE logic as TAT metrics)
    if (options?.tatViolation) {
      conditions.push(sql`${emails.id} IN (${this.getTATViolationSubquery(header, customerId, options.dateFrom, options.dateTo)})`);
    }

    // Add sentiment filter using signals array
    if (options?.sentiment) {
      const signalValue = options.sentiment === 'positive' ? Signal.SENTIMENT_POSITIVE
        : options.sentiment === 'negative' ? Signal.SENTIMENT_NEGATIVE
        : Signal.SENTIMENT_NEUTRAL;
      conditions.push(signalContains(signalValue));
    }

    // Add escalation filter using signals array (backed by negative sentiment)
    if (options?.escalation) {
      conditions.push(signalContains(Signal.SENTIMENT_NEGATIVE));
    }

    // Add signal filter (upsell, churn)
    if (options?.signal === 'upsell') {
      conditions.push(signalContains(Signal.UPSELL));
    } else if (options?.signal === 'churn') {
      // Any churn level
      conditions.push(signalOverlaps([Signal.CHURN_LOW, Signal.CHURN_MEDIUM, Signal.CHURN_HIGH, Signal.CHURN_CRITICAL]));
    }

    // Build query
    const query = this.db
      .selectDistinct({ emails })
      .from(emails)
      .innerJoin(emailParticipants, eq(emails.id, emailParticipants.emailId));

    const rows = await query
      .where(and(...conditions))
      .orderBy(desc(emails.receivedAt))
      .limit(limit)
      .offset(offset);

    logger.info({
      customerId,
      tenantId: header.tenantId,
      limit,
      offset,
      rowCount: rows.length,
      firstRowKeys: rows[0] ? Object.keys(rows[0]) : [],
    }, 'findByCustomerScoped query result');

    return rows.map(r => r.emails);
  }

  /**
   * Count emails by customer with access control
   * Uses email_participants table
   * Supports filtering by sentiment, escalation, upsell, churn signals, and date range
   */
  async countByCustomerScoped(
    header: RequestHeader,
    customerId: string,
    filters?: {
      sentiment?: 'positive' | 'negative' | 'neutral';
      escalation?: boolean;
      signal?: 'upsell' | 'churn';
      tatViolation?: boolean;
      dateFrom?: string;
      dateTo?: string;
      query?: string;
    }
  ): Promise<number> {
    const hasAccess = await this.hasCustomerAccess(header, customerId);
    if (!hasAccess) {
      return 0;
    }

    // Build base conditions
    const conditions: SQL[] = [
      eq(emails.tenantId, header.tenantId),
      // ATTRIBUTED BY PARTICIPANT LINK **OR** SENDER DOMAIN, matching
      // findByCustomer and matching the add-on panel.
      //
      // The panel attributes a fire by who WROTE the mail, via the sender's
      // domain. This filtered on the participant link alone, so a row claiming
      // "Berolzheimer, 3 unanswered" led to a page saying "No analyzed emails
      // found" — the panel reading as though it had made the client up.
      //
      // The participant link is not merely absent, it is usually pointing
      // somewhere else: of five negative Berolzheimer emails, ONE carries a
      // participant row for Berolzheimer and the rest name Mystartupcfo (us) or
      // an unrelated auto-created record.
      //
      // Both paths are kept rather than swapping to domain alone: participant
      // links are often wrong but not always absent, and narrowing to one would
      // silently drop mail this page shows today.
      or(
        eq(emailParticipants.customerId, customerId),
        sql`EXISTS (
          SELECT 1 FROM customer_domains cd
          WHERE cd.customer_id = ${customerId}
            AND cd.tenant_id = ${emails.tenantId}
            AND lower(cd.domain) = split_part(lower(${emails.fromEmail}), '@', 2)
        )`
      )!,
    ];

    // Add text search filter (ILIKE on subject, from name/email)
    if (filters?.query) {
      const search = `%${filters.query}%`;
      conditions.push(or(
        ilike(emails.subject, search),
        ilike(emails.fromEmail, search),
        ilike(emails.fromName, search),
      )!);
    }

    // Add date range filter
    if (filters?.dateFrom) {
      conditions.push(sql`${emails.receivedAt} >= ${filters.dateFrom}::timestamp`);
    }
    if (filters?.dateTo) {
      conditions.push(sql`${emails.receivedAt} <= ${filters.dateTo}::timestamp`);
    }

    // Add TAT violation filter as subquery (uses same CTE logic as TAT metrics)
    if (filters?.tatViolation) {
      conditions.push(sql`${emails.id} IN (${this.getTATViolationSubquery(header, customerId, filters.dateFrom, filters.dateTo)})`);
    }

    // Add sentiment filter using signals array
    if (filters?.sentiment) {
      const signalValue = filters.sentiment === 'positive' ? Signal.SENTIMENT_POSITIVE
        : filters.sentiment === 'negative' ? Signal.SENTIMENT_NEGATIVE
        : Signal.SENTIMENT_NEUTRAL;
      conditions.push(signalContains(signalValue));
    }

    // Add escalation filter using signals array (backed by negative sentiment)
    if (filters?.escalation) {
      conditions.push(signalContains(Signal.SENTIMENT_NEGATIVE));
    }

    // Add signal filter (upsell, churn)
    if (filters?.signal === 'upsell') {
      conditions.push(signalContains(Signal.UPSELL));
    } else if (filters?.signal === 'churn') {
      // Any churn level
      conditions.push(signalOverlaps([Signal.CHURN_LOW, Signal.CHURN_MEDIUM, Signal.CHURN_HIGH, Signal.CHURN_CRITICAL]));
    }

    // Build query
    const query = this.db
      .select({ count: sql<number>`count(DISTINCT ${emails.id})::int` })
      .from(emails)
      .innerJoin(emailParticipants, eq(emails.id, emailParticipants.emailId));

    const result = await query.where(and(...conditions));

    return result[0]?.count || 0;
  }

  /**
   * Resolve emails by their provider message IDs, returning the linked customer
   * and sentiment signals. Used by the Gmail extension to map an open thread to
   * a customer authoritatively (by the stored email→customer link) instead of by
   * guessing from the sender's domain. Access-scoped to the requesting user.
   *
   * Also returns each message's envelope (from / to / cc / subject / date). The
   * Gmail sidebar's "Selected" block needs those for the open message, and Gmail
   * itself cannot supply them: InboxSDK's MessageView exposes only a single flat
   * `getRecipients()` list with no to/cc distinction. The stored row does keep
   * them apart, and this call already fetches the thread's messages, so the block
   * costs no extra round trip.
   */
  async findByMessageIdsScoped(
    header: RequestHeader,
    provider: string,
    messageIds: string[],
    rfcMessageIds: string[] = []
  ): Promise<
    Array<{
      id: string;
      messageId: string;
      threadId: string;
      subject: string | null;
      receivedAt: Date | null;
      signals: number[] | null;
      customerId: string;
      fromEmail: string | null;
      fromName: string | null;
      tos: Array<{ email: string; name?: string }> | null;
      ccs: Array<{ email: string; name?: string }> | null;
    }>
  > {
    // Match on the provider message-id OR the stable RFC 2822 Message-ID. Provider
    // ids are per-mailbox (the same email has a different Gmail id in each
    // participant's mailbox), so an add-on user viewing a thread that was ingested
    // from a teammate's mailbox can only match via the cross-mailbox-stable RFC id
    // — which the add-on reads off the open message and passes in here.
    const idClauses: SQL[] = [];
    if (messageIds.length) idClauses.push(inArray(emails.messageId, messageIds));
    if (rfcMessageIds.length) idClauses.push(inArray(emails.rfcMessageId, rfcMessageIds));
    if (idClauses.length === 0) return [];
    const idMatch = idClauses.length === 1 ? idClauses[0] : or(...idClauses);

    const rows = await this.db
      .selectDistinct({
        id: emails.id,
        messageId: emails.messageId,
        threadId: emails.threadId,
        subject: emails.subject,
        receivedAt: emails.receivedAt,
        signals: emails.signals,
        customerId: emailParticipants.customerId,
        fromEmail: emails.fromEmail,
        fromName: emails.fromName,
        tos: emails.tos,
        ccs: emails.ccs,
      })
      .from(emails)
      .innerJoin(emailParticipants, eq(emails.id, emailParticipants.emailId))
      .where(
        and(
          eq(emails.tenantId, header.tenantId),
          eq(emails.provider, provider),
          idMatch,
          // Resolve the customer from the external SENDER only. Recipients (to/cc)
          // are full of internal teammates linked to the tenant's own org, and
          // internal 'user' participants carry that org's customerId — both would
          // mis-resolve the thread to the tenant itself. The 'from' contact is the
          // external party the thread is actually about.
          eq(emailParticipants.direction, 'from'),
          eq(emailParticipants.participantType, 'contact'),
          sql`${emailParticipants.customerId} IS NOT NULL`,
          this.customerAccessFilter(emailParticipants.customerId, header)
        )
      );

    // customerId is guaranteed non-null by the WHERE clause above.
    return rows as Array<{
      id: string;
      messageId: string;
      threadId: string;
      subject: string | null;
      receivedAt: Date | null;
      signals: number[] | null;
      customerId: string;
      fromEmail: string | null;
      fromName: string | null;
      tos: Array<{ email: string; name?: string }> | null;
      ccs: Array<{ email: string; name?: string }> | null;
    }>;
  }

  /**
   * Find email by ID with access control
   */
  async findByIdScoped(header: RequestHeader, emailId: string) {
    const result = await this.db
      .selectDistinct({ emails })
      .from(emails)
      .innerJoin(emailParticipants, eq(emails.id, emailParticipants.emailId))
      .innerJoin(
        sql`user_accessible_customers uac`,
        sql`${emailParticipants.customerId} = uac.customer_id AND uac.user_id = ${header.userId}`
      )
      .where(
        and(
          eq(emails.id, emailId),
          eq(emails.tenantId, header.tenantId)
        )
      )
      .limit(1);

    return result[0]?.emails || null;
  }

  // ===========================================================================
  // Email Participants Management
  // ===========================================================================

  /**
   * Create email participants for an email
   * Called after inserting a new email to create the participant links
   * @param participants - Array of participants to create
   * @param tx - Optional transaction context
   */
  async createParticipants(participants: NewEmailParticipant[], tx?: Transaction): Promise<void> {
    if (participants.length === 0) {
      return;
    }

    const db = tx ?? this.db;
    await db
      .insert(emailParticipants)
      .values(participants)
      .onConflictDoNothing();
  }

  /**
   * Get participants for an email
   */
  async getParticipants(emailId: string) {
    return this.db
      .select()
      .from(emailParticipants)
      .where(eq(emailParticipants.emailId, emailId));
  }

  /**
   * Get email counts by customer IDs using email_participants (with access control)
   */
  async getCountsByCustomerIdsScoped(
    header: RequestHeader,
    customerIds: string[],
    filters?: { dateFrom?: string; dateTo?: string }
  ): Promise<Record<string, number>> {
    if (customerIds.length === 0) {
      return {};
    }

    // Admin bypass - use all customer IDs
    const accessible = isAdmin(header.permissions)
      ? customerIds
      : await this.getAccessibleCustomerIds(header, customerIds);

    if (accessible.length === 0) {
      return {};
    }

    // Build conditions
    const conditions: SQL[] = [
      eq(emails.tenantId, header.tenantId),
      inArray(emailParticipants.customerId, accessible),
    ];
    if (filters?.dateFrom) {
      conditions.push(sql`${emails.receivedAt} >= ${filters.dateFrom}::timestamp`);
    }
    if (filters?.dateTo) {
      conditions.push(sql`${emails.receivedAt} <= ${filters.dateTo}::timestamp`);
    }

    // Count emails per customer
    const result = await this.db
      .select({
        customerId: emailParticipants.customerId,
        count: sql<number>`count(DISTINCT ${emails.id})::int`,
      })
      .from(emailParticipants)
      .innerJoin(emails, eq(emails.id, emailParticipants.emailId))
      .where(and(...conditions))
      .groupBy(emailParticipants.customerId);

    // Build result map
    const counts: Record<string, number> = {};
    for (const customerId of customerIds) {
      counts[customerId] = 0;
    }
    for (const row of result) {
      if (row.customerId) {
        counts[row.customerId] = row.count;
      }
    }

    return counts;
  }

  /**
   * Get last contact dates by customer IDs (with access control)
   */
  async getLastContactDatesByCustomerIdsScoped(
    header: RequestHeader,
    customerIds: string[],
    filters?: { dateFrom?: string; dateTo?: string }
  ): Promise<Record<string, Date>> {
    if (customerIds.length === 0) {
      return {};
    }

    // Admin bypass - use all customer IDs
    const accessible = isAdmin(header.permissions)
      ? customerIds
      : await this.getAccessibleCustomerIds(header, customerIds);

    if (accessible.length === 0) {
      return {};
    }

    // Build conditions
    const conditions: SQL[] = [
      eq(emails.tenantId, header.tenantId),
      inArray(emailParticipants.customerId, accessible),
    ];
    if (filters?.dateFrom) {
      conditions.push(sql`${emails.receivedAt} >= ${filters.dateFrom}::timestamp`);
    }
    if (filters?.dateTo) {
      conditions.push(sql`${emails.receivedAt} <= ${filters.dateTo}::timestamp`);
    }

    // Get the most recent email date per customer using email_participants
    const result = await this.db
      .select({
        customerId: emailParticipants.customerId,
        lastContactAt: sql<Date>`max(${emails.receivedAt})`,
      })
      .from(emailParticipants)
      .innerJoin(emails, eq(emails.id, emailParticipants.emailId))
      .where(and(...conditions))
      .groupBy(emailParticipants.customerId);

    const lastContacts: Record<string, Date> = {};
    for (const row of result) {
      if (row.customerId && row.lastContactAt) {
        lastContacts[row.customerId] = row.lastContactAt;
      }
    }

    return lastContacts;
  }

  /**
   * Get aggregate sentiment by customer IDs (with access control)
   * Reads sentiment from signals array using Signal constants
   */
  async getAggregateSentimentByCustomerIdsScoped(
    header: RequestHeader,
    customerIds: string[],
    filters?: { dateFrom?: string; dateTo?: string }
  ): Promise<Record<string, { value: 'positive' | 'negative' | 'neutral'; confidence: number }>> {
    if (customerIds.length === 0) {
      return {};
    }

    // Admin bypass - use all customer IDs
    const accessible = isAdmin(header.permissions)
      ? customerIds
      : await this.getAccessibleCustomerIds(header, customerIds);

    if (accessible.length === 0) {
      return {};
    }

    // Build conditions
    const conditions: SQL[] = [
      eq(emails.tenantId, header.tenantId),
      inArray(emailParticipants.customerId, accessible),
      // Has any sentiment signal
      signalOverlaps([Signal.SENTIMENT_POSITIVE, Signal.SENTIMENT_NEGATIVE, Signal.SENTIMENT_NEUTRAL]),
    ];
    if (filters?.dateFrom) {
      conditions.push(sql`${emails.receivedAt} >= ${filters.dateFrom}::timestamp`);
    }
    if (filters?.dateTo) {
      conditions.push(sql`${emails.receivedAt} <= ${filters.dateTo}::timestamp`);
    }

    // Query emails with sentiment signals via email_participants
    const emailsResult = await this.db
      .select({
        customerId: emailParticipants.customerId,
        signals: emails.signals,
      })
      .from(emailParticipants)
      .innerJoin(emails, eq(emails.id, emailParticipants.emailId))
      .where(and(...conditions))
      .orderBy(desc(emails.receivedAt))
      .limit(1000);

    // Aggregate sentiment per customer
    const customerSentiments: Record<string, {
      positive: number;
      negative: number;
      neutral: number;
      count: number;
    }> = {};

    // Initialize all customers
    for (const customerId of customerIds) {
      customerSentiments[customerId] = {
        positive: 0,
        negative: 0,
        neutral: 0,
        count: 0,
      };
    }

    // Process emails
    for (const row of emailsResult) {
      if (!row.customerId) continue;
      const sentiment = getSentimentFromSignals(row.signals);

      if (!sentiment) continue;

      customerSentiments[row.customerId][sentiment]++;
      customerSentiments[row.customerId].count++;
    }

    // Calculate dominant sentiment for each customer
    const result: Record<string, { value: 'positive' | 'negative' | 'neutral'; confidence: number }> = {};

    for (const [customerId, counts] of Object.entries(customerSentiments)) {
      if (counts.count === 0) continue;

      let dominant: 'positive' | 'negative' | 'neutral' = 'neutral';
      let maxCount = counts.neutral;

      if (counts.positive > maxCount) {
        dominant = 'positive';
        maxCount = counts.positive;
      }
      if (counts.negative > maxCount) {
        dominant = 'negative';
        maxCount = counts.negative;
      }

      // Confidence is the proportion of the dominant sentiment
      const confidence = maxCount / counts.count;

      result[customerId] = {
        value: dominant,
        confidence: Math.round(confidence * 100) / 100,
      };
    }

    return result;
  }

  /**
   * Get escalation counts by customer IDs (with access control)
   * Counts emails with negative sentiment signal (used as escalation indicator)
   */
  async getEscalationCountsByCustomerIdsScoped(
    header: RequestHeader,
    customerIds: string[],
    filters?: { dateFrom?: string; dateTo?: string }
  ): Promise<Record<string, number>> {
    if (customerIds.length === 0) {
      return {};
    }

    // Admin bypass - use all customer IDs
    const accessible = isAdmin(header.permissions)
      ? customerIds
      : await this.getAccessibleCustomerIds(header, customerIds);

    if (accessible.length === 0) {
      return {};
    }

    // Build conditions
    const conditions: SQL[] = [
      eq(emails.tenantId, header.tenantId),
      inArray(emailParticipants.customerId, accessible),
      signalContains(Signal.SENTIMENT_NEGATIVE),
    ];
    if (filters?.dateFrom) {
      conditions.push(sql`${emails.receivedAt} >= ${filters.dateFrom}::timestamp`);
    }
    if (filters?.dateTo) {
      conditions.push(sql`${emails.receivedAt} <= ${filters.dateTo}::timestamp`);
    }

    // Count negative sentiment emails per customer (used as escalation indicator)
    const result = await this.db
      .select({
        customerId: emailParticipants.customerId,
        count: sql<number>`count(DISTINCT ${emails.id})::int`,
      })
      .from(emailParticipants)
      .innerJoin(emails, eq(emails.id, emailParticipants.emailId))
      .where(and(...conditions))
      .groupBy(emailParticipants.customerId);

    // Build result map with zeros for customers with no negative sentiment emails
    const counts: Record<string, number> = {};
    for (const customerId of customerIds) {
      counts[customerId] = 0;
    }
    for (const row of result) {
      if (row.customerId) {
        counts[row.customerId] = row.count;
      }
    }

    return counts;
  }

  /**
   * Get upsell counts by customer IDs (with access control)
   * Counts emails with UPSELL signal
   */
  async getUpsellCountsByCustomerIdsScoped(
    header: RequestHeader,
    customerIds: string[],
    filters?: { dateFrom?: string; dateTo?: string }
  ): Promise<Record<string, number>> {
    if (customerIds.length === 0) {
      return {};
    }

    const accessible = isAdmin(header.permissions)
      ? customerIds
      : await this.getAccessibleCustomerIds(header, customerIds);

    if (accessible.length === 0) {
      return {};
    }

    // Build conditions
    const conditions: SQL[] = [
      eq(emails.tenantId, header.tenantId),
      inArray(emailParticipants.customerId, accessible),
      signalContains(Signal.UPSELL),
    ];
    if (filters?.dateFrom) {
      conditions.push(sql`${emails.receivedAt} >= ${filters.dateFrom}::timestamp`);
    }
    if (filters?.dateTo) {
      conditions.push(sql`${emails.receivedAt} <= ${filters.dateTo}::timestamp`);
    }

    const result = await this.db
      .select({
        customerId: emailParticipants.customerId,
        count: sql<number>`count(DISTINCT ${emails.id})::int`,
      })
      .from(emailParticipants)
      .innerJoin(emails, eq(emails.id, emailParticipants.emailId))
      .where(and(...conditions))
      .groupBy(emailParticipants.customerId);

    const counts: Record<string, number> = {};
    for (const customerId of customerIds) {
      counts[customerId] = 0;
    }
    for (const row of result) {
      if (row.customerId) {
        counts[row.customerId] = row.count;
      }
    }

    return counts;
  }

  /**
   * Get churn signal counts by customer IDs (with access control)
   * Counts emails with any churn signal (LOW, MEDIUM, HIGH, CRITICAL)
   */
  async getChurnCountsByCustomerIdsScoped(
    header: RequestHeader,
    customerIds: string[],
    filters?: { dateFrom?: string; dateTo?: string }
  ): Promise<Record<string, number>> {
    if (customerIds.length === 0) {
      return {};
    }

    const accessible = isAdmin(header.permissions)
      ? customerIds
      : await this.getAccessibleCustomerIds(header, customerIds);

    if (accessible.length === 0) {
      return {};
    }

    const churnSignals = [Signal.CHURN_LOW, Signal.CHURN_MEDIUM, Signal.CHURN_HIGH, Signal.CHURN_CRITICAL];

    // Build conditions
    const conditions: SQL[] = [
      eq(emails.tenantId, header.tenantId),
      inArray(emailParticipants.customerId, accessible),
      signalOverlaps(churnSignals),
    ];
    if (filters?.dateFrom) {
      conditions.push(sql`${emails.receivedAt} >= ${filters.dateFrom}::timestamp`);
    }
    if (filters?.dateTo) {
      conditions.push(sql`${emails.receivedAt} <= ${filters.dateTo}::timestamp`);
    }

    const result = await this.db
      .select({
        customerId: emailParticipants.customerId,
        count: sql<number>`count(DISTINCT ${emails.id})::int`,
      })
      .from(emailParticipants)
      .innerJoin(emails, eq(emails.id, emailParticipants.emailId))
      .where(and(...conditions))
      .groupBy(emailParticipants.customerId);

    const counts: Record<string, number> = {};
    for (const customerId of customerIds) {
      counts[customerId] = 0;
    }
    for (const row of result) {
      if (row.customerId) {
        counts[row.customerId] = row.count;
      }
    }

    return counts;
  }

  /**
   * Get positive sentiment counts by customer IDs (with access control)
   * Counts emails with SENTIMENT_POSITIVE signal
   */
  async getPositiveCountsByCustomerIdsScoped(
    header: RequestHeader,
    customerIds: string[],
    filters?: { dateFrom?: string; dateTo?: string }
  ): Promise<Record<string, number>> {
    if (customerIds.length === 0) {
      return {};
    }

    const accessible = isAdmin(header.permissions)
      ? customerIds
      : await this.getAccessibleCustomerIds(header, customerIds);

    if (accessible.length === 0) {
      return {};
    }

    // Build conditions
    const conditions: SQL[] = [
      eq(emails.tenantId, header.tenantId),
      inArray(emailParticipants.customerId, accessible),
      signalContains(Signal.SENTIMENT_POSITIVE),
    ];
    if (filters?.dateFrom) {
      conditions.push(sql`${emails.receivedAt} >= ${filters.dateFrom}::timestamp`);
    }
    if (filters?.dateTo) {
      conditions.push(sql`${emails.receivedAt} <= ${filters.dateTo}::timestamp`);
    }

    const result = await this.db
      .select({
        customerId: emailParticipants.customerId,
        count: sql<number>`count(DISTINCT ${emails.id})::int`,
      })
      .from(emailParticipants)
      .innerJoin(emails, eq(emails.id, emailParticipants.emailId))
      .where(and(...conditions))
      .groupBy(emailParticipants.customerId);

    const counts: Record<string, number> = {};
    for (const customerId of customerIds) {
      counts[customerId] = 0;
    }
    for (const row of result) {
      if (row.customerId) {
        counts[row.customerId] = row.count;
      }
    }

    return counts;
  }

  /**
   * Get average TAT (Turn Around Time) by customer IDs (with access control)
   * TAT is calculated as the average hours between received_at and first_reply_at
   * for customer emails that have been replied to
   */
  async getAverageTatByCustomerIdsScoped(
    header: RequestHeader,
    customerIds: string[],
    filters?: { dateFrom?: string; dateTo?: string }
  ): Promise<Record<string, number | null>> {
    if (customerIds.length === 0) {
      return {};
    }

    const accessible = isAdmin(header.permissions)
      ? customerIds
      : await this.getAccessibleCustomerIds(header, customerIds);

    if (accessible.length === 0) {
      return {};
    }

    // Build conditions
    const conditions: SQL[] = [
      eq(emails.tenantId, header.tenantId),
      inArray(emailParticipants.customerId, accessible),
      eq(emails.isCustomerEmail, true),
      sql`${emails.firstReplyAt} IS NOT NULL`,
    ];
    if (filters?.dateFrom) {
      conditions.push(sql`${emails.receivedAt} >= ${filters.dateFrom}::timestamp`);
    }
    if (filters?.dateTo) {
      conditions.push(sql`${emails.receivedAt} <= ${filters.dateTo}::timestamp`);
    }

    // Calculate average TAT in hours for customer emails with a reply
    const result = await this.db
      .select({
        customerId: emailParticipants.customerId,
        avgTatHours: sql<number>`AVG(EXTRACT(EPOCH FROM (${emails.firstReplyAt} - ${emails.receivedAt})) / 3600)::numeric(10,1)`,
      })
      .from(emailParticipants)
      .innerJoin(emails, eq(emails.id, emailParticipants.emailId))
      .where(and(...conditions))
      .groupBy(emailParticipants.customerId);

    const avgTats: Record<string, number | null> = {};
    for (const customerId of customerIds) {
      avgTats[customerId] = null;
    }
    for (const row of result) {
      if (row.customerId) {
        avgTats[row.customerId] = row.avgTatHours;
      }
    }

    return avgTats;
  }

  /**
   * Helper: Get accessible customer IDs from provided list
   */
  private async getAccessibleCustomerIds(
    header: RequestHeader,
    customerIds: string[]
  ): Promise<string[]> {
    const accessibleCustomerIds = await this.db
      .select({ customerId: sql<string>`uac.customer_id` })
      .from(sql`user_accessible_customers uac`)
      .where(
        and(
          sql`uac.user_id = ${header.userId}`,
          inArray(sql`uac.customer_id`, customerIds)
        )
      );

    return accessibleCustomerIds.map(r => r.customerId);
  }

  // ===========================================================================
  // Dashboard Statistics
  // ===========================================================================

  /**
   * Get dashboard email statistics with access control
   * Returns total email count and analyzed email count
   */
  async getDashboardStatsScoped(
    header: RequestHeader,
    filters?: {
      customerId?: string;
      dateFrom?: string;
      dateTo?: string;
    }
  ): Promise<{ total: number; analyzed: number }> {
    const conditions: SQL[] = [
      eq(emails.tenantId, header.tenantId),
      isNotNull(emailParticipants.customerId),
      this.customerAccessFilter(emailParticipants.customerId, header),
    ];

    if (filters?.customerId) {
      conditions.push(eq(emailParticipants.customerId, filters.customerId));
    }
    if (filters?.dateFrom) {
      conditions.push(sql`${emails.receivedAt} >= ${filters.dateFrom}::timestamp`);
    }
    if (filters?.dateTo) {
      conditions.push(sql`${emails.receivedAt} <= ${filters.dateTo}::timestamp`);
    }

    // Count per customer, then sum to match customer table's per-row counts
    const perCustomer = this.db
      .select({
        customerId: emailParticipants.customerId,
        total: sql<number>`count(DISTINCT ${emails.id})::int`.as('total'),
        analyzed: sql<number>`count(DISTINCT ${emails.id}) FILTER (WHERE ${emails.id} IN (
          SELECT DISTINCT ea.email_id FROM email_analyses ea
        ))::int`.as('analyzed'),
      })
      .from(emailParticipants)
      .innerJoin(emails, eq(emails.id, emailParticipants.emailId))
      .where(and(...conditions))
      .groupBy(emailParticipants.customerId)
      .as('per_customer');

    const result = await this.db
      .select({
        total: sql<number>`coalesce(sum(${perCustomer.total}), 0)::int`,
        analyzed: sql<number>`coalesce(sum(${perCustomer.analyzed}), 0)::int`,
      })
      .from(perCustomer);

    return {
      total: result[0]?.total ?? 0,
      analyzed: result[0]?.analyzed ?? 0,
    };
  }

  /**
   * Per-customer signal counts over a date range, for the Gmail sidebar's Stats
   * block.
   *
   * The `customers` table carries precomputed rollups (emailCount,
   * escalationCount, …) which is what the sidebar showed before, but those are
   * all-time by construction — there is no date dimension to filter. Recomputing
   * from `emails` is what makes "last 30 days" answerable at all. The counts are
   * built from `emails.signals`, which has a GIN index, so the containment and
   * overlap tests below are index-served rather than a scan per chip.
   *
   * Deliberately NOT returning averageTat: `customers.averageTat` is an all-time
   * rollup and the TAT machinery buckets business-day lag rather than producing
   * a mean, so there is no honest range-scoped equivalent to hand back. The
   * caller shows that chip only for the all-time view.
   */
  async getCustomerSignalStatsScoped(
    header: RequestHeader,
    customerId: string,
    filters?: { dateFrom?: string; dateTo?: string }
  ): Promise<{
    emailCount: number;
    escalationCount: number;
    upsellCount: number;
    churnCount: number;
    positiveCount: number;
    lastContactDate: string | null;
  }> {
    const conditions: SQL[] = [
      eq(emails.tenantId, header.tenantId),
      eq(emailParticipants.customerId, customerId),
      this.customerAccessFilter(emailParticipants.customerId, header),
    ];

    if (filters?.dateFrom) {
      conditions.push(sql`${emails.receivedAt} >= ${filters.dateFrom}::timestamptz`);
    }
    if (filters?.dateTo) {
      conditions.push(sql`${emails.receivedAt} <= ${filters.dateTo}::timestamptz`);
    }

    // DISTINCT throughout: the email_participants join multiplies a row by its
    // participant count, so a plain count would report a message once per
    // recipient.
    const [row] = await this.db
      .select({
        emailCount: sql<number>`count(DISTINCT ${emails.id})::int`,
        escalationCount: sql<number>`count(DISTINCT ${emails.id}) FILTER (WHERE ${signalContains(Signal.ESCALATION)})::int`,
        upsellCount: sql<number>`count(DISTINCT ${emails.id}) FILTER (WHERE ${signalContains(Signal.UPSELL)})::int`,
        churnCount: sql<number>`count(DISTINCT ${emails.id}) FILTER (WHERE ${signalOverlaps([
          Signal.CHURN_LOW,
          Signal.CHURN_MEDIUM,
          Signal.CHURN_HIGH,
          Signal.CHURN_CRITICAL,
        ])})::int`,
        positiveCount: sql<number>`count(DISTINCT ${emails.id}) FILTER (WHERE ${signalContains(Signal.SENTIMENT_POSITIVE)})::int`,
        lastContactDate: sql<string | null>`max(${emails.receivedAt})`,
      })
      .from(emails)
      .innerJoin(emailParticipants, eq(emails.id, emailParticipants.emailId))
      .where(and(...conditions));

    return {
      emailCount: row?.emailCount ?? 0,
      escalationCount: row?.escalationCount ?? 0,
      upsellCount: row?.upsellCount ?? 0,
      churnCount: row?.churnCount ?? 0,
      positiveCount: row?.positiveCount ?? 0,
      lastContactDate: row?.lastContactDate ?? null,
    };
  }

  /**
   * Get sentiment distribution for dashboard chart with access control
   * Returns counts for positive, neutral, and negative sentiment
   * Uses emails.signals array instead of email_analyses table
   */
  async getSentimentStatsScoped(
    header: RequestHeader,
    filters?: {
      customerId?: string;
      dateFrom?: string;
      dateTo?: string;
    }
  ): Promise<{ positive: number; neutral: number; negative: number }> {
    const conditions: SQL[] = [
      eq(emails.tenantId, header.tenantId),
      isNotNull(emailParticipants.customerId),
      this.customerAccessFilter(emailParticipants.customerId, header),
      // Only include emails that have at least one sentiment signal
      signalOverlaps([Signal.SENTIMENT_POSITIVE, Signal.SENTIMENT_NEGATIVE, Signal.SENTIMENT_NEUTRAL]),
    ];

    if (filters?.customerId) {
      conditions.push(eq(emailParticipants.customerId, filters.customerId));
    }
    if (filters?.dateFrom) {
      conditions.push(sql`${emails.receivedAt} >= ${filters.dateFrom}::timestamp`);
    }
    if (filters?.dateTo) {
      conditions.push(sql`${emails.receivedAt} <= ${filters.dateTo}::timestamp`);
    }

    // Count per customer, then sum to match customer table's per-row counts
    const perCustomer = this.db
      .select({
        customerId: emailParticipants.customerId,
        positive: sql<number>`count(DISTINCT ${emails.id}) FILTER (WHERE ${signalContains(Signal.SENTIMENT_POSITIVE)})::int`.as('positive'),
        neutral: sql<number>`count(DISTINCT ${emails.id}) FILTER (WHERE ${signalContains(Signal.SENTIMENT_NEUTRAL)})::int`.as('neutral'),
        negative: sql<number>`count(DISTINCT ${emails.id}) FILTER (WHERE ${signalContains(Signal.SENTIMENT_NEGATIVE)})::int`.as('negative'),
      })
      .from(emailParticipants)
      .innerJoin(emails, eq(emails.id, emailParticipants.emailId))
      .where(and(...conditions))
      .groupBy(emailParticipants.customerId)
      .as('per_customer');

    const result = await this.db
      .select({
        positive: sql<number>`coalesce(sum(${perCustomer.positive}), 0)::int`,
        neutral: sql<number>`coalesce(sum(${perCustomer.neutral}), 0)::int`,
        negative: sql<number>`coalesce(sum(${perCustomer.negative}), 0)::int`,
      })
      .from(perCustomer);

    return {
      positive: result[0]?.positive ?? 0,
      neutral: result[0]?.neutral ?? 0,
      negative: result[0]?.negative ?? 0,
    };
  }

  /**
   * Get sentiment trend data for dashboard chart with access control
   * Returns monthly counts for positive, neutral, and negative sentiment over last 6 months
   * Returns percentages (stacked to 100%)
   * Uses emails.signals array instead of email_analyses table
   */
  async getSentimentTrendScoped(
    header: RequestHeader,
    filters?: {
      customerId?: string;
    }
  ): Promise<Array<{ month: string; positive: number; neutral: number; negative: number }>> {
    // Get last 6 months
    const months: string[] = [];
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
      const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push(date.toISOString().slice(0, 7)); // YYYY-MM format
    }

    const conditions: SQL[] = [
      eq(emails.tenantId, header.tenantId),
      isNotNull(emailParticipants.customerId),
      this.customerAccessFilter(emailParticipants.customerId, header),
      // Only include emails that have at least one sentiment signal
      signalOverlaps([Signal.SENTIMENT_POSITIVE, Signal.SENTIMENT_NEGATIVE, Signal.SENTIMENT_NEUTRAL]),
      // Filter to last 6 months using emails.receivedAt
      sql`${emails.receivedAt} >= date_trunc('month', now() - interval '5 months')`,
    ];

    if (filters?.customerId) {
      conditions.push(eq(emailParticipants.customerId, filters.customerId));
    }

    // Count per customer per month, then sum per month
    const perCustomerMonth = this.db
      .select({
        customerId: emailParticipants.customerId,
        month: sql<string>`to_char(${emails.receivedAt}, 'YYYY-MM')`.as('month'),
        positive: sql<number>`count(DISTINCT ${emails.id}) FILTER (WHERE ${signalContains(Signal.SENTIMENT_POSITIVE)})::int`.as('positive'),
        neutral: sql<number>`count(DISTINCT ${emails.id}) FILTER (WHERE ${signalContains(Signal.SENTIMENT_NEUTRAL)})::int`.as('neutral'),
        negative: sql<number>`count(DISTINCT ${emails.id}) FILTER (WHERE ${signalContains(Signal.SENTIMENT_NEGATIVE)})::int`.as('negative'),
      })
      .from(emailParticipants)
      .innerJoin(emails, eq(emails.id, emailParticipants.emailId))
      .where(and(...conditions))
      .groupBy(emailParticipants.customerId, sql`to_char(${emails.receivedAt}, 'YYYY-MM')`)
      .as('per_customer_month');

    const result = await this.db
      .select({
        month: perCustomerMonth.month,
        positive: sql<number>`coalesce(sum(${perCustomerMonth.positive}), 0)::int`,
        neutral: sql<number>`coalesce(sum(${perCustomerMonth.neutral}), 0)::int`,
        negative: sql<number>`coalesce(sum(${perCustomerMonth.negative}), 0)::int`,
      })
      .from(perCustomerMonth)
      .groupBy(perCustomerMonth.month)
      .orderBy(perCustomerMonth.month);

    // Convert to percentages and ensure all months are represented
    const resultMap = new Map(result.map(r => [r.month, r]));

    return months.map(month => {
      const data = resultMap.get(month);
      if (!data) {
        return { month, positive: 0, neutral: 0, negative: 0 };
      }

      const total = data.positive + data.neutral + data.negative;
      if (total === 0) {
        return { month, positive: 0, neutral: 0, negative: 0 };
      }

      return {
        month,
        positive: Math.round((data.positive / total) * 100),
        neutral: Math.round((data.neutral / total) * 100),
        negative: Math.round((data.negative / total) * 100),
      };
    });
  }

  /**
   * Get email volume trend data for dashboard (last 4 weeks)
   * Returns weekly counts for total emails and escalations
   */
  async getEmailVolumeTrendScoped(
    header: RequestHeader,
    filters?: {
      customerId?: string;
    }
  ): Promise<Array<{ week: string; totalEmails: number; escalations: number }>> {
    const conditions: SQL[] = [
      eq(emails.tenantId, header.tenantId),
      isNotNull(emailParticipants.customerId),
      this.customerAccessFilter(emailParticipants.customerId, header),
      // Filter to last 4 weeks
      sql`${emails.receivedAt} >= date_trunc('week', now() - interval '3 weeks')`,
    ];

    if (filters?.customerId) {
      conditions.push(eq(emailParticipants.customerId, filters.customerId));
    }

    // Count per customer per week, then sum per week
    const perCustomerWeek = this.db
      .select({
        customerId: emailParticipants.customerId,
        weekStart: sql<string>`to_char(date_trunc('week', ${emails.receivedAt}), 'Mon DD, YYYY')`.as('week_start'),
        totalEmails: sql<number>`count(DISTINCT ${emails.id})::int`.as('total_emails'),
        escalations: sql<number>`count(DISTINCT ${emails.id}) FILTER (WHERE ${emails.signals} @> ARRAY[2]::integer[])::int`.as('escalations'),
      })
      .from(emailParticipants)
      .innerJoin(emails, eq(emails.id, emailParticipants.emailId))
      .where(and(...conditions))
      .groupBy(
        emailParticipants.customerId,
        sql`date_trunc('week', ${emails.receivedAt})`
      )
      .as('per_customer_week');

    const result = await this.db
      .select({
        weekStart: perCustomerWeek.weekStart,
        totalEmails: sql<number>`coalesce(sum(${perCustomerWeek.totalEmails}), 0)::int`,
        escalations: sql<number>`coalesce(sum(${perCustomerWeek.escalations}), 0)::int`,
      })
      .from(perCustomerWeek)
      .groupBy(perCustomerWeek.weekStart)
      .orderBy(perCustomerWeek.weekStart);

    // Generate last 4 weeks with start dates
    const weeks: Array<{ week: string; totalEmails: number; escalations: number }> = [];
    const now = new Date();

    for (let i = 3; i >= 0; i--) {
      const weekStart = new Date(now);
      // Go back to start of current week (Monday for Postgres default), then subtract weeks
      const day = weekStart.getDay();
      const diff = weekStart.getDate() - day + (day === 0 ? -6 : 1); // Adjust for Monday start
      weekStart.setDate(diff - (i * 7));
      const dateStr = weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      const weekLabel = `Wk ${dateStr}`;

      // Find matching data (match against full date string from DB)
      const weekData = result.find(r => r.weekStart === dateStr);
      weeks.push({
        week: weekLabel,
        totalEmails: weekData?.totalEmails ?? 0,
        escalations: weekData?.escalations ?? 0,
      });
    }

    return weeks;
  }

  /**
   * Get open upsell opportunity count for dashboard with access control.
   *
   * Mirrors the AI Analysis drilldown query (`searchAnalyzedEmails` with
   * `signal=upsell&status=open`) so the tile and the drilldown list always
   * agree: distinct analyzed emails with the UPSELL signal whose sender is a
   * customer the caller can access AND that have an open task (t.status = 0).
   * Upsell emails without a task (e.g. pure-upsell with no negative sentiment)
   * are not auto-created today, so they are not "open" and don't count here.
   */
  async getUpsellCountScoped(
    header: RequestHeader,
    filters?: {
      customerId?: string;
      dateFrom?: string;
      dateTo?: string;
    }
  ): Promise<number> {
    const whereParts: SQL[] = [
      sql`e.tenant_id = ${header.tenantId}`,
      sql`e.analysis_status = ${EmailAnalysisStatus.Completed}`,
      sql`e.signals @> ARRAY[${Signal.UPSELL}]::integer[]`,
      sql`ep.customer_id IS NOT NULL`,
      sql`t.status = 0`,
    ];

    if (!isAdmin(header.permissions)) {
      whereParts.push(sql`ep.customer_id IN (
        SELECT uac.customer_id FROM user_accessible_customers uac
        WHERE uac.user_id = ${header.userId}
      )`);
    }

    if (filters?.customerId) {
      whereParts.push(sql`ep.customer_id = ${filters.customerId}`);
    }
    if (filters?.dateFrom) {
      whereParts.push(sql`e.received_at >= ${filters.dateFrom}::timestamp`);
    }
    if (filters?.dateTo) {
      whereParts.push(sql`e.received_at <= ${filters.dateTo}::timestamp`);
    }

    const whereClause = sql.join(whereParts, sql` AND `);

    const result = await this.db.execute<{ count: number }>(sql`
      SELECT count(DISTINCT e.id)::int AS count
      FROM emails e
      INNER JOIN email_participants ep ON ep.email_id = e.id AND ep.direction = 'from'
      LEFT JOIN tasks t ON t.email_id = e.id
      WHERE ${whereClause}
    `);

    return result[0]?.count ?? 0;
  }

  // ===========================================================================
  // Analyzed Email Search
  // ===========================================================================

  /**
   * Map a signal filter string to raw SQL conditions (using table alias "e" for emails)
   * Used in raw SQL queries where emails is aliased as "e"
   */
  private getSignalFilterCondition(signal: string): SQL | null {
    switch (signal) {
      case 'positive':
        return sql`e.signals @> ARRAY[${Signal.SENTIMENT_POSITIVE}]::integer[]`;
      case 'negative':
        return sql`e.signals @> ARRAY[${Signal.SENTIMENT_NEGATIVE}]::integer[]`;
      case 'neutral':
        return sql`e.signals @> ARRAY[${Signal.SENTIMENT_NEUTRAL}]::integer[]`;
      case 'upsell':
        return sql`e.signals @> ARRAY[${Signal.UPSELL}]::integer[]`;
      case 'churn':
        return sql`e.signals && ARRAY[${Signal.CHURN_LOW}, ${Signal.CHURN_MEDIUM}, ${Signal.CHURN_HIGH}, ${Signal.CHURN_CRITICAL}]::integer[]`;
      case 'tat':
        // TAT breach: customer emails unreplied for >= 1 business day,
        // excluding non-business emails (spam, marketing, transactional, automated)
        return sql`e.is_customer_email = true
          AND e.first_reply_at IS NULL
          AND NOT (e.signals && ARRAY[${Signal.CLASSIFICATION_SPAM}, ${Signal.CLASSIFICATION_MARKETING}, ${Signal.CLASSIFICATION_TRANSACTIONAL}, ${Signal.CLASSIFICATION_AUTOMATED}]::integer[])
          AND (
            SELECT GREATEST(0, COUNT(*) - 1)::int
            FROM generate_series(
              e.received_at::date,
              CURRENT_DATE,
              '1 day'::interval
            ) d
            WHERE EXTRACT(dow FROM d) BETWEEN 1 AND 5
              AND d::date NOT IN (
                SELECT h.date::date FROM holiday_calendars h
                WHERE h.tenant_id = e.tenant_id
              )
          ) >= 1`;
      case 'all':
        return null;
      default:
        return null;
    }
  }

  /**
   * Search analyzed emails with optional task overlay
   * Returns emails that have been analyzed (analysis_status = 3)
   * with LEFT JOIN to tasks for task overlay information
   */
  async searchAnalyzedEmails(
    header: RequestHeader,
    request: AnalyzedEmailSearchRequest
  ): Promise<AnalyzedEmailSearchResponse> {
    const limit = request.limit ?? 50;
    const offset = request.offset ?? 0;

    // Build raw SQL WHERE conditions (using table aliases e, ep, t, c).
    // The join to email_participants is restricted to the sender
    // (direction='from') so the displayed customer, the customer-access
    // filter, and the customer-dropdown filter all reflect the sender's
    // customer — never a recipient's. This matches the product rule that
    // customer attribution follows the sender exclusively.
    const whereParts: SQL[] = [
      sql`e.tenant_id = ${header.tenantId}`,
      sql`e.analysis_status = ${EmailAnalysisStatus.Completed}`,
      sql`ep.customer_id IS NOT NULL`,
    ];

    // Customer access filter — sender's customer must be accessible.
    if (!isAdmin(header.permissions)) {
      whereParts.push(sql`ep.customer_id IN (
        SELECT uac.customer_id FROM user_accessible_customers uac
        WHERE uac.user_id = ${header.userId}
      )`);
    }

    // Signal filter
    if (request.signal && request.signal !== 'all') {
      const signalCondition = this.getSignalFilterCondition(request.signal);
      if (signalCondition) {
        whereParts.push(signalCondition);
      }
    }

    // Status filter (only show emails with tasks matching status)
    if (request.status && request.status !== 'all') {
      const taskStatus = request.status === 'done' ? 1 : 0;
      whereParts.push(sql`t.status = ${taskStatus}`);
    }

    // Assignee filter
    if (request.assignedToId) {
      if (request.assignedToId === 'unassigned') {
        whereParts.push(sql`t.id IS NOT NULL AND t.assigned_to_id IS NULL`);
      } else {
        whereParts.push(sql`t.assigned_to_id = ${request.assignedToId}`);
      }
    }

    // Customer filter — the sender's participant link OR the sender's DOMAIN.
    //
    // This is the query behind AI Analysis, and it is what the add-on panel
    // links a fire row into. The panel attributes by who WROTE the mail, via the
    // sender's domain; this matched only the participant link, so a row reading
    // "Berolzheimer — 3 unanswered" landed on "No analyzed emails found" and the
    // panel read as though it had invented the client.
    //
    // The link is not merely absent, it usually points elsewhere: of six negative
    // Berolzheimer emails, ONE carries a participant row naming Berolzheimer and
    // the rest name Mystartupcfo (us) or an unrelated auto-created record.
    // Measured with the page's own filters: 1 -> 5.
    //
    // Both paths are kept. Participant links are often wrong but not always
    // absent, and narrowing to domain alone would drop mail this page shows.
    if (request.customerId) {
      whereParts.push(sql`(
        ep.customer_id = ${request.customerId}
        OR EXISTS (
          SELECT 1 FROM customer_domains cd
          WHERE cd.customer_id = ${request.customerId}
            AND cd.tenant_id = e.tenant_id
            AND lower(cd.domain) = split_part(lower(e.from_email), '@', 2)
        )
      )`);
    }

    // Date range filters
    if (request.dateFrom) {
      whereParts.push(sql`e.received_at >= ${request.dateFrom}::timestamp`);
    }
    if (request.dateTo) {
      whereParts.push(sql`e.received_at <= ${request.dateTo}::timestamp`);
    }

    // Text search
    if (request.search) {
      const term = `%${request.search}%`;
      whereParts.push(sql`(
        e.subject ILIKE ${term} OR
        e.id IN (
          SELECT ep2.email_id FROM email_participants ep2
          WHERE ep2.email ILIKE ${term} OR ep2.name ILIKE ${term}
        )
      )`);
    }

    const whereClause = sql.join(whereParts, sql` AND `);

    // Sort direction
    const sortColumn = request.sortBy === 'createdAt' ? sql`e.created_at` : sql`e.received_at`;
    const sortDir = request.sortOrder === 'asc' ? sql`ASC` : sql`DESC`;

    // Count query — ep is sender-only (direction='from'), so each email
    // contributes exactly one row; DISTINCT isn't needed but harmless.
    const countResult = await this.db.execute<{ count: number }>(sql`
      SELECT count(DISTINCT e.id)::int AS count
      FROM emails e
      INNER JOIN email_participants ep ON ep.email_id = e.id AND ep.direction = 'from'
      INNER JOIN customers c ON c.id = ep.customer_id
      LEFT JOIN tasks t ON t.email_id = e.id
      WHERE ${whereClause}
    `);

    const total = countResult[0]?.count ?? 0;

    // Main query - use subquery for DISTINCT ON then sort in outer query
    const rows = await this.db.execute<{
      id: string;
      subject: string;
      body: string | null;
      from_email: string;
      from_name: string | null;
      received_at: Date;
      signals: number[];
      customer_id: string;
      customer_name: string | null;
      task_id: string | null;
      task_status: number | null;
      assigned_to_id: string | null;
      assigned_to_name: string | null;
      assigned_to_email: string | null;
      problem: string | null;
      resolution: string | null;
      completed_at: Date | null;
      completed_by_id: string | null;
      completed_by_name: string | null;
      task_created_at: Date | null;
    }>(sql`
      SELECT
        e.id,
        e.subject,
        e.body,
        e.from_email,
        e.from_name,
        e.received_at,
        e.created_at,
        e.signals,
        ep.customer_id,
        c.name AS customer_name,
        t.id AS task_id,
        t.status AS task_status,
        t.assigned_to_id,
        CONCAT(assignee_u.first_name, ' ', assignee_u.last_name) AS assigned_to_name,
        assignee_u.email AS assigned_to_email,
        t.problem,
        t.resolution,
        t.completed_at,
        t.completed_by_id,
        CONCAT(completed_u.first_name, ' ', completed_u.last_name) AS completed_by_name,
        t.created_at AS task_created_at
      FROM emails e
      INNER JOIN email_participants ep ON ep.email_id = e.id AND ep.direction = 'from'
      INNER JOIN customers c ON c.id = ep.customer_id
      LEFT JOIN tasks t ON t.email_id = e.id
      LEFT JOIN users assignee_u ON assignee_u.id = t.assigned_to_id
      LEFT JOIN users completed_u ON completed_u.id = t.completed_by_id
      WHERE ${whereClause}
      ORDER BY ${sortColumn} ${sortDir}
      LIMIT ${limit}
      OFFSET ${offset}
    `);

    // Recipients are omitted here — see AnalyzedEmailListItem. The detail view
    // fetches them via getAnalyzedEmailById.
    const items: AnalyzedEmailListItem[] = rows.map(row => ({
      id: row.id,
      subject: row.subject,
      body: row.body,
      fromEmail: row.from_email,
      fromName: row.from_name,
      receivedAt: new Date(row.received_at),
      signals: row.signals ?? [],
      customerId: row.customer_id,
      customerName: row.customer_name,
      taskId: row.task_id,
      taskStatus: row.task_status,
      assignedToId: row.assigned_to_id,
      assignedToName: row.assigned_to_name,
      assignedToEmail: row.assigned_to_email,
      problem: row.problem,
      resolution: row.resolution,
      completedAt: row.completed_at ? new Date(row.completed_at) : null,
      completedById: row.completed_by_id,
      completedByName: row.completed_by_name,
      taskCreatedAt: row.task_created_at ? new Date(row.task_created_at) : null,
    }));

    return { items, total, limit, offset };
  }

  /**
   * Export analyzed emails with comments - no pagination limit
   * Returns all matching analyzed emails with task comments
   */
  async exportAnalyzedEmails(
    header: RequestHeader,
    request: AnalyzedEmailSearchRequest
    // Recipients are omitted: the XLSX column list has no To/Cc columns, and
    // this query is unpaginated, so fetching them would be dead payload on
    // every exported row.
  ): Promise<Array<Omit<AnalyzedEmail, 'tos' | 'ccs'> & { taskComments: Array<{ userName: string; content: string; createdAt: Date }> }>> {
    // Build raw SQL WHERE conditions (same as searchAnalyzedEmails)
    const whereParts: SQL[] = [
      sql`e.tenant_id = ${header.tenantId}`,
      sql`e.analysis_status = ${EmailAnalysisStatus.Completed}`,
      sql`ep.customer_id IS NOT NULL`,
    ];

    if (!isAdmin(header.permissions)) {
      whereParts.push(sql`ep.customer_id IN (
        SELECT uac.customer_id FROM user_accessible_customers uac
        WHERE uac.user_id = ${header.userId}
      )`);
    }

    if (request.signal && request.signal !== 'all') {
      const signalCondition = this.getSignalFilterCondition(request.signal);
      if (signalCondition) {
        whereParts.push(signalCondition);
      }
    }

    if (request.status && request.status !== 'all') {
      const taskStatus = request.status === 'done' ? 1 : 0;
      whereParts.push(sql`t.status = ${taskStatus}`);
    }

    if (request.assignedToId) {
      if (request.assignedToId === 'unassigned') {
        whereParts.push(sql`t.id IS NOT NULL AND t.assigned_to_id IS NULL`);
      } else {
        whereParts.push(sql`t.assigned_to_id = ${request.assignedToId}`);
      }
    }

    if (request.customerId) {
      whereParts.push(sql`ep.customer_id = ${request.customerId}`);
    }

    if (request.dateFrom) {
      whereParts.push(sql`e.received_at >= ${request.dateFrom}::timestamp`);
    }
    if (request.dateTo) {
      whereParts.push(sql`e.received_at <= ${request.dateTo}::timestamp`);
    }

    if (request.search) {
      const term = `%${request.search}%`;
      whereParts.push(sql`(
        e.subject ILIKE ${term} OR
        e.id IN (
          SELECT ep2.email_id FROM email_participants ep2
          WHERE ep2.email ILIKE ${term} OR ep2.name ILIKE ${term}
        )
      )`);
    }

    const whereClause = sql.join(whereParts, sql` AND `);

    // Main query - no LIMIT/OFFSET for export
    const rows = await this.db.execute<{
      id: string;
      subject: string;
      body: string | null;
      from_email: string;
      from_name: string | null;
      received_at: Date;
      signals: number[];
      customer_id: string;
      customer_name: string | null;
      task_id: string | null;
      task_status: number | null;
      assigned_to_id: string | null;
      assigned_to_name: string | null;
      assigned_to_email: string | null;
      problem: string | null;
      resolution: string | null;
      completed_at: Date | null;
      completed_by_id: string | null;
      completed_by_name: string | null;
      task_created_at: Date | null;
    }>(sql`
      SELECT
        e.id,
        e.subject,
        e.body,
        e.from_email,
        e.from_name,
        e.received_at,
        e.created_at,
        e.signals,
        ep.customer_id,
        c.name AS customer_name,
        t.id AS task_id,
        t.status AS task_status,
        t.assigned_to_id,
        CONCAT(assignee_u.first_name, ' ', assignee_u.last_name) AS assigned_to_name,
        assignee_u.email AS assigned_to_email,
        t.problem,
        t.resolution,
        t.completed_at,
        t.completed_by_id,
        CONCAT(completed_u.first_name, ' ', completed_u.last_name) AS completed_by_name,
        t.created_at AS task_created_at
      FROM emails e
      INNER JOIN email_participants ep ON ep.email_id = e.id AND ep.direction = 'from'
      INNER JOIN customers c ON c.id = ep.customer_id
      LEFT JOIN tasks t ON t.email_id = e.id
      LEFT JOIN users assignee_u ON assignee_u.id = t.assigned_to_id
      LEFT JOIN users completed_u ON completed_u.id = t.completed_by_id
      WHERE ${whereClause}
      ORDER BY e.received_at DESC
    `);

    if (rows.length === 0) {
      return [];
    }

    // Collect task IDs for comment fetching
    const taskIds = rows
      .map(r => r.task_id)
      .filter((id): id is string => id !== null);

    // Fetch all comments for tasks in one query
    let commentsByTaskId = new Map<string, Array<{ userName: string; content: string; createdAt: Date }>>();
    if (taskIds.length > 0) {
      const allComments = await this.db
        .select({
          taskId: taskComments.taskId,
          content: taskComments.content,
          createdAt: taskComments.createdAt,
          userName: sql<string>`CONCAT(${users.firstName}, ' ', ${users.lastName})`.as('userName'),
        })
        .from(taskComments)
        .innerJoin(users, eq(taskComments.userId, users.id))
        .where(inArray(taskComments.taskId, taskIds))
        .orderBy(asc(taskComments.createdAt));

      for (const comment of allComments) {
        const existing = commentsByTaskId.get(comment.taskId) || [];
        existing.push({
          userName: comment.userName,
          content: comment.content,
          createdAt: comment.createdAt,
        });
        commentsByTaskId.set(comment.taskId, existing);
      }
    }

    return rows.map(row => ({
      id: row.id,
      subject: row.subject,
      body: row.body,
      fromEmail: row.from_email,
      fromName: row.from_name,
      receivedAt: new Date(row.received_at),
      signals: row.signals ?? [],
      customerId: row.customer_id,
      customerName: row.customer_name,
      taskId: row.task_id,
      taskStatus: row.task_status,
      assignedToId: row.assigned_to_id,
      assignedToName: row.assigned_to_name,
      assignedToEmail: row.assigned_to_email,
      problem: row.problem,
      resolution: row.resolution,
      completedAt: row.completed_at ? new Date(row.completed_at) : null,
      completedById: row.completed_by_id,
      completedByName: row.completed_by_name,
      taskCreatedAt: row.task_created_at ? new Date(row.task_created_at) : null,
      taskComments: row.task_id ? (commentsByTaskId.get(row.task_id) || []) : [],
    }));
  }

  /**
   * Get a single analyzed email by ID with task overlay
   */
  async getAnalyzedEmailById(
    header: RequestHeader,
    id: string
  ): Promise<AnalyzedEmail | null> {
    // `id` may be an email id OR a task id. Resolve task→email so old/stray
    // links that carry a task id (notification emails historically linked by
    // task id) still open the right escalation. The task lookup is tenant-scoped.
    const whereParts: SQL[] = [
      sql`e.tenant_id = ${header.tenantId}`,
      sql`(
        e.id = ${id}
        OR e.id = (
          SELECT t2.email_id FROM tasks t2
          WHERE t2.id = ${id} AND t2.tenant_id = ${header.tenantId}
        )
      )`,
      sql`ep.customer_id IS NOT NULL`,
    ];

    if (!isAdmin(header.permissions)) {
      whereParts.push(sql`ep.customer_id IN (
        SELECT uac.customer_id FROM user_accessible_customers uac
        WHERE uac.user_id = ${header.userId}
      )`);
    }

    const whereClause = sql.join(whereParts, sql` AND `);

    const rows = await this.db.execute<{
      id: string;
      subject: string;
      body: string | null;
      from_email: string;
      from_name: string | null;
      tos: Array<{ email: string; name?: string }> | null;
      ccs: Array<{ email: string; name?: string }> | null;
      received_at: Date;
      signals: number[];
      customer_id: string;
      customer_name: string | null;
      task_id: string | null;
      task_status: number | null;
      assigned_to_id: string | null;
      assigned_to_name: string | null;
      assigned_to_email: string | null;
      problem: string | null;
      resolution: string | null;
      completed_at: Date | null;
      completed_by_id: string | null;
      completed_by_name: string | null;
      task_created_at: Date | null;
    }>(sql`
      SELECT
        e.id,
        e.subject,
        e.body,
        e.from_email,
        e.from_name,
        e.tos,
        e.ccs,
        e.received_at,
        e.signals,
        ep.customer_id,
        c.name AS customer_name,
        t.id AS task_id,
        t.status AS task_status,
        t.assigned_to_id,
        CONCAT(assignee_u.first_name, ' ', assignee_u.last_name) AS assigned_to_name,
        assignee_u.email AS assigned_to_email,
        t.problem,
        t.resolution,
        t.completed_at,
        t.completed_by_id,
        CONCAT(completed_u.first_name, ' ', completed_u.last_name) AS completed_by_name,
        t.created_at AS task_created_at
      FROM emails e
      INNER JOIN email_participants ep ON ep.email_id = e.id AND ep.direction = 'from'
      INNER JOIN customers c ON c.id = ep.customer_id
      LEFT JOIN tasks t ON t.email_id = e.id
      LEFT JOIN users assignee_u ON assignee_u.id = t.assigned_to_id
      LEFT JOIN users completed_u ON completed_u.id = t.completed_by_id
      WHERE ${whereClause}
      LIMIT 1
    `);

    if (rows.length === 0) return null;

    const row = rows[0];
    return {
      id: row.id,
      subject: row.subject,
      body: row.body,
      fromEmail: row.from_email,
      fromName: row.from_name,
      tos: row.tos ?? [],
      ccs: row.ccs ?? [],
      receivedAt: new Date(row.received_at),
      signals: row.signals ?? [],
      customerId: row.customer_id,
      customerName: row.customer_name,
      taskId: row.task_id,
      taskStatus: row.task_status,
      assignedToId: row.assigned_to_id,
      assignedToName: row.assigned_to_name,
      assignedToEmail: row.assigned_to_email,
      problem: row.problem,
      resolution: row.resolution,
      completedAt: row.completed_at ? new Date(row.completed_at) : null,
      completedById: row.completed_by_id,
      completedByName: row.completed_by_name,
      taskCreatedAt: row.task_created_at ? new Date(row.task_created_at) : null,
    };
  }

  // ===========================================================================
  // TAT (Turn Around Time) Metrics
  // ===========================================================================

  /**
   * Build the base TAT CTE that calculates business days for each email-customer pair.
   * This is the SINGLE SOURCE OF TRUTH for all TAT calculations.
   *
   * The CTE produces rows with: email_id, customer_id, customer_name, business_days
   *
   * Business days = Mon-Fri, excluding holidays from holiday_calendars
   * TAT is calculated from email receivedAt to firstReplyAt (or NOW() if no reply)
   *
   * @param header - Request header for access control
   * @param filters - Optional filters for customerId, dateFrom, dateTo
   * @returns Raw SQL string for the CTE (to be used with sql.raw())
   */
  private buildTATBaseCTE(
    header: RequestHeader,
    filters?: {
      customerId?: string;
      dateFrom?: string;
      dateTo?: string;
    }
  ): string {
    // Build filter conditions
    const filterConditions: string[] = [];
    if (filters?.customerId) {
      filterConditions.push(`AND ep.customer_id = '${filters.customerId}'`);
    }
    if (filters?.dateFrom) {
      filterConditions.push(`AND e.received_at >= '${filters.dateFrom}'::timestamp`);
    }
    if (filters?.dateTo) {
      filterConditions.push(`AND e.received_at <= '${filters.dateTo}'::timestamp`);
    }

    // Add customer access filter for non-admin users
    if (!isAdmin(header.permissions)) {
      filterConditions.push(`AND ep.customer_id IN (
        SELECT uac.customer_id FROM user_accessible_customers uac
        WHERE uac.user_id = '${header.userId}'
      )`);
    }

    const filterClause = filterConditions.join(' ');

    // Note: DISTINCT ON (e.id, ep.customer_id) ensures each email is counted once per customer
    // (an email can be linked to multiple customers via participants)
    // Exclude non-business emails (spam, marketing, transactional, automated) from TAT calculation
    const excludedSignals = [
      Signal.CLASSIFICATION_SPAM,
      Signal.CLASSIFICATION_MARKETING,
      Signal.CLASSIFICATION_TRANSACTIONAL,
      Signal.CLASSIFICATION_AUTOMATED,
    ].join(', ');

    return `
      WITH customer_emails AS (
        SELECT DISTINCT ON (e.id, ep.customer_id)
          e.id AS email_id,
          e.tenant_id,
          e.received_at,
          e.first_reply_at,
          ep.customer_id,
          c.name AS customer_name
        FROM emails e
        INNER JOIN email_participants ep ON e.id = ep.email_id AND ep.customer_id IS NOT NULL
        INNER JOIN customers c ON ep.customer_id = c.id
        WHERE e.tenant_id = '${header.tenantId}'
          AND e.is_customer_email = true
          AND NOT (e.signals && ARRAY[${excludedSignals}]::integer[])
          ${filterClause}
      ),
      email_with_timezone AS (
        SELECT
          ce.*,
          COALESCE(
            (SELECT u.timezone
             FROM tenants t
             LEFT JOIN user_customers uc ON ce.customer_id = uc.customer_id
               AND uc.role_id = t.account_manager_role_id
             LEFT JOIN users u ON uc.user_id = u.id
             WHERE t.id = ce.tenant_id
             LIMIT 1),
            'UTC'
          ) AS account_manager_timezone
        FROM customer_emails ce
      ),
      email_with_business_days AS (
        SELECT
          ewt.email_id,
          ewt.customer_id,
          ewt.customer_name,
          (
            SELECT GREATEST(0, COUNT(*) - 1)::int
            FROM generate_series(
              (ewt.received_at AT TIME ZONE ewt.account_manager_timezone)::date,
              (COALESCE(ewt.first_reply_at, NOW()) AT TIME ZONE ewt.account_manager_timezone)::date,
              '1 day'::interval
            ) d
            WHERE EXTRACT(dow FROM d) BETWEEN 1 AND 5
              AND d::date NOT IN (
                SELECT h.date::date
                FROM holiday_calendars h
                WHERE h.tenant_id = ewt.tenant_id
                  AND h.timezone = ewt.account_manager_timezone
              )
          ) AS business_days
        FROM email_with_timezone ewt
      )
    `;
  }

  /**
   * Get TAT metrics for dashboard with access control
   * Returns counts of SLA breaches (1+, 2+, 3+, 5+, 6+ business days) grouped by customer
   *
   * Uses buildTATBaseCTE for consistent business days calculation.
   */
  async getTATMetricsScoped(
    header: RequestHeader,
    filters?: {
      customerId?: string;
      dateFrom?: string;
      dateTo?: string;
    }
  ): Promise<TATMetricRow[]> {
    const baseCTE = this.buildTATBaseCTE(header, filters);

    const query = sql`
      ${sql.raw(baseCTE)}
      SELECT
        customer_id AS "customerId",
        customer_name AS "customerName",
        COUNT(*) FILTER (WHERE business_days >= 1 AND business_days < 2)::int AS "onePlusDays",
        COUNT(*) FILTER (WHERE business_days >= 2 AND business_days < 3)::int AS "twoPlusDays",
        COUNT(*) FILTER (WHERE business_days >= 3 AND business_days < 5)::int AS "threePlusDays",
        COUNT(*) FILTER (WHERE business_days >= 5 AND business_days < 6)::int AS "fivePlusDays",
        COUNT(*) FILTER (WHERE business_days >= 6)::int AS "sixPlusDays"
      FROM email_with_business_days
      WHERE business_days >= 1
      GROUP BY customer_id, customer_name
      ORDER BY "sixPlusDays" DESC, "fivePlusDays" DESC, "threePlusDays" DESC, "twoPlusDays" DESC, "onePlusDays" DESC
    `;

    const result = await this.db.execute(query);
    return result as unknown as TATMetricRow[];
  }

  /**
   * Get TAT violation email IDs as a SQL subquery (not executed)
   * Used for adding TAT filter to existing queries via WHERE id IN (subquery)
   *
   * Uses buildTATBaseCTE for consistent business days calculation.
   */
  private getTATViolationSubquery(
    header: RequestHeader,
    customerId: string,
    dateFrom?: string,
    dateTo?: string
  ): ReturnType<typeof sql> {
    const baseCTE = this.buildTATBaseCTE(header, {
      customerId,
      dateFrom,
      dateTo,
    });

    return sql`
      ${sql.raw(baseCTE)}
      SELECT email_id
      FROM email_with_business_days
      WHERE business_days >= 1
    `;
  }

  /**
   * Update first reply info for customer emails in a thread
   * Called when a new email is inserted that's a reply from tenant domain
   *
   * @param tenantId - Tenant ID
   * @param threadId - Thread ID
   * @param replyEmailId - ID of the reply email
   * @param replyReceivedAt - Timestamp of when the reply was received
   * @param _tenantDomains - Unused (kept for backwards compatibility)
   */
  /**
   * Set first_reply_at on customer emails for a batch of (thread, reply-timestamp)
   * pairs in a single set-based UPDATE.
   *
   * For each customer email we record the EARLIEST reply that arrived strictly
   * after it (MIN(reply_at) WHERE reply_at > received_at) — i.e. the time-to-response.
   * The `first_reply_at IS NULL` guard means an earlier batch's value is never
   * overwritten, so this is safe to call repeatedly as replies trickle in.
   *
   * Reply emails themselves are never stored (first_reply_email_id stays null);
   * we only persist their timestamp on the customer email they answered.
   *
   * @param threadIds         Internal thread UUIDs, parallel to replyReceivedAts
   * @param replyReceivedAts  Reply timestamps, parallel to threadIds
   */
  /**
   * Shared core for the first-reply UPDATEs. Sets first_reply_at on customer
   * emails to the earliest reply that arrived strictly after them. The caller
   * supplies the JOIN fragment that relates a `r(…, reply_at)` VALUES table to
   * `emails e2` (directly by thread_id, or via email_threads by provider id);
   * everything else — the guards, MIN/GROUP BY, and logging — is identical.
   */
  private async runFirstReplyUpdate(
    tenantId: string,
    joinFragment: SQL,
    logContext: Record<string, unknown>,
    message: string,
    /**
     * Whether `joinFragment`'s VALUES table carries a `replied_by_id` column.
     *
     * The two callers differ: the marker path resolves the sender to a user and
     * passes it, the thread-id path has only timestamps. Rather than force a
     * NULL column into the second one, the winning row's author is written only
     * where it exists.
     */
    carriesAuthor = false
  ): Promise<number> {
    // DISTINCT ON, NOT MIN() ... GROUP BY.
    //
    // Both forms pick the earliest qualifying reply, and only one of them can
    // also say WHO sent it. An aggregate collapses the rows it is choosing
    // between, so the author of the winning reply is not available to the SET
    // clause -- and `first_reply_by_id` was therefore computed and thrown away.
    // attributeRepliesToUsers resolved it, the VALUES row carried it, and the
    // UPDATE never referenced it again.
    //
    // Measured on this tenant before the fix: 16,290 emails carried a reply time
    // and 2,065 an author, the remainder written by a build that predated the
    // regression. Downstream had already adapted -- the slow-responder section
    // attributes by the allocation sheet rather than by who actually replied,
    // because this column could not be relied on.
    //
    // The regression arrived with the squashed port 72f8231, which replaced a
    // DISTINCT ON form with this aggregate. It is restored here.
    //
    // ORDER BY reply_at then replied_by_id NULLS LAST: on the rare tie, prefer
    // the row that can name a person over one that cannot.
    const authorSelect = carriesAuthor ? sql`, r.replied_by_id` : sql`, NULL::uuid AS replied_by_id`;
    const authorOrder = carriesAuthor ? sql`, r.replied_by_id NULLS LAST` : sql``;
    const result = await this.db.execute(sql`
      UPDATE emails e
      SET
        first_reply_at = sub.min_reply,
        first_reply_by_id = COALESCE(sub.replied_by_id, e.first_reply_by_id),
        updated_at = NOW()
      FROM (
        SELECT DISTINCT ON (e2.id)
               e2.id AS email_id, r.reply_at AS min_reply${authorSelect}
        FROM emails e2
        ${joinFragment}
        WHERE e2.tenant_id = ${tenantId}
          AND e2.is_customer_email = true
          AND e2.first_reply_at IS NULL
        ORDER BY e2.id, r.reply_at${authorOrder}
      ) sub
      WHERE e.id = sub.email_id
    `);

    const rowCount = (result as any).rowCount || 0;

    if (rowCount > 0) {
      logger.info({ tenantId, ...logContext, updatedCount: rowCount }, message);
    }

    return rowCount;
  }

  async setFirstReplyForThreads(
    tenantId: string,
    threadIds: string[],
    replyReceivedAts: Date[]
  ): Promise<number> {
    if (threadIds.length === 0 || threadIds.length !== replyReceivedAts.length) {
      return 0;
    }

    // Build a VALUES list of (thread_id, reply_at) pairs. The casts on the row
    // fragments establish the column types for the VALUES-derived table.
    const pairs = threadIds.map(
      (threadId, i) => sql`(${threadId}::uuid, ${replyReceivedAts[i].toISOString()}::timestamp)`
    );
    const valuesList = sql.join(pairs, sql`, `);
    const joinFragment = sql`
      JOIN (VALUES ${valuesList}) AS r(thread_id, reply_at)
        ON r.thread_id = e2.thread_id
       AND r.reply_at > e2.received_at`;

    return this.runFirstReplyUpdate(
      tenantId,
      joinFragment,
      { threadCount: new Set(threadIds).size, replyCount: threadIds.length },
      'Updated firstReplyAt for customer emails'
    );
  }

  /**
   * Set first_reply_at / first_reply_by_id on customer emails from a batch of
   * replies keyed by the PROVIDER's thread id, in a single set-based UPDATE.
   *
   * Same semantics as {@link setFirstReplyForThreads}, but callers that only have
   * header metadata — e.g. blacklisted tenant-domain replies the Gmail sync never
   * stores — don't need to resolve internal thread UUIDs first.
   *
   * Threads are matched on (tenant, provider_thread_id) across EVERY integration,
   * deliberately NOT the submitting one. `email_threads` is unique on
   * (tenant, integration, provider_thread_id), so reconnecting a mailbox — which
   * mints a new integration row — starts a second set of thread rows for the very
   * same Gmail threads. Scoping the lookup to the submitting integration therefore
   * made every reply to a thread first seen under a previous connection
   * unmatchable: the join dropped it silently, with `updatedCount: 0` the only
   * trace. In production that fragmented one mailbox across three integrations and
   * put 62k customer emails permanently out of reach. See ADR-005.
   *
   * A provider thread id is unique per mailbox, and a reply's recipients still have
   * to satisfy the originator rule, so widening to the tenant does not let a reply
   * attach to an unrelated conversation. Where the same Gmail thread has rows under
   * several integrations, all of them match — `DISTINCT ON (e2.id)` in
   * {@link runFirstReplyUpdate} still yields one winning reply per email.
   *
   * @param integrationId  Integration that submitted the batch — recorded in the
   *                       log context for observability, NOT used for matching.
   * @param replies        Replies keyed by provider thread id
   */
  async setFirstReplyForProviderThreads(
    tenantId: string,
    integrationId: string,
    replies: Array<{ providerThreadId: string } & FirstReplyCandidate>
  ): Promise<number> {
    if (replies.length === 0) {
      return 0;
    }

    // Build a VALUES list of (provider_thread_id, reply_at, recipients,
    // replied_by_id) rows. The casts on the row fragments establish the column
    // types for the VALUES-derived table.
    const rows = replies.map(
      (r) => sql`(
        ${r.providerThreadId}::text,
        ${r.receivedAt.toISOString()}::timestamp,
        ${EmailRepository.recipientsArray(r.recipients)},
        ${r.repliedById}::uuid
      )`
    );
    const joinFragment = sql`
      JOIN email_threads et
        ON et.id = e2.thread_id
       AND et.tenant_id = ${tenantId}
      JOIN (VALUES ${sql.join(rows, sql`, `)}) AS r(provider_thread_id, reply_at, recipients, replied_by_id)
        ON r.provider_thread_id = et.provider_thread_id
       AND r.reply_at > e2.received_at
       AND LOWER(e2.from_email) = ANY(r.recipients)`;

    return this.runFirstReplyUpdate(
      tenantId,
      joinFragment,
      {
        integrationId,
        threadCount: new Set(replies.map((r) => r.providerThreadId)).size,
        replyCount: replies.length,
      },
      'Updated firstReplyAt for customer emails (from reply markers)',
      // This path resolved the sender to a user id, so the winning reply can
      // name a person.
      true
    );
  }

  /**
   * Reassign all email participants from one customer to another.
   */
  async reassignParticipantCustomer(tenantId: string, sourceCustomerId: string, targetCustomerId: string, tx?: Transaction): Promise<number> {
    const db = tx ?? this.db;
    const result = await db.execute(sql`
      UPDATE email_participants
      SET customer_id = ${targetCustomerId}
      WHERE customer_id = ${sourceCustomerId} AND tenant_id = ${tenantId}
    `);
    return (result as any).rowCount ?? 0;
  }
}
