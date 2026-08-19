import { eq, and, asc, sql } from 'drizzle-orm';
import { injectable, inject } from 'tsyringe';
import { ScopedRepository, affectedRows, escapeLikeLiteral } from '@crm/database';
import type { Database, Transaction } from '@crm/database';
import type { RequestHeader } from '@crm/shared';
import { contacts, type Contact, type NewContact } from './schema';

@injectable()
export class ContactRepository extends ScopedRepository {
  constructor(@inject('Database') db: Database) {
    super(db);
  }

  async findByEmail(
    tenantId: string,
    email: string,
    tx?: Transaction
  ): Promise<Contact | undefined> {
    const dbHandle = (tx ?? this.db) as Database;
    const result = await dbHandle
      .select()
      .from(contacts)
      .where(and(eq(contacts.tenantId, tenantId), eq(contacts.email, email)));
    return result[0];
  }

  /**
   * Batch find contacts by email addresses
   * Returns a map of email -> Contact for efficient lookup
   */
  async findByEmails(tenantId: string, emails: string[]): Promise<Map<string, Contact>> {
    if (emails.length === 0) {
      return new Map();
    }

    const { inArray } = await import('drizzle-orm');
    const result = await this.db
      .select()
      .from(contacts)
      .where(
        and(
          eq(contacts.tenantId, tenantId),
          inArray(contacts.email, emails)
        )
      );

    const emailMap = new Map<string, Contact>();
    for (const contact of result) {
      emailMap.set(contact.email.toLowerCase(), contact);
    }
    return emailMap;
  }

  async findById(id: string, tx?: Transaction): Promise<Contact | undefined> {
    const dbHandle = (tx ?? this.db) as Database;
    const result = await dbHandle.select().from(contacts).where(eq(contacts.id, id));
    return result[0];
  }

  async findByTenantId(tenantId: string): Promise<Contact[]> {
    return this.db.select().from(contacts).where(eq(contacts.tenantId, tenantId));
  }

  async findByCustomerId(customerId: string): Promise<Contact[]> {
    return this.db
      .select()
      .from(contacts)
      .where(eq(contacts.customerId, customerId))
      .orderBy(asc(contacts.name), asc(contacts.title), asc(contacts.email));
  }

  async create(data: NewContact, tx?: Transaction): Promise<Contact> {
    const dbHandle = (tx ?? this.db) as Database;
    const result = await dbHandle.insert(contacts).values(data).returning();
    return result[0];
  }

  /**
   * Upsert a contact on (tenant_id, email).
   *
   * Only keys actually present on `data` are written on conflict. Spreading the
   * whole object unconditionally would set every omitted column to `undefined`,
   * which Drizzle emits as NULL — so a partial upsert (say, name only) would
   * wipe the contact's customer link and signature fields. Callers that mean to
   * clear a column must pass an explicit `null`.
   */
  async upsert(data: NewContact, tx?: Transaction): Promise<Contact> {
    const dbHandle = (tx ?? this.db) as Database;

    // `id` and `createdAt` are dropped alongside the conflict target: an
    // upsert must never rewrite the identity of the row it matched, or
    // polymorphic references such as email_participants.participant_id (no FK)
    // would be left dangling.
    const { tenantId, email, id, createdAt, ...mutable } = data;
    const set: Partial<NewContact> = { updatedAt: new Date() };
    for (const [key, value] of Object.entries(mutable)) {
      if (value !== undefined) {
        (set as Record<string, unknown>)[key] = value;
      }
    }

    const result = await dbHandle
      .insert(contacts)
      .values(data)
      .onConflictDoUpdate({
        target: [contacts.tenantId, contacts.email],
        set,
      })
      .returning();
    return result[0];
  }

  async update(
    id: string,
    data: Partial<NewContact>,
    tx?: Transaction
  ): Promise<Contact | undefined> {
    const dbHandle = (tx ?? this.db) as Database;
    const result = await dbHandle
      .update(contacts)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(contacts.id, id))
      .returning();
    return result[0];
  }

  /**
   * Signature data that can be used to enrich a contact
   */
  static readonly SIGNATURE_FIELDS = ['name', 'title', 'phone', 'mobile', 'address', 'website', 'linkedin', 'x', 'linktree'] as const;

  /**
   * Enrich contact with signature data - only updates fields that are currently empty
   * Returns which fields were updated for logging purposes
   */
  async enrichFromSignature(
    id: string,
    signatureData: {
      name?: string;
      title?: string;
      phone?: string;
      mobile?: string;
      address?: string;
      website?: string;
      linkedin?: string;
      x?: string;
      linktree?: string;
    },
    tx?: Transaction
  ): Promise<{ updated: boolean; fieldsUpdated: string[]; contact?: Contact }> {
    // First get the current contact to check which fields are empty
    const current = await this.findById(id, tx);
    if (!current) {
      return { updated: false, fieldsUpdated: [] };
    }

    // Only update fields that are currently empty in the contact
    const updates: Partial<NewContact> = {};
    const fieldsUpdated: string[] = [];

    // Helper to check if a value is valid (not empty, not placeholder)
    const isValidValue = (value: string | undefined | null): boolean => {
      if (!value) return false;
      const trimmed = value.trim().toLowerCase();
      return trimmed.length > 0 && trimmed !== 'string' && trimmed !== 'null' && trimmed !== 'undefined';
    };

    // Check each field
    for (const field of ContactRepository.SIGNATURE_FIELDS) {
      const currentValue = current[field as keyof Contact];
      const signatureValue = signatureData[field as keyof typeof signatureData];

      if (!currentValue && isValidValue(signatureValue)) {
        (updates as any)[field] = signatureValue!.trim();
        fieldsUpdated.push(field);
      }
    }

    if (fieldsUpdated.length === 0) {
      return { updated: false, fieldsUpdated: [], contact: current };
    }

    const updatedContact = await this.update(id, updates, tx);
    return { updated: true, fieldsUpdated, contact: updatedContact };
  }

  // ===========================================================================
  // Access-Controlled Queries
  // ===========================================================================

  /**
   * Find contact by ID with access control
   * Returns undefined if user doesn't have access to the contact's customer
   * Admins can access all contacts in their tenant
   */
  async findByIdScoped(header: RequestHeader, id: string): Promise<Contact | undefined> {
    const contact = await this.findById(id);
    if (!contact) {
      return undefined;
    }

    // Tenant isolation
    if (contact.tenantId !== header.tenantId) {
      return undefined;
    }

    // If contact has no customer, allow access (same tenant)
    if (!contact.customerId) {
      return contact;
    }

    // Check access to contact's customer (handles admin bypass)
    const hasAccess = await this.hasCustomerAccess(header, contact.customerId);
    return hasAccess ? contact : undefined;
  }

  /**
   * Find contacts by tenant with access control
   * Only returns contacts whose customers the user has access to
   * Admins can access all contacts in their tenant
   */
  async findByTenantIdScoped(header: RequestHeader): Promise<Contact[]> {
    return this.db
      .select()
      .from(contacts)
      .where(
        and(
          eq(contacts.tenantId, header.tenantId),
          sql`(
            ${contacts.customerId} IS NULL
            OR ${this.customerAccessFilter(contacts.customerId, header)}
          )`
        )
      );
  }

  /**
   * Find contacts by customer with access control
   * Returns empty array if user doesn't have access to the customer
   * Admins can access all customers in their tenant
   */
  async findByCustomerIdScoped(header: RequestHeader, customerId: string): Promise<Contact[]> {
    const hasAccess = await this.hasCustomerAccess(header, customerId);
    if (!hasAccess) {
      return [];
    }

    return this.db
      .select()
      .from(contacts)
      .where(eq(contacts.customerId, customerId))
      .orderBy(asc(contacts.name), asc(contacts.title), asc(contacts.email));
  }

  /**
   * Find contact by email with access control
   */
  async findByEmailScoped(header: RequestHeader, email: string): Promise<Contact | undefined> {
    const contact = await this.findByEmail(header.tenantId, email);
    if (!contact) {
      return undefined;
    }

    // If contact has no customer, allow access (same tenant)
    if (!contact.customerId) {
      return contact;
    }

    // Check access to contact's customer (handles admin bypass)
    const hasAccess = await this.hasCustomerAccess(header, contact.customerId);
    return hasAccess ? contact : undefined;
  }

  /**
   * Check if user has access to a contact
   */
  async checkAccess(header: RequestHeader, contactId: string): Promise<boolean> {
    const contact = await this.findById(contactId);
    if (!contact || contact.tenantId !== header.tenantId) {
      return false;
    }

    // If contact has no customer, allow access (same tenant)
    if (!contact.customerId) {
      return true;
    }

    // Check access to contact's customer (handles admin bypass)
    return this.hasCustomerAccess(header, contact.customerId);
  }

  /**
   * Re-link every contact on a domain to `customerId`.
   *
   * Call this wherever a domain changes hands. Analysis resolves a participant
   * by the contact's own link before falling back to the domain, and a link is
   * written once and never refreshed — so a domain that moves without its
   * contacts would leave every known sender on it pinned to the old customer
   * for good.
   *
   * Matches subdomains (bob@mail.acme.com belongs to acme.com), mirroring the
   * last-two-labels rule `resolveCustomerKeyForEmail` keys customers on.
   */
  async reassignByDomain(
    tenantId: string,
    domain: string,
    customerId: string,
    tx?: Transaction
  ): Promise<number> {
    const db = tx ?? this.db;
    const normalized = escapeLikeLiteral(domain.toLowerCase());
    const result = await db.execute(sql`
      UPDATE contacts
      SET customer_id = ${customerId}, updated_at = NOW()
      WHERE tenant_id = ${tenantId}
        AND customer_id IS DISTINCT FROM ${customerId}
        AND (LOWER(email) LIKE ${'%@' + normalized} ESCAPE '\\'
          OR LOWER(email) LIKE ${'%@%.' + normalized} ESCAPE '\\')
    `);
    return affectedRows(result);
  }

  /**
   * Public wrapper over the inherited access check, so services can gate an
   * assignment on the caller actually having access to the target customer.
   */
  async canAccessCustomer(header: RequestHeader, customerId: string): Promise<boolean> {
    return this.hasCustomerAccess(header, customerId);
  }

  /**
   * Reassign all contacts from one customer to another.
   * Safe: unique constraint is (tenant_id, email), not (tenant_id, customer_id, email).
   */
  async reassignCustomer(tenantId: string, sourceCustomerId: string, targetCustomerId: string, tx?: Transaction): Promise<number> {
    const db = tx ?? this.db;
    const result = await db.execute(sql`
      UPDATE contacts
      SET customer_id = ${targetCustomerId}, updated_at = NOW()
      WHERE customer_id = ${sourceCustomerId} AND tenant_id = ${tenantId}
    `);
    return (result as any).rowCount ?? 0;
  }
}
