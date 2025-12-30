import { injectable, inject } from 'tsyringe';
import { asc, desc, sql, ilike, or, and } from 'drizzle-orm';
import { ConflictError, type RequestHeader, type SearchRequest, type SearchResponse } from '@crm/shared';
import type { Database } from '@crm/database';
import { scopedSearch } from '@crm/database';
import { CustomerRepository } from './repository';
import { EmailRepository } from '../emails/repository';
import { logger } from '../utils/logger';
import { customers, customerDomains } from './schema';
import type { Customer, NewCustomer } from './schema';
import type { Customer as ClientCustomer, CreateCustomerRequest } from '@crm/clients';

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
    metadata: customer.metadata,
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

  const domains = await repository.getDomains(customer.id);
  return toClientCustomerWithDomains(customer, domains);
}

@injectable()
export class CustomerService {
  private fieldMapping = {
    name: customers.name,
    industry: customers.industry,
    createdAt: customers.createdAt,
    updatedAt: customers.updatedAt,
  };

  constructor(
    @inject(CustomerRepository) private customerRepository: CustomerRepository,
    @inject(EmailRepository) private emailRepository: EmailRepository,
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
    const domainsMap = await this.customerRepository.getDomainsBatch(customerIds);

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

    // Build conditions including freeform search
    const conditions = [scopedWhere];
    for (const query of searchQueries) {
      if (typeof query.value === 'string') {
        const freeformCondition = this.customerRepository.buildFreeformSearch(query.value);
        if (freeformCondition) {
          conditions.push(freeformCondition);
        }
      }
    }

    const where = and(...conditions);

    // Determine sort column
    const sortBy = searchRequest.sortBy as keyof typeof this.fieldMapping | undefined;
    const sortColumn = sortBy && this.fieldMapping[sortBy]
      ? this.fieldMapping[sortBy]
      : customers.createdAt;
    const orderByClause = searchRequest.sortOrder === 'asc'
      ? asc(sortColumn)
      : desc(sortColumn);

    // Pagination
    const limit = searchRequest.limit || 20;
    const offset = searchRequest.offset || 0;

    // Execute search with sorting and pagination
    const items = await this.db
      .select()
      .from(customers)
      .where(where)
      .orderBy(orderByClause)
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

    if (clientCustomers.length > 0) {
      const customerIds = clientCustomers.map(c => c.id);

      // Fetch email counts if requested (using scoped method for consistency)
      if (includes.includes('emailCount')) {
        const emailCounts = await this.emailRepository.getCountsByCustomerIdsScoped(
          requestHeader,
          customerIds
        );

        clientCustomers = clientCustomers.map(customer => ({
          ...customer,
          emailCount: emailCounts[customer.id] || 0,
        }));
      }

      // Fetch last contact dates if requested (using scoped method for consistency)
      if (includes.includes('lastContactDate')) {
        const lastContactDates = await this.emailRepository.getLastContactDatesByCustomerIdsScoped(
          requestHeader,
          customerIds
        );

        clientCustomers = clientCustomers.map(customer => ({
          ...customer,
          lastContactDate: lastContactDates[customer.id],
        }));
      }

      // Fetch aggregate sentiment if requested (using scoped method for consistency)
      if (includes.includes('sentiment')) {
        const sentiments = await this.emailRepository.getAggregateSentimentByCustomerIdsScoped(
          requestHeader,
          customerIds
        );

        clientCustomers = clientCustomers.map(customer => ({
          ...customer,
          sentiment: sentiments[customer.id],
        }));
      }

      // Fetch escalation counts if requested (using scoped method for consistency)
      if (includes.includes('escalationCount')) {
        const escalationCounts = await this.emailRepository.getEscalationCountsByCustomerIdsScoped(
          requestHeader,
          customerIds
        );

        clientCustomers = clientCustomers.map(customer => ({
          ...customer,
          escalationCount: escalationCounts[customer.id] || 0,
        }));
      }
    }

    return {
      items: clientCustomers,
      total,
      limit,
      offset,
    };
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
      return await toClientCustomer(customer, this.customerRepository);
    } catch (error: any) {
      logger.error({ error, domain, tenantId: requestHeader.tenantId }, 'Failed to fetch customer by domain');
      throw error;
    }
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

  async createCustomer(data: CreateCustomerRequest): Promise<ClientCustomer> {
    try {
      logger.info({ domains: data.domains, tenantId: data.tenantId }, 'Creating customer');

      // Validate that all domains don't already exist for this tenant
      for (const domain of data.domains) {
        const normalizedDomain = domain.toLowerCase();
        const existingCustomer = await this.customerRepository.findByDomain(data.tenantId, normalizedDomain);
        if (existingCustomer) {
          throw new ConflictError(
            `Domain "${domain}" is already associated with another customer`,
            { domain, tenantId: data.tenantId }
          );
        }
      }

      // Use first domain for create logic
      const customer = await this.customerRepository.create({ ...data, domain: data.domains[0] });

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
      logger.error({ error, domains: data.domains, tenantId: data.tenantId }, 'Failed to create customer');
      throw error;
    }
  }

  async upsertCustomer(data: CreateCustomerRequest): Promise<ClientCustomer> {
    try {
      logger.info({ domains: data.domains, tenantId: data.tenantId }, 'Upserting customer');

      // Step 1: Find which customer we're upserting (based on first domain)
      const firstDomainNormalized = data.domains[0].toLowerCase();
      const existingCustomerForFirstDomain = await this.customerRepository.findByDomain(
        data.tenantId,
        firstDomainNormalized
      );
      const targetCustomerId = existingCustomerForFirstDomain?.id;

      // Step 2: Validate ALL remaining domains don't belong to OTHER customers
      // (It's OK if they belong to the same customer we're updating)
      for (let i = 1; i < data.domains.length; i++) {
        const normalizedDomain = data.domains[i].toLowerCase();
        const existingCustomer = await this.customerRepository.findByDomain(data.tenantId, normalizedDomain);

        if (existingCustomer) {
          // If we're updating an existing customer, check if domain belongs to a different customer
          if (targetCustomerId && existingCustomer.id !== targetCustomerId) {
            throw new ConflictError(
              `Domain "${data.domains[i]}" is already associated with another customer`,
              { domain: data.domains[i], tenantId: data.tenantId, existingCustomerId: existingCustomer.id }
            );
          }
          // If we're creating a new customer, any existing domain is a conflict
          if (!targetCustomerId) {
            throw new ConflictError(
              `Domain "${data.domains[i]}" is already associated with another customer`,
              { domain: data.domains[i], tenantId: data.tenantId, existingCustomerId: existingCustomer.id }
            );
          }
        }
      }

      // Step 3: Perform upsert with all domains in a single transaction
      // This ensures atomicity - if anything fails, everything rolls back
      const customerWithDomains = await this.customerRepository.upsertWithDomains(data);

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
        metadata: customerWithDomains.metadata,
        createdAt: customerWithDomains.createdAt,
        updatedAt: customerWithDomains.updatedAt,
      } as ClientCustomer;
    } catch (error: any) {
      logger.error({ error, domains: data.domains, tenantId: data.tenantId }, 'Failed to upsert customer');
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
}
