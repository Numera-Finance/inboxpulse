import { injectable, inject } from 'tsyringe';
import { ScopedRepository } from '@crm/database';
import type { Database } from '@crm/database';
import { isAdmin, type RequestHeader, Signal, getSentimentFromSignals } from '@crm/shared';
import type { NewEmail, NewEmailParticipant } from './schema';
import { emails, EmailAnalysisStatus, emailParticipants, emailAnalyses } from './schema';
import { eq, and, desc, sql, inArray, or, SQL } from 'drizzle-orm';
import { logger } from '../utils/logger';

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
  async findById(emailId: string) {
    const result = await this.db
      .select()
      .from(emails)
      .where(eq(emails.id, emailId))
      .limit(1);

    return result[0] || null;
  }

  /**
   * Update email signals after analysis
   * Sets the signals array with all detected signals
   * @param emailId - Email UUID
   * @param signals - Array of Signal integers (from @crm/shared Signal constants)
   * @param tx - Optional transaction context
   */
  async updateSignals(
    emailId: string,
    signals: number[],
    tx?: any
  ): Promise<void> {
    const db = tx ?? this.db;
    await db
      .update(emails)
      .set({
        signals,
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
    tx?: any
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

    return this.db
      .selectDistinct({ emails })
      .from(emails)
      .innerJoin(emailParticipants, eq(emails.id, emailParticipants.emailId))
      .where(
        and(
          eq(emails.tenantId, tenantId),
          eq(emailParticipants.customerId, customerId)
        )
      )
      .orderBy(desc(emails.receivedAt))
      .limit(limit)
      .offset(offset)
      .then(rows => rows.map(r => r.emails));
  }

  /**
   * Count emails by customer using email_participants
   */
  async countByCustomer(tenantId: string, customerId: string): Promise<number> {
    const result = await this.db
      .select({ count: sql<number>`count(DISTINCT ${emails.id})::int` })
      .from(emails)
      .innerJoin(emailParticipants, eq(emails.id, emailParticipants.emailId))
      .where(
        and(
          eq(emails.tenantId, tenantId),
          eq(emailParticipants.customerId, customerId)
        )
      );

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
   *
   * Query pattern:
   * - Joins emails → email_participants → user_accessible_customers
   * - Only returns emails where at least one participant is from an accessible customer
   */
  private emailAccessSubquery(header: RequestHeader): ReturnType<typeof sql> {
    return sql`${emails.id} IN (
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
      eq(emailParticipants.customerId, customerId),
    ];

    // Add sentiment filter using signals array
    if (options?.sentiment) {
      const signalValue = options.sentiment === 'positive' ? Signal.SENTIMENT_POSITIVE
        : options.sentiment === 'negative' ? Signal.SENTIMENT_NEGATIVE
        : Signal.SENTIMENT_NEUTRAL;
      conditions.push(signalContains(signalValue));
    }

    // Add escalation filter using signals array
    if (options?.escalation) {
      conditions.push(signalContains(Signal.ESCALATION));
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

    return query
      .where(and(...conditions))
      .orderBy(desc(emails.receivedAt))
      .limit(limit)
      .offset(offset)
      .then(rows => rows.map(r => r.emails));
  }

  /**
   * Count emails by customer with access control
   * Uses email_participants table
   * Supports filtering by sentiment, escalation, upsell, and churn signals
   */
  async countByCustomerScoped(
    header: RequestHeader,
    customerId: string,
    filters?: {
      sentiment?: 'positive' | 'negative' | 'neutral';
      escalation?: boolean;
      signal?: 'upsell' | 'churn';
    }
  ): Promise<number> {
    const hasAccess = await this.hasCustomerAccess(header, customerId);
    if (!hasAccess) {
      return 0;
    }

    // Build base conditions
    const conditions: SQL[] = [
      eq(emails.tenantId, header.tenantId),
      eq(emailParticipants.customerId, customerId),
    ];

    // Add sentiment filter using signals array
    if (filters?.sentiment) {
      const signalValue = filters.sentiment === 'positive' ? Signal.SENTIMENT_POSITIVE
        : filters.sentiment === 'negative' ? Signal.SENTIMENT_NEGATIVE
        : Signal.SENTIMENT_NEUTRAL;
      conditions.push(signalContains(signalValue));
    }

    // Add escalation filter using signals array
    if (filters?.escalation) {
      conditions.push(signalContains(Signal.ESCALATION));
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
  async createParticipants(participants: NewEmailParticipant[], tx?: any): Promise<void> {
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
    customerIds: string[]
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

    // Count emails per customer
    const result = await this.db
      .select({
        customerId: emailParticipants.customerId,
        count: sql<number>`count(DISTINCT ${emails.id})::int`,
      })
      .from(emailParticipants)
      .innerJoin(emails, eq(emails.id, emailParticipants.emailId))
      .where(
        and(
          eq(emails.tenantId, header.tenantId),
          inArray(emailParticipants.customerId, accessible)
        )
      )
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
    customerIds: string[]
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
          eq(emails.tenantId, header.tenantId),
          inArray(emailParticipants.customerId, accessible)
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
   * Get aggregate sentiment by customer IDs (with access control)
   * Reads sentiment from signals array using Signal constants
   */
  async getAggregateSentimentByCustomerIdsScoped(
    header: RequestHeader,
    customerIds: string[]
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
          eq(emails.tenantId, header.tenantId),
          inArray(emailParticipants.customerId, accessible),
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

  /**
   * Get escalation counts by customer IDs (with access control)
   * Counts emails with negative sentiment signal (used as escalation indicator)
   */
  async getEscalationCountsByCustomerIdsScoped(
    header: RequestHeader,
    customerIds: string[]
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

    // Count negative sentiment emails per customer (used as escalation indicator)
    const result = await this.db
      .select({
        customerId: emailParticipants.customerId,
        count: sql<number>`count(DISTINCT ${emails.id})::int`,
      })
      .from(emailParticipants)
      .innerJoin(emails, eq(emails.id, emailParticipants.emailId))
      .where(
        and(
          eq(emails.tenantId, header.tenantId),
          inArray(emailParticipants.customerId, accessible),
          signalContains(Signal.SENTIMENT_NEGATIVE)
        )
      )
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
    customerIds: string[]
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

    const result = await this.db
      .select({
        customerId: emailParticipants.customerId,
        count: sql<number>`count(DISTINCT ${emails.id})::int`,
      })
      .from(emailParticipants)
      .innerJoin(emails, eq(emails.id, emailParticipants.emailId))
      .where(
        and(
          eq(emails.tenantId, header.tenantId),
          inArray(emailParticipants.customerId, accessible),
          signalContains(Signal.UPSELL)
        )
      )
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
    customerIds: string[]
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

    const result = await this.db
      .select({
        customerId: emailParticipants.customerId,
        count: sql<number>`count(DISTINCT ${emails.id})::int`,
      })
      .from(emailParticipants)
      .innerJoin(emails, eq(emails.id, emailParticipants.emailId))
      .where(
        and(
          eq(emails.tenantId, header.tenantId),
          inArray(emailParticipants.customerId, accessible),
          signalOverlaps(churnSignals)
        )
      )
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
    customerIds: string[]
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

    const result = await this.db
      .select({
        customerId: emailParticipants.customerId,
        count: sql<number>`count(DISTINCT ${emails.id})::int`,
      })
      .from(emailParticipants)
      .innerJoin(emails, eq(emails.id, emailParticipants.emailId))
      .where(
        and(
          eq(emails.tenantId, header.tenantId),
          inArray(emailParticipants.customerId, accessible),
          signalContains(Signal.SENTIMENT_POSITIVE)
        )
      )
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
    ];

    // Add customer filter via email_participants
    if (filters?.customerId) {
      conditions.push(
        sql`${emails.id} IN (
          SELECT ep.email_id FROM email_participants ep
          WHERE ep.customer_id = ${filters.customerId}
        )`
      );
    }

    // Add date filters
    if (filters?.dateFrom) {
      conditions.push(sql`${emails.receivedAt} >= ${filters.dateFrom}::timestamp`);
    }
    if (filters?.dateTo) {
      conditions.push(sql`${emails.receivedAt} <= ${filters.dateTo}::timestamp`);
    }

    const result = await this.db
      .select({
        total: sql<number>`count(*)::int`,
        analyzed: sql<number>`count(*) FILTER (WHERE ${emails.id} IN (
          SELECT DISTINCT ea.email_id FROM email_analyses ea
        ))::int`,
      })
      .from(emails)
      .where(and(...conditions));

    return {
      total: result[0]?.total ?? 0,
      analyzed: result[0]?.analyzed ?? 0,
    };
  }

  /**
   * Get sentiment distribution for dashboard chart with access control
   * Returns counts for positive, neutral, and negative sentiment
   * Queries email_analyses table for sentiment data
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
      eq(emailAnalyses.tenantId, header.tenantId),
      eq(emailAnalyses.analysisType, 'sentiment'),
    ];

    // Add customer filter via email_participants
    if (filters?.customerId) {
      conditions.push(
        sql`${emailAnalyses.emailId} IN (
          SELECT ep.email_id FROM email_participants ep
          WHERE ep.customer_id = ${filters.customerId}
        )`
      );
    }

    // Add date filters via emails table
    if (filters?.dateFrom || filters?.dateTo) {
      const dateConditions: SQL[] = [];
      if (filters?.dateFrom) {
        dateConditions.push(sql`e.received_at >= ${filters.dateFrom}::timestamp`);
      }
      if (filters?.dateTo) {
        dateConditions.push(sql`e.received_at <= ${filters.dateTo}::timestamp`);
      }
      conditions.push(
        sql`${emailAnalyses.emailId} IN (
          SELECT e.id FROM emails e
          WHERE ${and(...dateConditions)}
        )`
      );
    }

    const result = await this.db
      .select({
        positive: sql<number>`count(*) FILTER (WHERE ${emailAnalyses.sentimentValue} = 'positive')::int`,
        neutral: sql<number>`count(*) FILTER (WHERE ${emailAnalyses.sentimentValue} = 'neutral')::int`,
        negative: sql<number>`count(*) FILTER (WHERE ${emailAnalyses.sentimentValue} = 'negative')::int`,
      })
      .from(emailAnalyses)
      .where(and(...conditions));

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
      eq(emailAnalyses.tenantId, header.tenantId),
      eq(emailAnalyses.analysisType, 'sentiment'),
      // Filter to last 6 months
      sql`${emailAnalyses.createdAt} >= date_trunc('month', now() - interval '5 months')`,
    ];

    // Add customer filter via email_participants
    if (filters?.customerId) {
      conditions.push(
        sql`${emailAnalyses.emailId} IN (
          SELECT ep.email_id FROM email_participants ep
          WHERE ep.customer_id = ${filters.customerId}
        )`
      );
    }

    const result = await this.db
      .select({
        month: sql<string>`to_char(${emailAnalyses.createdAt}, 'YYYY-MM')`,
        positive: sql<number>`count(*) FILTER (WHERE ${emailAnalyses.sentimentValue} = 'positive')::int`,
        neutral: sql<number>`count(*) FILTER (WHERE ${emailAnalyses.sentimentValue} = 'neutral')::int`,
        negative: sql<number>`count(*) FILTER (WHERE ${emailAnalyses.sentimentValue} = 'negative')::int`,
      })
      .from(emailAnalyses)
      .where(and(...conditions))
      .groupBy(sql`to_char(${emailAnalyses.createdAt}, 'YYYY-MM')`)
      .orderBy(sql`to_char(${emailAnalyses.createdAt}, 'YYYY-MM')`);

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
      // Filter to last 4 weeks
      sql`${emails.receivedAt} >= date_trunc('week', now() - interval '3 weeks')`,
    ];

    // Add customer filter via email_participants
    if (filters?.customerId) {
      conditions.push(
        sql`${emails.id} IN (
          SELECT ep.email_id FROM email_participants ep
          WHERE ep.customer_id = ${filters.customerId}
        )`
      );
    }

    const result = await this.db
      .select({
        weekStart: sql<string>`to_char(date_trunc('week', ${emails.receivedAt}), 'Mon DD, YYYY')`,
        totalEmails: sql<number>`count(*)::int`,
        escalations: sql<number>`count(*) FILTER (WHERE ${emails.signals} @> ARRAY[10]::integer[])::int`,
      })
      .from(emails)
      .where(and(...conditions))
      .groupBy(sql`date_trunc('week', ${emails.receivedAt})`)
      .orderBy(sql`date_trunc('week', ${emails.receivedAt})`);

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
   * Get upsell opportunity count for dashboard with access control
   */
  async getUpsellCountScoped(
    header: RequestHeader,
    filters?: {
      customerId?: string;
      dateFrom?: string;
      dateTo?: string;
    }
  ): Promise<number> {
    const conditions: SQL[] = [
      this.tenantFilter(emails.tenantId, header),
      this.emailAccessSubquery(header),
      signalContains(Signal.UPSELL),
    ];

    // Add customer filter
    if (filters?.customerId) {
      conditions.push(
        sql`${emails.id} IN (
          SELECT ep.email_id FROM email_participants ep
          WHERE ep.customer_id = ${filters.customerId}
        )`
      );
    }

    // Add date filters
    if (filters?.dateFrom) {
      conditions.push(sql`${emails.receivedAt} >= ${filters.dateFrom}::timestamp`);
    }
    if (filters?.dateTo) {
      conditions.push(sql`${emails.receivedAt} <= ${filters.dateTo}::timestamp`);
    }

    const result = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(emails)
      .where(and(...conditions));

    return result[0]?.count ?? 0;
  }
}
