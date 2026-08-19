import { eq, and, sql, SQL } from 'drizzle-orm';
import { injectable, inject } from 'tsyringe';
import { ScopedRepository } from '@crm/database';
import type { Database, Transaction } from '@crm/database';
import type { RequestHeader } from '@crm/shared';
import { customers, customerDomains, CustomerRowStatus, type Customer, type NewCustomer, type NewCustomerDomain } from './schema';
import { logger } from '../utils/logger';

@injectable()
export class CustomerRepository extends ScopedRepository {
  constructor(@inject('Database') db: Database) {
    super(db);
  }

  /**
   * Build freeform search condition for customers.
   * Searches across: name, domains (via subquery), and labels (JSONB array).
   */
  override buildFreeformSearch(searchTerm: string): SQL | undefined {
    if (!searchTerm || searchTerm.trim() === '') {
      return undefined;
    }
    const term = `%${searchTerm}%`;
    return sql`(
      ${customers.name} ILIKE ${term} OR
      ${customers.id} IN (
        SELECT ${customerDomains.customerId}
        FROM ${customerDomains}
        WHERE ${customerDomains.domain} ILIKE ${term}
      ) OR
      EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(${customers.labels}) AS lbl
        WHERE lbl ILIKE ${term}
      )
    )`;
  }

  /**
   * Find customer by domain (queries customer_domains table internally).
   * Domain is automatically lowercased. Accepts an optional transaction so
   * the read participates in a wider transaction (used by the email pipeline).
   */
  async findByDomain(
    tenantId: string,
    domain: string,
    tx?: Transaction
  ): Promise<Customer | undefined> {
    const normalizedDomain = domain.toLowerCase();
    const dbHandle = (tx ?? this.db) as Database;

    const result = await dbHandle
      .select({
        id: customers.id,
        tenantId: customers.tenantId,
        name: customers.name,
        website: customers.website,
        industry: customers.industry,
        labels: customers.labels,
        externalId: customers.externalId,
        metadata: customers.metadata,
        isAutoCreated: customers.isAutoCreated,
        rowStatus: customers.rowStatus,
        createdAt: customers.createdAt,
        updatedAt: customers.updatedAt,
      })
      .from(customers)
      .innerJoin(customerDomains, eq(customers.id, customerDomains.customerId))
      .where(
        and(
          eq(customerDomains.tenantId, tenantId),
          eq(customerDomains.domain, normalizedDomain)
        )
      )
      .limit(1);

    return result[0];
  }

  async findById(id: string): Promise<Customer | undefined> {
    const result = await this.db.select().from(customers).where(eq(customers.id, id));
    return result[0];
  }

  async findByTenantId(tenantId: string): Promise<Customer[]> {
    return this.db.select().from(customers).where(eq(customers.tenantId, tenantId));
  }

  /**
   * Create customer and automatically create the corresponding row in
   * customer_domains. Domain is required and stored lowercased.
   *
   * Accepts an optional outer transaction. When provided, the writes happen
   * within the caller's transaction (used by the email pipeline so a customer
   * created here participates in the same atomic email write).
   */
  async create(data: NewCustomer & { domain: string }, tx?: Transaction): Promise<Customer> {
    const normalizedDomain = data.domain.toLowerCase();
    const runner = async (innerTx: Transaction): Promise<Customer> => {
      const { domain, ...customerData } = data;
      const customerResult = await innerTx.insert(customers).values(customerData).returning();
      const customer = customerResult[0];

      await innerTx.insert(customerDomains).values({
        customerId: customer.id,
        tenantId: customer.tenantId,
        domain: normalizedDomain,
        verified: false,
      });

      logger.debug({ customerId: customer.id, domain: normalizedDomain }, 'Created customer with domain');
      return customer;
    };

    if (tx) return runner(tx);
    return await this.db.transaction(runner);
  }

  /**
   * Upsert customer by domain
   * If customer exists for domain, update it; otherwise create new customer
   * Automatically manages customer_domains table
   */
  async upsert(data: NewCustomer & { domain: string }): Promise<Customer> {
    const normalizedDomain = data.domain.toLowerCase();

    return await this.db.transaction(async (tx) => {
      // Check if domain already exists
      const existingDomain = await tx
        .select({ customerId: customerDomains.customerId })
        .from(customerDomains)
        .where(
          and(
            eq(customerDomains.tenantId, data.tenantId),
            eq(customerDomains.domain, normalizedDomain)
          )
        )
        .limit(1);

      if (existingDomain.length > 0) {
        // Update existing customer
        const customerId = existingDomain[0].customerId;
        const { domain, ...customerData } = data;

        const updated = await tx
          .update(customers)
          .set({ ...customerData, updatedAt: new Date() })
          .where(eq(customers.id, customerId))
          .returning();

        logger.debug({ customerId, domain: normalizedDomain }, 'Updated existing customer by domain');
        return updated[0];
      } else {
        // Create new customer with domain
        return await this.create(data);
      }
    });
  }

  async update(
    id: string,
    data: Partial<NewCustomer>,
    tx?: Transaction
  ): Promise<Customer | undefined> {
    const dbHandle = (tx ?? this.db) as Database;
    const result = await dbHandle
      .update(customers)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(customers.id, id))
      .returning();
    return result[0];
  }

  /**
   * Upsert customer with multiple domains in a single transaction
   * Performs upsert and adds all domains atomically
   * Note: Domain validation should be done in service layer before calling this method
   * Returns customer with domains array
   */
  async upsertWithDomains(data: NewCustomer & { domains: string[] }): Promise<Customer & { domains: string[] }> {
    const firstDomain = data.domains[0].toLowerCase();

    return await this.db.transaction(async (tx) => {
      // Step 1: Check if first domain exists to determine if we're updating or creating
      const existingDomain = await tx
        .select({ customerId: customerDomains.customerId })
        .from(customerDomains)
        .where(
          and(
            eq(customerDomains.tenantId, data.tenantId),
            eq(customerDomains.domain, firstDomain)
          )
        )
        .limit(1);

      let customer: Customer;

      if (existingDomain.length > 0) {
        // Update existing customer
        const customerId = existingDomain[0].customerId;
        const { domains, id, createdAt, isAutoCreated, ...customerData } = data;

        const updated = await tx
          .update(customers)
          .set({ ...customerData, updatedAt: new Date() })
          .where(eq(customers.id, customerId))
          .returning();

        if (!updated || updated.length === 0) {
          throw new Error(`Customer with ID ${customerId} not found during update`);
        }

        customer = updated[0];
        logger.debug({ customerId, domain: firstDomain }, 'Updated existing customer by domain');
      } else {
        // Create new customer
        const { domains, ...customerData } = data;
        const customerResult = await tx.insert(customers).values(customerData).returning();
        customer = customerResult[0];

        // Add first domain
        await tx.insert(customerDomains).values({
          customerId: customer.id,
          tenantId: customer.tenantId,
          domain: firstDomain,
          verified: false,
        });

        logger.debug({ customerId: customer.id, domain: firstDomain }, 'Created customer with domain');
      }

      // Step 2: Add remaining domains (skip if already exist for this customer)
      for (let i = 1; i < data.domains.length; i++) {
        const normalizedDomain = data.domains[i].toLowerCase();

        // Check if domain already exists for this customer (OK to skip)
        const existingForCustomer = await tx
          .select({ id: customerDomains.id })
          .from(customerDomains)
          .where(
            and(
              eq(customerDomains.customerId, customer.id),
              eq(customerDomains.domain, normalizedDomain)
            )
          )
          .limit(1);

        if (existingForCustomer.length === 0) {
          await tx.insert(customerDomains).values({
            customerId: customer.id,
            tenantId: customer.tenantId,
            domain: normalizedDomain,
            verified: false,
          });
          logger.debug({ customerId: customer.id, domain: normalizedDomain }, 'Added domain to customer');
        }
      }

      // Step 3: Fetch all domains for this customer within the same transaction
      const allDomains = await tx
        .select({ domain: customerDomains.domain })
        .from(customerDomains)
        .where(eq(customerDomains.customerId, customer.id));

      return {
        ...customer,
        domains: allDomains.map(d => d.domain),
      };
    });
  }

  /**
   * Add additional domain to existing customer
   * Internal method for domain management
   */
  async addDomain(customerId: string, tenantId: string, domain: string): Promise<void> {
    const normalizedDomain = domain.toLowerCase();

    await this.db.insert(customerDomains).values({
      customerId,
      tenantId,
      domain: normalizedDomain,
      verified: false,
    }).onConflictDoNothing();

    logger.debug({ customerId, domain: normalizedDomain }, 'Added domain to customer');
  }

  /**
   * Get first domain for a customer (oldest by created_at)
   * Internal method for domain management
   */
  async getFirstDomain(customerId: string, tenantId?: string): Promise<string | undefined> {
    const conditions = [eq(customerDomains.customerId, customerId)];
    if (tenantId) {
      conditions.push(eq(customerDomains.tenantId, tenantId));
    }

    const result = await this.db
      .select({ domain: customerDomains.domain })
      .from(customerDomains)
      .where(and(...conditions))
      .orderBy(customerDomains.createdAt)
      .limit(1);

    return result[0]?.domain;
  }

  /**
   * Get all domains for a customer
   * Internal method for domain management
   */
  async getDomains(customerId: string, tenantId?: string): Promise<string[]> {
    const conditions = [eq(customerDomains.customerId, customerId)];
    if (tenantId) {
      conditions.push(eq(customerDomains.tenantId, tenantId));
    }

    const result = await this.db
      .select({ domain: customerDomains.domain })
      .from(customerDomains)
      .where(and(...conditions));

    return result.map(r => r.domain);
  }

  /**
   * Batch get domains for multiple customers (fixes N+1 query problem)
   * Returns a map of customerId -> domains[]
   */
  async getDomainsBatch(customerIds: string[], tenantId?: string): Promise<Map<string, string[]>> {
    if (customerIds.length === 0) {
      return new Map();
    }

    const { inArray } = await import('drizzle-orm');
    const conditions = [inArray(customerDomains.customerId, customerIds)];
    if (tenantId) {
      conditions.push(eq(customerDomains.tenantId, tenantId));
    }

    const result = await this.db
      .select({
        customerId: customerDomains.customerId,
        domain: customerDomains.domain,
      })
      .from(customerDomains)
      .where(and(...conditions));

    // Group domains by customerId
    const domainsMap = new Map<string, string[]>();
    for (const row of result) {
      const existing = domainsMap.get(row.customerId) || [];
      existing.push(row.domain);
      domainsMap.set(row.customerId, existing);
    }

    // Ensure all customerIds have an entry (even if empty)
    for (const customerId of customerIds) {
      if (!domainsMap.has(customerId)) {
        domainsMap.set(customerId, []);
      }
    }

    return domainsMap;
  }

  // ===========================================================================
  // Access-Controlled Queries
  // ===========================================================================

  /**
   * Find customer by ID with access control
   */
  async findByIdScoped(header: RequestHeader, id: string): Promise<Customer | undefined> {
    const hasAccess = await this.hasCustomerAccess(header, id);
    if (!hasAccess) {
      return undefined;
    }

    const result = await this.db
      .select()
      .from(customers)
      .where(
        and(
          eq(customers.id, id),
          eq(customers.tenantId, header.tenantId)
        )
      );
    return result[0];
  }

  /**
   * Find all customers for tenant with access control
   */
  async findByTenantIdScoped(header: RequestHeader): Promise<Customer[]> {
    return this.db
      .select()
      .from(customers)
      .where(
        this.accessFilter(customers.tenantId, customers.id, header)
      );
  }

  /**
   * Find customer by domain with access control
   */
  async findByDomainScoped(header: RequestHeader, domain: string): Promise<Customer | undefined> {
    const normalizedDomain = domain.toLowerCase();

    const result = await this.db
      .select({
        id: customers.id,
        tenantId: customers.tenantId,
        name: customers.name,
        website: customers.website,
        industry: customers.industry,
        labels: customers.labels,
        externalId: customers.externalId,
        metadata: customers.metadata,
        isAutoCreated: customers.isAutoCreated,
        rowStatus: customers.rowStatus,
        createdAt: customers.createdAt,
        updatedAt: customers.updatedAt,
      })
      .from(customers)
      .innerJoin(customerDomains, eq(customers.id, customerDomains.customerId))
      .where(
        and(
          eq(customerDomains.tenantId, header.tenantId),
          eq(customerDomains.domain, normalizedDomain),
          this.customerAccessFilter(customers.id, header)
        )
      )
      .limit(1);

    return result[0];
  }

  /**
   * Check if user has access to a customer
   */
  async checkAccess(header: RequestHeader, customerId: string): Promise<boolean> {
    return this.hasCustomerAccess(header, customerId);
  }

  // ===========================================================================
  // Import/Export Support Methods
  // ===========================================================================

  /**
   * Find customer by externalId within a tenant
   */
  async findByExternalId(tenantId: string, externalId: string): Promise<Customer | undefined> {
    if (!externalId) return undefined;

    const result = await this.db
      .select()
      .from(customers)
      .where(
        and(
          eq(customers.tenantId, tenantId),
          eq(customers.externalId, externalId)
        )
      )
      .limit(1);

    return result[0];
  }


  /**
   * Replace all domains for a customer (delete existing, add new)
   * Used during import to fully replace domain list
   *
   * Accepts an optional transaction so the caller can keep the domain swap and
   * the matching contact reassignment atomic.
   *
   * Note the insert has no ON CONFLICT: (tenant_id, domain) is unique, so this
   * cannot take a domain off another customer — it raises 23505 instead. It
   * only ever drops this customer's own domains or claims unowned ones.
   */
  async replaceDomains(
    customerId: string,
    tenantId: string,
    domains: string[],
    tx?: Transaction
  ): Promise<void> {
    if (domains.length === 0) {
      throw new Error('At least one domain is required');
    }

    const runner = async (innerTx: Transaction): Promise<void> => {
      // Delete all existing domains for this customer
      await innerTx
        .delete(customerDomains)
        .where(eq(customerDomains.customerId, customerId));

      // Insert new domains
      for (const domain of domains) {
        await innerTx.insert(customerDomains).values({
          customerId,
          tenantId,
          domain: domain.toLowerCase(),
          verified: false,
        });
      }

      logger.debug({ customerId, domainCount: domains.length }, 'Replaced customer domains');
    };

    if (tx) {
      await runner(tx);
      return;
    }
    await this.db.transaction(runner);
  }

  /**
   * Upsert customer by externalId
   * If customer with externalId exists, update it; otherwise create new
   * Returns customer with domains array
   */
  async upsertCustomer(
    data: {
      tenantId: string;
      existingCustomerId?: string;
      externalId?: string;
      name?: string;
      website?: string;
      domains: string[];
    }
  ): Promise<Customer & { domains: string[] }> {
    return await this.db.transaction(async (tx) => {
      let customer: Customer;

      if (data.existingCustomerId) {
        // Update existing customer (matched by externalId or domain in service layer)
        const updateSet: Record<string, unknown> = { updatedAt: new Date() };
        if (data.name) updateSet.name = data.name;
        if (data.website) updateSet.website = data.website;
        if (data.externalId) updateSet.externalId = data.externalId;

        const updated = await tx
          .update(customers)
          .set(updateSet)
          .where(eq(customers.id, data.existingCustomerId))
          .returning();

        customer = updated[0];
        logger.debug({ customerId: customer.id, externalId: data.externalId }, 'Updated existing customer');
      } else {
        // Create new customer
        const created = await tx
          .insert(customers)
          .values({
            tenantId: data.tenantId,
            externalId: data.externalId,
            name: data.name,
            website: data.website,
          })
          .returning();

        customer = created[0];
        logger.debug({ customerId: customer.id, externalId: data.externalId }, 'Created new customer');
      }

      // Replace domains
      await tx
        .delete(customerDomains)
        .where(eq(customerDomains.customerId, customer.id));

      for (const domain of data.domains) {
        await tx.insert(customerDomains).values({
          customerId: customer.id,
          tenantId: data.tenantId,
          domain: domain.toLowerCase(),
          verified: false,
        });
      }

      return {
        ...customer,
        domains: data.domains.map(d => d.toLowerCase()),
      };
    });
  }

  /**
   * Get all customers for a tenant with their domains (for export)
   */
  async findAllWithDomains(tenantId: string): Promise<Array<Customer & { domains: string[] }>> {
    const customerList = await this.db
      .select()
      .from(customers)
      .where(eq(customers.tenantId, tenantId))
      .orderBy(customers.name);

    if (customerList.length === 0) {
      return [];
    }

    const customerIds = customerList.map(c => c.id);
    const domainsMap = await this.getDomainsBatch(customerIds, tenantId);

    return customerList.map(customer => ({
      ...customer,
      domains: domainsMap.get(customer.id) || [],
    }));
  }

  // ===========================================================================
  // Customer Merge Support
  // ===========================================================================

  /**
   * Lock both customer rows for merge (prevents concurrent merges/archival).
   * Returns locked rows for validation. Must be called inside a transaction.
   */
  async lockForMerge(tenantId: string, sourceId: string, targetId: string, tx: Transaction): Promise<Array<{ id: string; row_status: number }>> {
    const locked = await tx.execute<{ id: string; row_status: number }>(sql`
      SELECT id, row_status FROM customers
      WHERE id IN (${sourceId}, ${targetId}) AND tenant_id = ${tenantId}
      FOR UPDATE
    `);
    return locked as unknown as Array<{ id: string; row_status: number }>;
  }

  /**
   * Reassign domains from source to target customer.
   * Moves non-conflicting domains, deletes remaining source duplicates.
   */
  async reassignDomains(tenantId: string, sourceId: string, targetId: string, tx?: Transaction): Promise<number> {
    const db = tx ?? this.db;
    const result = await db.execute(sql`
      UPDATE customer_domains
      SET customer_id = ${targetId}, updated_at = NOW()
      WHERE customer_id = ${sourceId}
        AND tenant_id = ${tenantId}
        AND domain NOT IN (
          SELECT domain FROM customer_domains
          WHERE customer_id = ${targetId} AND tenant_id = ${tenantId}
        )
    `);
    await db.execute(sql`
      DELETE FROM customer_domains
      WHERE customer_id = ${sourceId} AND tenant_id = ${tenantId}
    `);
    return (result as any).rowCount ?? 0;
  }


  /**
   * Point a single domain at `targetCustomerId`, whoever owned it before.
   *
   * Used by manual contact assignment to take a domain off the placeholder
   * customer the pipeline auto-created for it. Upserts on the
   * (tenant_id, domain) unique index, so it both claims an unowned domain and
   * moves an owned one. Callers are responsible for deciding whether the
   * current owner may be displaced — see ContactService.assignCustomer.
   */
  async moveDomain(
    tenantId: string,
    domain: string,
    targetCustomerId: string,
    tx?: Transaction
  ): Promise<void> {
    const db = tx ?? this.db;
    const normalizedDomain = domain.toLowerCase();
    await db.execute(sql`
      INSERT INTO customer_domains (customer_id, tenant_id, domain, verified)
      VALUES (${targetCustomerId}, ${tenantId}, ${normalizedDomain}, FALSE)
      ON CONFLICT (tenant_id, domain)
      DO UPDATE SET customer_id = ${targetCustomerId}, updated_at = NOW()
    `);
    logger.info(
      { tenantId, domain: normalizedDomain, targetCustomerId, logType: 'DOMAIN_MOVED' },
      'Moved domain to customer'
    );
  }

  /**
   * Archive a customer (set row_status to ARCHIVED).
   */
  async archive(tenantId: string, customerId: string, tx?: Transaction): Promise<void> {
    const db = tx ?? this.db;
    await db.execute(sql`
      UPDATE customers
      SET row_status = ${CustomerRowStatus.ARCHIVED}, updated_at = NOW()
      WHERE id = ${customerId} AND tenant_id = ${tenantId}
    `);
  }
}
