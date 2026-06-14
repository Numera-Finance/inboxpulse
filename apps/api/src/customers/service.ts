import { injectable, inject } from 'tsyringe';
import { asc, desc, sql, ilike, or, and } from 'drizzle-orm';
import { ConflictError, ValidationError, NotFoundError, isAdmin, Signal, withAutoSuffix, type RequestHeader, type SearchRequest, type SearchResponse } from '@crm/shared';
import type { Database, Transaction } from '@crm/database';
import { scopedSearch } from '@crm/database';
import { CustomerRepository } from './repository';
import { ContactRepository } from '../contacts/repository';
import { EmailRepository } from '../emails/repository';
import { TaskRepository } from '../tasks/repository';
import { UserRepository } from '../users/repository';
import { inngest } from '../inngest/instance';
import { logger } from '../utils/logger';
import { customers, customerDomains, CustomerRowStatus } from './schema';
import type { Customer, NewCustomer } from './schema';
import type { Customer as ClientCustomer, CreateCustomerRequest, MergeCustomerResponse } from '@crm/clients';
import type { CustomerImportResult, CustomerExportData } from './import-export';

/**
 * Convert internal Customer (from database) to client-facing Customer
 * Serializes customer_domains table to domains array
 * Uses pre-fetched domains map to avoid N+1 queries
 */
function toClientCustomerWithDomains(
  customer: Customer,
  domains: string[]
): ClientCustomer | undefined {
  if (domains.length === 0) {
    logger.warn({ customerId: customer.id }, 'Customer has no domains');
    return undefined;
  }

  return {
    id: customer.id,
    tenantId: customer.tenantId,
    domains, // Array of domains from customer_domains table
    name: customer.name,
    website: customer.website,
    industry: customer.industry,
    labels: customer.labels || [],
    externalId: customer.externalId,
    metadata: customer.metadata,
    isAutoCreated: customer.isAutoCreated,
    createdAt: customer.createdAt,
    updatedAt: customer.updatedAt,
  } as ClientCustomer;
}

/**
 * Convert internal Customer (from database) to client-facing Customer
 * Serializes customer_domains table to domains array
 * @deprecated Use toClientCustomerWithDomains with batch-fetched domains instead
 */
async function toClientCustomer(
  customer: Customer | undefined,
  repository: CustomerRepository
): Promise<ClientCustomer | undefined> {
  if (!customer) return undefined;

  const domains = await repository.getDomains(customer.id, customer.tenantId);
  return toClientCustomerWithDomains(customer, domains);
}

@injectable()
export class CustomerService {
  private fieldMapping = {
    tenantId: customers.tenantId,
    id: customers.id,
    name: customers.name,
    industry: customers.industry,
    createdAt: customers.createdAt,
    updatedAt: customers.updatedAt,
  };

  /**
   * Computed sort field builders — each returns a subquery that produces
   * (customer_id, sort_val) rows. Used via LEFT JOIN for O(1) sort computation.
   */
  private computedSortBuilders: Record<string, (tenantId: string, dateFrom?: string, dateTo?: string) => ReturnType<typeof sql>> = {
    emailCount: (tenantId, dateFrom, dateTo) => sql`
      SELECT ep.customer_id, COUNT(DISTINCT e.id)::int AS sort_val
      FROM email_participants ep
      INNER JOIN emails e ON e.id = ep.email_id
      WHERE e.tenant_id = ${tenantId}
        ${dateFrom ? sql`AND e.received_at >= ${dateFrom}::timestamp` : sql``}
        ${dateTo ? sql`AND e.received_at <= ${dateTo}::timestamp` : sql``}
      GROUP BY ep.customer_id
    `,
    negativeCount: (tenantId, dateFrom, dateTo) => sql`
      SELECT ep.customer_id, COUNT(DISTINCT e.id)::int AS sort_val
      FROM email_participants ep
      INNER JOIN emails e ON e.id = ep.email_id
      WHERE e.tenant_id = ${tenantId}
        AND e.signals @> ARRAY[${Signal.SENTIMENT_NEGATIVE}]::integer[]
        ${dateFrom ? sql`AND e.received_at >= ${dateFrom}::timestamp` : sql``}
        ${dateTo ? sql`AND e.received_at <= ${dateTo}::timestamp` : sql``}
      GROUP BY ep.customer_id
    `,
    upsellCount: (tenantId, dateFrom, dateTo) => sql`
      SELECT ep.customer_id, COUNT(DISTINCT e.id)::int AS sort_val
      FROM email_participants ep
      INNER JOIN emails e ON e.id = ep.email_id
      WHERE e.tenant_id = ${tenantId}
        AND e.signals @> ARRAY[${Signal.UPSELL}]::integer[]
        ${dateFrom ? sql`AND e.received_at >= ${dateFrom}::timestamp` : sql``}
        ${dateTo ? sql`AND e.received_at <= ${dateTo}::timestamp` : sql``}
      GROUP BY ep.customer_id
    `,
    churnCount: (tenantId, dateFrom, dateTo) => sql`
      SELECT ep.customer_id, COUNT(DISTINCT e.id)::int AS sort_val
      FROM email_participants ep
      INNER JOIN emails e ON e.id = ep.email_id
      WHERE e.tenant_id = ${tenantId}
        AND e.signals && ARRAY[${Signal.CHURN_LOW}, ${Signal.CHURN_MEDIUM}, ${Signal.CHURN_HIGH}, ${Signal.CHURN_CRITICAL}]::integer[]
        ${dateFrom ? sql`AND e.received_at >= ${dateFrom}::timestamp` : sql``}
        ${dateTo ? sql`AND e.received_at <= ${dateTo}::timestamp` : sql``}
      GROUP BY ep.customer_id
    `,
    positiveCount: (tenantId, dateFrom, dateTo) => sql`
      SELECT ep.customer_id, COUNT(DISTINCT e.id)::int AS sort_val
      FROM email_participants ep
      INNER JOIN emails e ON e.id = ep.email_id
      WHERE e.tenant_id = ${tenantId}
        AND e.signals @> ARRAY[${Signal.SENTIMENT_POSITIVE}]::integer[]
        ${dateFrom ? sql`AND e.received_at >= ${dateFrom}::timestamp` : sql``}
        ${dateTo ? sql`AND e.received_at <= ${dateTo}::timestamp` : sql``}
      GROUP BY ep.customer_id
    `,
    lastContactDate: (tenantId, dateFrom, dateTo) => sql`
      SELECT ep.customer_id, MAX(e.received_at) AS sort_val
      FROM email_participants ep
      INNER JOIN emails e ON e.id = ep.email_id
      WHERE e.tenant_id = ${tenantId}
        ${dateFrom ? sql`AND e.received_at >= ${dateFrom}::timestamp` : sql``}
        ${dateTo ? sql`AND e.received_at <= ${dateTo}::timestamp` : sql``}
      GROUP BY ep.customer_id
    `,
  };

  constructor(
    @inject(CustomerRepository) private customerRepository: CustomerRepository,
    @inject(ContactRepository) private contactRepository: ContactRepository,
    @inject(EmailRepository) private emailRepository: EmailRepository,
    @inject(TaskRepository) private taskRepository: TaskRepository,
    @inject(UserRepository) private userRepository: UserRepository,
    @inject('Database') private db: Database
  ) {}

  /**
   * Convert multiple internal customers to client-facing customers
   * Uses batch domain fetching to avoid N+1 queries
   */
  private async toClientCustomers(customerList: Customer[]): Promise<ClientCustomer[]> {
    if (customerList.length === 0) {
      return [];
    }

    // Batch fetch all domains for all customers in a single query
    const customerIds = customerList.map(c => c.id);
    const tenantId = customerList[0].tenantId;
    const domainsMap = await this.customerRepository.getDomainsBatch(customerIds, tenantId);

    // Convert each customer using pre-fetched domains
    const clientCustomers: ClientCustomer[] = [];
    for (const customer of customerList) {
      const domains = domainsMap.get(customer.id) || [];
      const clientCustomer = toClientCustomerWithDomains(customer, domains);
      if (clientCustomer) {
        clientCustomers.push(clientCustomer);
      }
    }

    return clientCustomers;
  }

  /**
   * Search customers with pagination
   * Supports optional 'include' parameter for additional data:
   * - 'emailCount': Include email count per customer
   * - 'contactCount': Include contact count per customer (future)
   */
  async search(
    requestHeader: RequestHeader,
    searchRequest: SearchRequest
  ): Promise<SearchResponse<ClientCustomer>> {
    const context = {
      tenantId: requestHeader.tenantId,
      userId: requestHeader.userId,
    };

    // Extract '_search' queries for freeform search
    const searchQueries = searchRequest.queries.filter(q => q.field === '_search');
    const otherQueries = searchRequest.queries.filter(q => q.field !== '_search');

    // Build scoped search query with tenant isolation
    const scopedWhere = scopedSearch(this.db, customers, this.fieldMapping, context)
      .applyQueries(otherQueries)
      .build();

    // Build conditions including freeform search and customer access control
    const conditions = [
      scopedWhere,
      sql`${customers.rowStatus} = ${CustomerRowStatus.ACTIVE}`, // Exclude archived (merged) customers
    ];

    // Add customer access filter (admins see all, others only see assigned customers)
    if (!isAdmin(requestHeader.permissions)) {
      conditions.push(
        sql`${customers.id} IN (
          SELECT uac.customer_id
          FROM user_accessible_customers uac
          WHERE uac.user_id = ${requestHeader.userId}
        )`
      );
    }
    for (const query of searchQueries) {
      if (typeof query.value === 'string') {
        const freeformCondition = this.customerRepository.buildFreeformSearch(query.value);
        if (freeformCondition) {
          conditions.push(freeformCondition);
        }
      }
    }

    const where = and(...conditions);

    // Pagination
    const limit = searchRequest.limit || 20;
    const offset = searchRequest.offset || 0;
    const sortOrder = searchRequest.sortOrder || 'asc';

    // Determine sort: direct column or computed (requires LEFT JOIN subquery)
    const sortBy = searchRequest.sortBy || 'name';
    const directColumn = this.fieldMapping[sortBy as keyof typeof this.fieldMapping];
    const isComputedSort = !directColumn && sortBy in this.computedSortBuilders;

    if (isComputedSort) {
      // Computed sort: use raw SQL with LEFT JOIN subquery (runs once, not per-row)
      const dateFrom = searchRequest.dateFrom;
      const dateTo = searchRequest.dateTo;
      const sortSubquery = this.computedSortBuilders[sortBy](requestHeader.tenantId, dateFrom, dateTo);
      const sortDir = sortOrder === 'asc' ? sql`ASC` : sql`DESC`;

      // Build WHERE clause as raw SQL for the raw query
      const accessFilter = isAdmin(requestHeader.permissions)
        ? sql``
        : sql`AND c.id IN (SELECT uac.customer_id FROM user_accessible_customers uac WHERE uac.user_id = ${requestHeader.userId})`;

      // Freeform search filter
      let searchFilter = sql``;
      if (searchQueries.length > 0) {
        const searchConditions = searchQueries.map(query => {
          const term = `%${query.value}%`;
          return sql`(c.name ILIKE ${term} OR c.id IN (
            SELECT cd.customer_id FROM customer_domains cd
            WHERE cd.tenant_id = ${requestHeader.tenantId} AND cd.domain ILIKE ${term}
          ))`;
        });
        searchFilter = sql`AND (${sql.join(searchConditions, sql` AND `)})`;
      }

      const rawItems = await this.db.execute<Customer>(sql`
        SELECT c.*
        FROM customers c
        LEFT JOIN (${sortSubquery}) sort_sub ON sort_sub.customer_id = c.id
        WHERE c.tenant_id = ${requestHeader.tenantId}
          AND c.row_status = ${CustomerRowStatus.ACTIVE}
          ${accessFilter}
          ${searchFilter}
        ORDER BY COALESCE(sort_sub.sort_val, ${sortBy === 'lastContactDate' ? sql`'1970-01-01'::timestamp` : sql`0`}) ${sortDir}, c.name ASC
        LIMIT ${limit} OFFSET ${offset}
      `);

      const rawCount = await this.db.execute<{ count: number }>(sql`
        SELECT count(*)::int AS count
        FROM customers c
        WHERE c.tenant_id = ${requestHeader.tenantId}
          AND c.row_status = ${CustomerRowStatus.ACTIVE}
          ${accessFilter}
          ${searchFilter}
      `);

      const items = rawItems as unknown as Customer[];
      const total = (rawCount as unknown as Array<{ count: number }>)[0]?.count ?? 0;

      // Convert to client customers (with domains)
      let clientCustomers = await this.toClientCustomers(items);

      // Handle include parameter for additional data
      const includes = searchRequest.include || [];
      const dateFilters = (searchRequest.dateFrom || searchRequest.dateTo)
        ? { dateFrom: searchRequest.dateFrom, dateTo: searchRequest.dateTo }
        : undefined;

      if (clientCustomers.length > 0) {
        clientCustomers = await this.enrichCustomers(requestHeader, clientCustomers, includes, dateFilters);
      }

      return { items: clientCustomers, total, limit, offset };
    }

    // Direct column sort: use Drizzle query builder
    const orderByClause = sortOrder === 'asc'
      ? asc(directColumn || customers.name)
      : desc(directColumn || customers.name);

    // Execute search with sorting and pagination
    const items = await this.db
      .select()
      .from(customers)
      .where(where)
      .orderBy(orderByClause, asc(customers.name))
      .limit(limit)
      .offset(offset);

    // Get total count
    const countResult = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(customers)
      .where(where);

    const total = Number(countResult[0]?.count ?? 0);

    // Convert to client customers (with domains)
    let clientCustomers = await this.toClientCustomers(items);

    // Handle include parameter for additional data
    const includes = searchRequest.include || [];

    // Extract date filters for email metric queries
    const dateFilters = (searchRequest.dateFrom || searchRequest.dateTo)
      ? { dateFrom: searchRequest.dateFrom, dateTo: searchRequest.dateTo }
      : undefined;

    if (clientCustomers.length > 0) {
      clientCustomers = await this.enrichCustomers(requestHeader, clientCustomers, includes, dateFilters);
    }

    return {
      items: clientCustomers,
      total,
      limit,
      offset,
    };
  }

  /**
   * Enrich client customers with computed fields (email counts, sentiment, etc.)
   * Shared by both direct-sort and computed-sort code paths.
   */
  private async enrichCustomers(
    requestHeader: RequestHeader,
    clientCustomers: ClientCustomer[],
    includes: string[],
    dateFilters?: { dateFrom?: string; dateTo?: string }
  ): Promise<ClientCustomer[]> {
    const customerIds = clientCustomers.map(c => c.id);

    if (includes.includes('emailCount')) {
      const emailCounts = await this.emailRepository.getCountsByCustomerIdsScoped(requestHeader, customerIds, dateFilters);
      clientCustomers = clientCustomers.map(c => ({ ...c, emailCount: emailCounts[c.id] || 0 }));
    }

    if (includes.includes('lastContactDate')) {
      const lastContactDates = await this.emailRepository.getLastContactDatesByCustomerIdsScoped(requestHeader, customerIds, dateFilters);
      clientCustomers = clientCustomers.map(c => ({ ...c, lastContactDate: lastContactDates[c.id] }));
    }

    if (includes.includes('sentiment')) {
      const sentiments = await this.emailRepository.getAggregateSentimentByCustomerIdsScoped(requestHeader, customerIds, dateFilters);
      clientCustomers = clientCustomers.map(c => ({ ...c, sentiment: sentiments[c.id] }));
    }

    if (includes.includes('escalationCount')) {
      const escalationCounts = await this.emailRepository.getEscalationCountsByCustomerIdsScoped(requestHeader, customerIds, dateFilters);
      clientCustomers = clientCustomers.map(c => ({ ...c, escalationCount: escalationCounts[c.id] || 0 }));
    }

    if (includes.includes('upsellCount')) {
      const upsellCounts = await this.emailRepository.getUpsellCountsByCustomerIdsScoped(requestHeader, customerIds, dateFilters);
      clientCustomers = clientCustomers.map(c => ({ ...c, upsellCount: upsellCounts[c.id] || 0 }));
    }

    if (includes.includes('churnCount')) {
      const churnCounts = await this.emailRepository.getChurnCountsByCustomerIdsScoped(requestHeader, customerIds, dateFilters);
      clientCustomers = clientCustomers.map(c => ({ ...c, churnCount: churnCounts[c.id] || 0 }));
    }

    if (includes.includes('positiveCount')) {
      const positiveCounts = await this.emailRepository.getPositiveCountsByCustomerIdsScoped(requestHeader, customerIds, dateFilters);
      clientCustomers = clientCustomers.map(c => ({ ...c, positiveCount: positiveCounts[c.id] || 0 }));
    }

    if (includes.includes('averageTat')) {
      const averageTats = await this.emailRepository.getAverageTatByCustomerIdsScoped(requestHeader, customerIds, dateFilters);
      clientCustomers = clientCustomers.map(c => ({ ...c, averageTat: averageTats[c.id] ?? null }));
    }

    return clientCustomers;
  }

  // ===========================================================================
  // Customer Merge
  // ===========================================================================

  /**
   * Merge source customer into target customer.
   * All related data moves to target, source is archived.
   */
  /**
   * Merge source customer into target customer.
   * All related data moves to target in a single transaction, source is archived.
   *
   *   BEGIN
   *     SELECT FOR UPDATE on source + target (lock + validate)
   *     1. customer_domains → target
   *     2. contacts → target
   *     3. email_participants → target
   *     4. tasks → target
   *     5. user_customers → target
   *     6. archive source (row_status = ARCHIVED)
   *   COMMIT
   *   Inngest: user/access.rebuild
   */
  async mergeCustomer(
    requestHeader: RequestHeader,
    sourceId: string,
    targetId: string
  ): Promise<MergeCustomerResponse> {
    const tenantId = requestHeader.tenantId;

    if (sourceId === targetId) {
      throw new ValidationError('Cannot merge a customer into itself');
    }

    // Pre-validate access (also validated inside transaction with FOR UPDATE)
    const source = await this.customerRepository.findByIdScoped(requestHeader, sourceId);
    if (!source) {
      throw new NotFoundError('Source customer', sourceId);
    }
    const target = await this.customerRepository.findByIdScoped(requestHeader, targetId);
    if (!target) {
      throw new NotFoundError('Target customer', targetId);
    }
    if (source.rowStatus === CustomerRowStatus.ARCHIVED) {
      throw new ValidationError('Source customer is already archived');
    }
    if (target.rowStatus === CustomerRowStatus.ARCHIVED) {
      throw new ValidationError('Cannot merge into an archived customer');
    }

    // Execute merge in a single transaction
    const result = await this.db.transaction(async (tx) => {
      // Lock both rows to prevent concurrent merges
      const lockedRows = await this.customerRepository.lockForMerge(tenantId, sourceId, targetId, tx);
      const sourceRow = lockedRows.find(r => r.id === sourceId);
      const targetRow = lockedRows.find(r => r.id === targetId);

      if (!sourceRow || !targetRow) {
        throw new Error('Source or target customer not found');
      }
      if (sourceRow.row_status === CustomerRowStatus.ARCHIVED) {
        throw new Error('Source customer is already archived');
      }
      if (targetRow.row_status === CustomerRowStatus.ARCHIVED) {
        throw new Error('Target customer is already archived');
      }

      // Each repository handles its own table
      const movedDomains = await this.customerRepository.reassignDomains(tenantId, sourceId, targetId, tx);
      // Safe: unique constraint is (tenant_id, email), not (tenant_id, customer_id, email)
      const movedContacts = await this.contactRepository.reassignCustomer(tenantId, sourceId, targetId, tx);
      const movedEmailParticipants = await this.emailRepository.reassignParticipantCustomer(tenantId, sourceId, targetId, tx);
      const movedTasks = await this.taskRepository.reassignCustomer(tenantId, sourceId, targetId, tx);
      const movedUserAssignments = await this.userRepository.reassignCustomer(tenantId, sourceId, targetId, tx);

      await this.customerRepository.archive(tenantId, sourceId, tx);

      return {
        targetCustomerId: targetId,
        sourceCustomerId: sourceId,
        movedDomains,
        movedContacts,
        movedTasks,
        movedEmailParticipants,
        movedUserAssignments,
      };
    });

    logger.info(
      { tenantId, sourceId, targetId, ...result },
      'Customer merge completed'
    );

    // Trigger async rebuild of user accessible customers
    await inngest.send({
      name: 'user/access.rebuild',
      data: { tenantId },
    });

    return result;
  }

  // ===========================================================================
  // Access-Controlled Methods
  // ===========================================================================

  /**
   * Get customer by domain with access control
   * Returns undefined if user doesn't have access
   */
  async getCustomerByDomainScoped(requestHeader: RequestHeader, domain: string): Promise<ClientCustomer | undefined> {
    try {
      logger.info({ domain, tenantId: requestHeader.tenantId }, 'Fetching customer by domain (scoped)');
      const customer = await this.customerRepository.findByDomainScoped(requestHeader, domain);
      const clientCustomer = await toClientCustomer(customer, this.customerRepository);
      if (!clientCustomer) return undefined;
      return await this.enrichWithEmailStats(requestHeader, clientCustomer);
    } catch (error: any) {
      logger.error({ error, domain, tenantId: requestHeader.tenantId }, 'Failed to fetch customer by domain');
      throw error;
    }
  }

  /**
   * Enrich a single customer with the email stats the sidebar/detail view shows
   * (counts, escalations, TAT, last contact). Runs the aggregates in parallel.
   * Shared by getCustomerByDomainScoped and getEnrichedCustomerByIdScoped.
   */
  private async enrichWithEmailStats(
    requestHeader: RequestHeader,
    clientCustomer: ClientCustomer
  ): Promise<ClientCustomer> {
    const ids = [clientCustomer.id];
    const [emailCounts, escalationCounts, upsellCounts, churnCounts, positiveCounts, averageTats, lastContactDates] = await Promise.all([
      this.emailRepository.getCountsByCustomerIdsScoped(requestHeader, ids),
      this.emailRepository.getEscalationCountsByCustomerIdsScoped(requestHeader, ids),
      this.emailRepository.getUpsellCountsByCustomerIdsScoped(requestHeader, ids),
      this.emailRepository.getChurnCountsByCustomerIdsScoped(requestHeader, ids),
      this.emailRepository.getPositiveCountsByCustomerIdsScoped(requestHeader, ids),
      this.emailRepository.getAverageTatByCustomerIdsScoped(requestHeader, ids),
      this.emailRepository.getLastContactDatesByCustomerIdsScoped(requestHeader, ids),
    ]);

    return {
      ...clientCustomer,
      emailCount: emailCounts[clientCustomer.id] || 0,
      escalationCount: escalationCounts[clientCustomer.id] || 0,
      upsellCount: upsellCounts[clientCustomer.id] || 0,
      churnCount: churnCounts[clientCustomer.id] || 0,
      positiveCount: positiveCounts[clientCustomer.id] || 0,
      averageTat: averageTats[clientCustomer.id] ?? null,
      lastContactDate: lastContactDates[clientCustomer.id],
    };
  }

  /**
   * Get customer by ID with access control
   * Returns undefined if user doesn't have access
   */
  async getCustomerByIdScoped(requestHeader: RequestHeader, id: string): Promise<ClientCustomer | undefined> {
    try {
      logger.info({ id, tenantId: requestHeader.tenantId }, 'Fetching customer by id (scoped)');
      const customer = await this.customerRepository.findByIdScoped(requestHeader, id);
      return await toClientCustomer(customer, this.customerRepository);
    } catch (error: any) {
      logger.error({ error, id, tenantId: requestHeader.tenantId }, 'Failed to fetch customer by id');
      throw error;
    }
  }

  /**
   * Like getCustomerByIdScoped but enriched with email stats (counts, escalations,
   * TAT, etc.) for sidebar/detail display. Kept separate so the cheaper base
   * lookup can be used by write paths (e.g. existence checks before update).
   */
  async getEnrichedCustomerByIdScoped(requestHeader: RequestHeader, id: string): Promise<ClientCustomer | undefined> {
    const clientCustomer = await this.getCustomerByIdScoped(requestHeader, id);
    if (!clientCustomer) return undefined;
    return await this.enrichWithEmailStats(requestHeader, clientCustomer);
  }

  /**
   * Get customers by tenant with access control
   * Only returns customers the user has access to
   */
  async getCustomersByTenantScoped(requestHeader: RequestHeader): Promise<ClientCustomer[]> {
    try {
      logger.info({ tenantId: requestHeader.tenantId }, 'Fetching customers by tenant (scoped)');
      const customerList = await this.customerRepository.findByTenantIdScoped(requestHeader);
      return await this.toClientCustomers(customerList);
    } catch (error: any) {
      logger.error({ error, tenantId: requestHeader.tenantId }, 'Failed to fetch customers by tenant');
      throw error;
    }
  }

  // ===========================================================================
  // Legacy Methods (no access control - for internal/system use)
  // ===========================================================================

  /**
   * @deprecated Use getCustomerByDomainScoped for user-facing queries
   */
  async getCustomerByDomain(tenantId: string, domain: string): Promise<ClientCustomer | undefined> {
    try {
      logger.info({ domain, tenantId }, 'Fetching customer by domain');
      const customer = await this.customerRepository.findByDomain(tenantId, domain);
      return await toClientCustomer(customer, this.customerRepository);
    } catch (error: any) {
      logger.error({ error, domain, tenantId }, 'Failed to fetch customer by domain');
      throw error;
    }
  }

  /**
   * @deprecated Use getCustomerByIdScoped for user-facing queries
   */
  async getCustomerById(id: string): Promise<ClientCustomer | undefined> {
    try {
      logger.info({ id }, 'Fetching customer by id');
      const customer = await this.customerRepository.findById(id);
      return await toClientCustomer(customer, this.customerRepository);
    } catch (error: any) {
      logger.error({ error, id }, 'Failed to fetch customer by id');
      throw error;
    }
  }

  /**
   * @deprecated Use getCustomersByTenantScoped for user-facing queries
   */
  async getCustomersByTenant(tenantId: string): Promise<ClientCustomer[]> {
    try {
      logger.info({ tenantId }, 'Fetching customers by tenant');
      const customerList = await this.customerRepository.findByTenantId(tenantId);
      return await this.toClientCustomers(customerList);
    } catch (error: any) {
      logger.error({ error, tenantId }, 'Failed to fetch customers by tenant');
      throw error;
    }
  }

  async createCustomer(tenantId: string, data: CreateCustomerRequest): Promise<ClientCustomer> {
    try {
      logger.info({ domains: data.domains, tenantId }, 'Creating customer');

      // Validate that all domains don't already exist for this tenant
      for (const domain of data.domains) {
        const normalizedDomain = domain.toLowerCase();
        const existingCustomer = await this.customerRepository.findByDomain(tenantId, normalizedDomain);
        if (existingCustomer) {
          throw new ConflictError(
            `Domain "${domain}" is already associated with another customer`,
            { domain, tenantId }
          );
        }
      }

      // Use first domain for create logic
      const customer = await this.customerRepository.create({ ...data, tenantId, domain: data.domains[0] });

      // Add remaining domains
      for (let i = 1; i < data.domains.length; i++) {
        await this.customerRepository.addDomain(customer.id, customer.tenantId, data.domains[i]);
      }

      const clientCustomer = await toClientCustomer(customer, this.customerRepository);
      if (!clientCustomer) {
        throw new Error('Failed to convert customer to client format after creation');
      }
      return clientCustomer;
    } catch (error: any) {
      logger.error({ error, domains: data.domains, tenantId }, 'Failed to create customer');
      throw error;
    }
  }

  async upsertCustomer(tenantId: string, data: CreateCustomerRequest): Promise<ClientCustomer> {
    try {
      logger.info({ domains: data.domains, tenantId }, 'Upserting customer');

      // Step 1: Find which customer we're upserting (based on first domain)
      const firstDomainNormalized = data.domains[0].toLowerCase();
      const existingCustomerForFirstDomain = await this.customerRepository.findByDomain(
        tenantId,
        firstDomainNormalized
      );
      const targetCustomerId = existingCustomerForFirstDomain?.id;

      // Step 2: Validate ALL remaining domains don't belong to OTHER customers
      // (It's OK if they belong to the same customer we're updating)
      for (let i = 1; i < data.domains.length; i++) {
        const normalizedDomain = data.domains[i].toLowerCase();
        const existingCustomer = await this.customerRepository.findByDomain(tenantId, normalizedDomain);

        if (existingCustomer) {
          // If we're updating an existing customer, check if domain belongs to a different customer
          if (targetCustomerId && existingCustomer.id !== targetCustomerId) {
            throw new ConflictError(
              `Domain "${data.domains[i]}" is already associated with another customer`,
              { domain: data.domains[i], tenantId, existingCustomerId: existingCustomer.id }
            );
          }
          // If we're creating a new customer, any existing domain is a conflict
          if (!targetCustomerId) {
            throw new ConflictError(
              `Domain "${data.domains[i]}" is already associated with another customer`,
              { domain: data.domains[i], tenantId, existingCustomerId: existingCustomer.id }
            );
          }
        }
      }

      // Step 3: Never rewrite the name of an existing customer through upsert.
      // Name is set once at creation (including the pipeline's "(Auto)" suffix) and only
      // ever changes afterwards through the explicit updateCustomer (PATCH) endpoint.
      let normalizedData: CreateCustomerRequest = data;
      if (targetCustomerId) {
        const { name: _ignored, ...rest } = data;
        normalizedData = rest as CreateCustomerRequest;
      }

      // Step 4: Perform upsert with all domains in a single transaction
      // This ensures atomicity - if anything fails, everything rolls back
      const customerWithDomains = await this.customerRepository.upsertWithDomains({ ...normalizedData, tenantId });

      // The repository now returns the customer with domains array already populated
      if (!customerWithDomains.domains || customerWithDomains.domains.length === 0) {
        throw new Error('Failed to convert customer to client format after upsert - no domains found');
      }

      return {
        id: customerWithDomains.id,
        tenantId: customerWithDomains.tenantId,
        domains: customerWithDomains.domains,
        name: customerWithDomains.name,
        website: customerWithDomains.website,
        industry: customerWithDomains.industry,
        externalId: customerWithDomains.externalId,
        metadata: customerWithDomains.metadata,
        isAutoCreated: customerWithDomains.isAutoCreated,
        createdAt: customerWithDomains.createdAt,
        updatedAt: customerWithDomains.updatedAt,
      } as ClientCustomer;
    } catch (error: any) {
      logger.error({ error, domains: data.domains, tenantId }, 'Failed to upsert customer');
      throw error;
    }
  }

  async updateCustomer(id: string, data: Partial<NewCustomer>): Promise<Customer | undefined> {
    try {
      logger.info({ id }, 'Updating customer');
      return await this.customerRepository.update(id, data);
    } catch (error: any) {
      logger.error({ error, id }, 'Failed to update customer');
      throw error;
    }
  }

  /**
   * Single entry point for customer creation/refinement from the email pipeline.
   *
   * Both the eager domain-extraction step (no signature info) and the
   * post-signature refinement step (with `signatureCompany`) call this.
   * Idempotent.
   *
   * Name precedence (best name wins):
   *   1. options.signatureCompany — extracted from the sender's email signature
   *   2. options.defaultName       — caller's domain-derived inference
   *
   * Behavior:
   *   - No customer for `domain`     → create with suffixed best-name, isAutoCreated=true
   *   - Exists & auto-created & name differs from proposed → update name
   *   - Exists & auto-created & name matches → no-op
   *   - Exists & manually created    → leave alone, just return
   *
   * Race safety: requires a transaction (`tx`) and acquires an advisory
   * transaction lock keyed on (tenantId, domain). Concurrent calls for the
   * same domain serialize on the lock, so no two concurrent transactions can
   * both insert and conflict on the unique constraint.
   *
   * The "(Auto)" suffix is always applied via `withAutoSuffix` — never built inline.
   */
  async ensureCustomerForEmail(
    tx: Transaction,
    tenantId: string,
    domain: string,
    options: { signatureCompany?: string | null; defaultName?: string }
  ): Promise<Customer> {
    const normalizedDomain = domain.toLowerCase();
    const proposedRaw = options.signatureCompany?.trim() || options.defaultName?.trim() || '';
    if (!proposedRaw) {
      throw new ValidationError('ensureCustomerForEmail requires at least one of defaultName or signatureCompany');
    }
    const proposedName = withAutoSuffix(proposedRaw);

    // Serialize concurrent calls for the same (tenant, domain) within their
    // transactions. The lock auto-releases at end of transaction.
    const lockKey = `customer:${tenantId}:${normalizedDomain}`;
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`);

    const existing = await this.customerRepository.findByDomain(tenantId, normalizedDomain, tx);

    if (existing) {
      if (
        existing.isAutoCreated &&
        (existing.name ?? '').trim().toLowerCase() !== proposedName.toLowerCase()
      ) {
        const updated = await this.customerRepository.update(
          existing.id,
          { name: proposedName },
          tx
        );
        logger.info(
          {
            tenantId,
            customerId: existing.id,
            domain: normalizedDomain,
            previousName: existing.name,
            newName: proposedName,
            source: options.signatureCompany ? 'signature' : 'domain',
            logType: 'CUSTOMER_NAME_REFINED',
          },
          'Auto-created customer name updated'
        );
        return updated ?? existing;
      }
      return existing;
    }

    const created = await this.customerRepository.create(
      {
        tenantId,
        name: proposedName,
        isAutoCreated: true,
        domain: normalizedDomain,
      } as NewCustomer & { domain: string },
      tx
    );
    logger.info(
      {
        tenantId,
        customerId: created.id,
        domain: normalizedDomain,
        name: proposedName,
        source: options.signatureCompany ? 'signature' : 'domain',
        logType: 'CUSTOMER_AUTO_CREATED',
      },
      'Auto-created customer from email'
    );
    return created;
  }

  async replaceDomains(customerId: string, tenantId: string, domains: string[]): Promise<void> {
    return this.customerRepository.replaceDomains(customerId, tenantId, domains);
  }

  // ===========================================================================
  // Internal Methods (for email mapping - no ClientCustomer conversion)
  // ===========================================================================

  /**
   * Find customer by domain (internal use)
   * Returns raw Customer entity or undefined
   */
  async findByDomain(
    tenantId: string,
    domain: string,
    tx?: Transaction
  ): Promise<Customer | undefined> {
    return this.customerRepository.findByDomain(tenantId, domain, tx);
  }

  /**
   * Create customer from a single domain (internal use)
   * Used during email analysis to auto-create customers
   * Returns raw Customer entity
   */
  async createFromDomain(tenantId: string, name: string, domain: string): Promise<Customer> {
    const normalizedDomain = domain.toLowerCase();

    // Create customer with domain (repository handles both in a transaction)
    const customer = await this.customerRepository.create({
      tenantId,
      name,
      domain: normalizedDomain,
    });

    logger.info(
      {
        tenantId,
        customerId: customer.id,
        domain: normalizedDomain,
        name,
        logType: 'CUSTOMER_CREATED_FROM_DOMAIN',
      },
      'Created customer from domain'
    );

    return customer;
  }

  // ===========================================================================
  // Import/Export
  // ===========================================================================

  /**
   * Import customers and team assignments from Excel file
   *
   * - Finds existing customers by externalId or creates new ones
   * - Updates all fields (name, website, domains)
   * - Replaces all team assignments
   * - Returns errors for unknown user emails
   */
  async importCustomers(tenantId: string, fileBuffer: Buffer): Promise<CustomerImportResult> {
    const { parseCustomerImport } = await import('./import-export');
    const importRows = parseCustomerImport(fileBuffer);

    const result: CustomerImportResult = {
      imported: 0,
      updated: 0,
      errors: [],
      warnings: [],
    };

    // First pass: validate all user emails exist
    const allEmails = new Set<string>();
    for (const row of importRows) {
      for (const assignment of row.teamAssignments) {
        allEmails.add(assignment.email);
      }
    }

    // Look up all users by email
    const usersByEmail = await this.userRepository.findByEmails(tenantId, Array.from(allEmails));

    // Process each row
    for (const row of importRows) {
      try {
        // Validate: need at least externalId or a domain to match on
        if (!row.externalId && row.domains.length === 0) {
          result.errors.push({
            row: row.rowNumber,
            externalId: '',
            error: 'Either Client ID or at least one domain is required',
          });
          continue;
        }

        // Validate team assignment emails and deduplicate by userId
        // If same user appears multiple times (different roles), keep the last one
        const assignmentsByUserId = new Map<string, { userId: string; roleId: string }>();
        for (const assignment of row.teamAssignments) {
          const user = usersByEmail.get(assignment.email);
          if (user) {
            assignmentsByUserId.set(user.id, {
              userId: user.id,
              roleId: assignment.roleId,
            });
          } else {
            result.warnings.push({
              row: row.rowNumber,
              externalId: row.externalId,
              warning: `User not found: ${assignment.email} (${assignment.columnName})`,
            });
          }
        }
        const validAssignments = Array.from(assignmentsByUserId.values());

        // Match customer: try externalId first, then fall back to domain
        let existing: Customer | undefined;
        let matchedBy: 'externalId' | 'domain' | null = null;

        if (row.externalId) {
          existing = await this.customerRepository.findByExternalId(tenantId, row.externalId);
          if (existing) matchedBy = 'externalId';
        }

        if (!existing && row.domains.length > 0) {
          for (const domain of row.domains) {
            existing = await this.customerRepository.findByDomain(tenantId, domain);
            if (existing) {
              matchedBy = 'domain';
              break;
            }
          }
        }

        // Check for domain conflicts (domain belongs to a different customer than the one we matched)
        for (const domain of row.domains) {
          const domainOwner = await this.customerRepository.findByDomain(tenantId, domain);
          if (domainOwner && (!existing || domainOwner.id !== existing.id)) {
            result.errors.push({
              row: row.rowNumber,
              externalId: row.externalId,
              error: `Domain "${domain}" is already assigned to another customer`,
            });
            continue;
          }
        }
        // Skip if any domain conflict was found
        if (result.errors.some(e => e.row === row.rowNumber)) {
          continue;
        }

        // Upsert customer
        const customer = await this.customerRepository.upsertCustomer({
          tenantId,
          existingCustomerId: existing?.id,
          externalId: row.externalId || undefined,
          name: row.name || undefined,
          website: row.website || undefined,
          domains: row.domains,
        });

        // Replace team assignments
        await this.userRepository.setTeamAssignmentsForCustomer(customer.id, validAssignments);

        if (existing) {
          result.updated++;
        } else {
          result.imported++;
        }

        logger.info(
          { tenantId, customerId: customer.id, externalId: row.externalId, matchedBy, teamCount: validAssignments.length },
          'Imported customer'
        );
      } catch (error: any) {
        logger.error({ error, row: row.rowNumber, externalId: row.externalId }, 'Failed to import customer row');
        result.errors.push({
          row: row.rowNumber,
          externalId: row.externalId,
          error: error.message || 'Unknown error',
        });
      }
    }

    // Log detailed error summary for debugging
    if (result.errors.length > 0) {
      // Group errors by type for better logging
      const errorsByType: Record<string, number> = {};
      for (const err of result.errors) {
        const errorType = err.error.includes('Client ID') ? 'missing_client_id' :
                         err.error.includes('domain') ? 'missing_domain' :
                         err.error.includes('not found') ? 'user_not_found' : 'other';
        errorsByType[errorType] = (errorsByType[errorType] || 0) + 1;
      }

      logger.warn(
        {
          tenantId,
          totalErrors: result.errors.length,
          errorsByType,
          sampleErrors: result.errors.slice(0, 5).map(e => ({ row: e.row, error: e.error })),
        },
        'Customer import completed with errors'
      );
    }

    // Queue access rebuild if any customers were imported/updated
    if (result.imported > 0 || result.updated > 0) {
      await this.queueAccessRebuild(tenantId);
    }

    logger.info(
      { tenantId, imported: result.imported, updated: result.updated, errors: result.errors.length, warnings: result.warnings.length },
      'Completed customer import'
    );

    return result;
  }

  /**
   * Export all customers and their team assignments to Excel format
   */
  async exportCustomers(tenantId: string): Promise<Buffer> {
    const { generateCustomerExport } = await import('./import-export');

    // Get all customers with domains
    const customersWithDomains = await this.customerRepository.findAllWithDomains(tenantId);

    // Build export data with team assignments
    const exportData: CustomerExportData[] = [];

    for (const customer of customersWithDomains) {
      // Get team assignments
      const teamAssignments = await this.userRepository.getTeamAssignmentsForCustomer(customer.id);

      exportData.push({
        externalId: customer.externalId,
        name: customer.name,
        domains: customer.domains,
        website: customer.website,
        teamAssignments,
      });
    }

    logger.info({ tenantId, customerCount: exportData.length }, 'Exporting customers');

    return generateCustomerExport(exportData);
  }

  /**
   * Generate template Excel file for customer import
   */
  async getImportTemplate(): Promise<Buffer> {
    const { generateCustomerTemplate } = await import('./import-export');
    return generateCustomerTemplate();
  }

  /**
   * Queue access rebuild after import changes
   */
  private async queueAccessRebuild(tenantId: string): Promise<void> {
    try {
      await inngest.send({
        name: 'user/access.rebuild',
        data: { tenantId },
      });
      logger.debug({ tenantId }, 'Queued access rebuild');
    } catch (error) {
      logger.warn({ error, tenantId }, 'Failed to queue access rebuild');
    }
  }
}
