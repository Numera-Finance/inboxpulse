import { injectable, inject } from 'tsyringe';
import { z } from 'zod';
import { ContactRepository } from './repository';
import { CustomerRepository } from '../customers/repository';
import { EmailRepository, type ParticipantAddressMatch } from '../emails/repository';
import { TaskService } from '../tasks/service';
import { logger } from '../utils/logger';
import type { Contact, NewContact } from './schema';
import type { Email, RequestHeader } from '@crm/shared';
import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
  isPersonalEmailDomain,
  resolveCustomerKeyForEmail,
} from '@crm/shared';
import type { Database, Transaction } from '@crm/database';

/**
 * Signature data extracted from email signatures
 */
export const signatureDataSchema = z.object({
  name: z.string().optional(),
  title: z.string().optional(),
  company: z.string().optional(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  mobile: z.string().optional(),
  address: z.string().optional(),
  website: z.string().optional(),
  linkedin: z.string().optional(),
  x: z.string().optional(),
  linktree: z.string().optional(),
});

export type SignatureData = z.infer<typeof signatureDataSchema>;

/**
 * Result of signature enrichment operation
 */
export const signatureEnrichmentResultSchema = z.object({
  contactId: z.string().uuid(),
  created: z.boolean(),
  enriched: z.boolean(),
  fieldsUpdated: z.array(z.string()),
});

export type SignatureEnrichmentResult = z.infer<typeof signatureEnrichmentResultSchema>;

/**
 * Outcome of a manual contact-to-customer assignment. `domainMoved` is set only
 * when a real domain changed hands, so the UI can say "moved 14 emails from
 * acme.com" and otherwise fall back to naming the single address.
 */
export interface AssignCustomerResult {
  contact: Contact;
  emailsReassigned: number;
  tasksCreated: number;
  domainMoved: string | null;
}

/**
 * Sender ownership guard. Returns true when the LLM-extracted signature
 * appears to belong to the email's sender, false when it clearly belongs to
 * a different person (an embedded forwarded/quoted signature).
 *
 * Defense-in-depth in case the LLM didn't apply its own ownership rule. The
 * rule is conservative: only reject when the signature email differs from the
 * sender both in mailbox AND in domain. Mailbox-only differences (e.g.
 * sender `mike@foo.com` with sig `mike.r@foo.com`) are accepted because
 * same-domain mismatches can be a legitimate alias or formatting variation.
 *
 * Inputs are case-insensitive; whitespace is trimmed.
 */
export function signatureBelongsToSender(
  signatureEmail: string | undefined | null,
  senderEmail: string
): boolean {
  if (!senderEmail) return false; // can't validate without a sender
  const sigEmail = signatureEmail?.trim().toLowerCase();
  if (!sigEmail) return true; // no claim to verify; accept
  const sender = senderEmail.toLowerCase();
  if (sigEmail === sender) return true; // exact match
  const senderDomain = sender.split('@')[1] ?? '';
  const sigDomain = sigEmail.split('@')[1] ?? '';
  if (!senderDomain || !sigDomain) return true; // malformed inputs; don't reject
  if (senderDomain === sigDomain) return true; // same domain, mailbox alias
  return false;
}

@injectable()
export class ContactService {
  constructor(
    @inject(ContactRepository) private contactRepository: ContactRepository,
    @inject(CustomerRepository) private customerRepository: CustomerRepository,
    @inject(EmailRepository) private emailRepository: EmailRepository,
    @inject(TaskService) private taskService: TaskService,
    @inject('Database') private db: Database
  ) { }

  /**
   * Point an email address at a customer, and make it stick — backwards and
   * forwards.
   *
   * Why this exists: `email_participants.customer_id` is stamped once during
   * analysis and never revisited, so an email that arrived before we knew who
   * the sender was keeps whatever customer the pipeline guessed — usually an
   * auto-created "<domain> (Auto)" placeholder. Creating a contact alone leaves
   * every past email pointing at it.
   *
   * So the assignment does three things:
   *
   *  1. Links the contact to the customer. This alone settles the sender's
   *     future emails: analysis reads the contact link before the domain.
   *  2. For a corporate address, also moves the domain onto that customer —
   *     unless a real customer already owns it — and brings that domain's other
   *     contacts along. Step 1 only covers this one address; the domain is what
   *     catches colleagues we have never seen before, who would otherwise spawn
   *     a fresh placeholder. An auto-created customer is not a real owner: it
   *     exists only because we had nothing better to key on.
   *     Personal addresses (gmail.com et al) skip this entirely — their key is
   *     a per-address pseudo-domain, so there are no colleagues to catch and
   *     nothing meaningful to attach to a real customer.
   *  3. Rewrites past `email_participants` rows — the whole domain when step 2
   *     claimed it, otherwise just this address — and creates the escalation
   *     tasks that were skipped for emails that had no customer at all.
   *
   * The "real customer already owns it" branch is close to unreachable: if a
   * real customer owned the domain, the email would already have been
   * attributed to them and nobody would be here reassigning it. It is kept as a
   * guard, and does nothing beyond linking the contact and rewriting this one
   * address's history — the domain owner stays put.
   */
  async assignCustomer(
    header: RequestHeader,
    input: { email: string; customerId: string; name?: string }
  ): Promise<AssignCustomerResult> {
    const { tenantId } = header;
    const contactEmail = input.email.trim().toLowerCase();

    const customer = await this.customerRepository.findById(input.customerId);
    if (!customer || customer.tenantId !== tenantId) {
      throw new NotFoundError('Customer not found');
    }
    if (!(await this.contactRepository.canAccessCustomer(header, input.customerId))) {
      throw new ForbiddenError('No access to this customer');
    }

    // The customer_domains key for this address: the registrable domain for a
    // corporate address, a per-address pseudo-domain for a personal one.
    const customerKey = resolveCustomerKeyForEmail(contactEmail, input.name);
    if (!customerKey) {
      throw new ValidationError('A valid email address is required');
    }
    const domainKey = customerKey.domain;
    const isPersonal = isPersonalEmailDomain(contactEmail.split('@')[1]);

    const result = await this.db.transaction(async (tx) => {
      // Decide domain ownership before writing anything. Personal addresses
      // never move a domain — their key is a per-address pseudo-domain that
      // means nothing to a real customer, so only the contact link is made.
      const currentOwner = isPersonal
        ? undefined
        : await this.customerRepository.findByDomain(tenantId, domainKey, tx);
      const claimDomain =
        !isPersonal &&
        (!currentOwner || currentOwner.isAutoCreated) &&
        currentOwner?.id !== input.customerId;

      const match: ParticipantAddressMatch = claimDomain
        ? { kind: 'domain', value: domainKey }
        : { kind: 'address', value: contactEmail };

      // Must be read before the update — these are the emails that had no
      // customer at all, and so never got an escalation task.
      const previouslyUnlinked = await this.emailRepository.findUnlinkedSenderEmailIds(
        tenantId,
        match,
        tx
      );

      const contact = await this.contactRepository.upsert(
        {
          tenantId,
          email: contactEmail,
          customerId: input.customerId,
          ...(input.name ? { name: input.name } : {}),
        },
        tx
      );

      if (claimDomain) {
        await this.customerRepository.moveDomain(tenantId, domainKey, input.customerId, tx);
        // The domain moved, so its contacts move with it. Analysis reads the
        // contact link before the domain, so any sibling left behind — say
        // alice@acme.com, still pointing at the placeholder — would keep
        // resolving there forever.
        await this.contactRepository.reassignByDomain(tenantId, domainKey, input.customerId, tx);
      }

      const emailsReassigned = await this.emailRepository.reassignParticipantsByAddress(
        tenantId,
        match,
        input.customerId,
        tx
      );

      const taskEligible = await this.emailRepository.findTaskEligibleEmails(
        tenantId,
        previouslyUnlinked,
        tx
      );

      return {
        contact,
        emailsReassigned,
        taskEligible,
        domainMoved: claimDomain ? domainKey : null,
      };
    });

    // Task creation runs outside the transaction: createFromEmail also
    // auto-assigns and notifies, and a failure there must not roll back a
    // correct reassignment. It is idempotent per email, so a retry is safe.
    let tasksCreated = 0;
    for (const email of result.taskEligible) {
      try {
        await this.taskService.createFromEmail(
          tenantId,
          input.customerId,
          email.id,
          email.subject || 'Negative sentiment email'
        );
        tasksCreated++;
      } catch (error: any) {
        logger.warn(
          { emailId: email.id, error: error.message, logType: 'ASSIGN_TASK_CREATE_FAILED' },
          'Failed to create escalation task during contact assignment (non-blocking)'
        );
      }
    }

    logger.info(
      {
        tenantId,
        email: contactEmail,
        customerId: input.customerId,
        emailsReassigned: result.emailsReassigned,
        tasksCreated,
        domainMoved: result.domainMoved,
        logType: 'CONTACT_ASSIGNED_TO_CUSTOMER',
      },
      'Manually assigned contact to customer'
    );

    return {
      contact: result.contact,
      emailsReassigned: result.emailsReassigned,
      tasksCreated,
      domainMoved: result.domainMoved,
    };
  }

  // ===========================================================================
  // Access-Controlled Methods
  // ===========================================================================

  async findByEmails(tenantId: string, emails: string[]): Promise<Map<string, Contact>> {
    return this.contactRepository.findByEmails(tenantId, emails);
  }

  /**
   * Get contact by email with access control
   * Returns undefined if user doesn't have access
   */
  async getContactByEmailScoped(requestHeader: RequestHeader, email: string): Promise<Contact | undefined> {
    try {
      logger.info({ email, tenantId: requestHeader.tenantId }, 'Fetching contact by email (scoped)');
      return await this.contactRepository.findByEmailScoped(requestHeader, email);
    } catch (error: any) {
      logger.error({ error, email, tenantId: requestHeader.tenantId }, 'Failed to fetch contact by email');
      throw error;
    }
  }

  /**
   * Get contact by ID with access control
   * Returns undefined if user doesn't have access
   */
  async getContactByIdScoped(requestHeader: RequestHeader, id: string): Promise<Contact | undefined> {
    try {
      logger.info({ id, tenantId: requestHeader.tenantId }, 'Fetching contact by id (scoped)');
      return await this.contactRepository.findByIdScoped(requestHeader, id);
    } catch (error: any) {
      logger.error({ error, id, tenantId: requestHeader.tenantId }, 'Failed to fetch contact by id');
      throw error;
    }
  }

  /**
   * Get contacts by tenant with access control
   * Only returns contacts whose customers the user has access to
   */
  async getContactsByTenantScoped(requestHeader: RequestHeader): Promise<Contact[]> {
    try {
      logger.info({ tenantId: requestHeader.tenantId }, 'Fetching contacts by tenant (scoped)');
      return await this.contactRepository.findByTenantIdScoped(requestHeader);
    } catch (error: any) {
      logger.error({ error, tenantId: requestHeader.tenantId }, 'Failed to fetch contacts by tenant');
      throw error;
    }
  }

  /**
   * Get contacts by customer with access control
   * Returns empty array if user doesn't have access to the customer
   */
  async getContactsByCustomerScoped(requestHeader: RequestHeader, customerId: string): Promise<Contact[]> {
    try {
      logger.info({ customerId, tenantId: requestHeader.tenantId }, 'Fetching contacts by customer (scoped)');
      return await this.contactRepository.findByCustomerIdScoped(requestHeader, customerId);
    } catch (error: any) {
      logger.error({ error, customerId, tenantId: requestHeader.tenantId }, 'Failed to fetch contacts by customer');
      throw error;
    }
  }

  /**
   * Update contact with access control
   * Returns undefined if user doesn't have access
   */
  async updateContactScoped(requestHeader: RequestHeader, id: string, data: Partial<NewContact>): Promise<Contact | undefined> {
    try {
      logger.info({ id, tenantId: requestHeader.tenantId }, 'Updating contact (scoped)');

      // Check access first
      const hasAccess = await this.contactRepository.checkAccess(requestHeader, id);
      if (!hasAccess) {
        return undefined;
      }

      return await this.contactRepository.update(id, data);
    } catch (error: any) {
      logger.error({ error, id, tenantId: requestHeader.tenantId }, 'Failed to update contact');
      throw error;
    }
  }

  // ===========================================================================
  // Legacy Methods (no access control - for internal/system use)
  // ===========================================================================

  /**
   * @deprecated Use getContactByEmailScoped for user-facing queries
   */
  async getContactByEmail(tenantId: string, email: string): Promise<Contact | undefined> {
    try {
      logger.info({ email, tenantId }, 'Fetching contact by email');
      return await this.contactRepository.findByEmail(tenantId, email);
    } catch (error: any) {
      logger.error({ error, email, tenantId }, 'Failed to fetch contact by email');
      throw error;
    }
  }

  /**
   * @deprecated Use getContactByIdScoped for user-facing queries
   */
  async getContactById(id: string): Promise<Contact | undefined> {
    try {
      logger.info({ id }, 'Fetching contact by id');
      return await this.contactRepository.findById(id);
    } catch (error: any) {
      logger.error({ error, id }, 'Failed to fetch contact by id');
      throw error;
    }
  }

  /**
   * @deprecated Use getContactsByTenantScoped for user-facing queries
   */
  async getContactsByTenant(tenantId: string): Promise<Contact[]> {
    try {
      logger.info({ tenantId }, 'Fetching contacts by tenant');
      return await this.contactRepository.findByTenantId(tenantId);
    } catch (error: any) {
      logger.error({ error, tenantId }, 'Failed to fetch contacts by tenant');
      throw error;
    }
  }

  /**
   * @deprecated Use getContactsByCustomerScoped for user-facing queries
   */
  async getContactsByCustomer(customerId: string): Promise<Contact[]> {
    try {
      logger.info({ customerId }, 'Fetching contacts by customer');
      return await this.contactRepository.findByCustomerId(customerId);
    } catch (error: any) {
      logger.error({ error, customerId }, 'Failed to fetch contacts by customer');
      throw error;
    }
  }

  // ===========================================================================
  // Internal CRUD Methods (for email mapping - no access control)
  // ===========================================================================

  /**
   * Find contact by email (internal use)
   */
  async findByEmail(tenantId: string, email: string): Promise<Contact | undefined> {
    return this.contactRepository.findByEmail(tenantId, email.toLowerCase());
  }

  /**
   * Create a new contact (internal use)
   */
  async create(data: NewContact): Promise<Contact> {
    return this.contactRepository.create(data);
  }

  /**
   * Update a contact (internal use)
   */
  async update(id: string, data: Partial<NewContact>): Promise<Contact | undefined> {
    return this.contactRepository.update(id, data);
  }

  async createContact(data: NewContact): Promise<Contact> {
    try {
      logger.info({ email: data.email, tenantId: data.tenantId }, 'Creating contact');
      return await this.contactRepository.create(data);
    } catch (error: any) {
      logger.error({ error, email: data.email, tenantId: data.tenantId }, 'Failed to create contact');
      throw error;
    }
  }

  async upsertContact(tenantId: string, data: Omit<NewContact, 'tenantId'>): Promise<Contact> {
    try {
      logger.info({ email: data.email, tenantId }, 'Upserting contact');
      return await this.contactRepository.upsert({ ...data, tenantId });
    } catch (error: any) {
      logger.error({ error, email: data.email, tenantId }, 'Failed to upsert contact');
      throw error;
    }
  }

  async updateContact(id: string, data: Partial<NewContact>): Promise<Contact | undefined> {
    try {
      logger.info({ id }, 'Updating contact');
      return await this.contactRepository.update(id, data);
    } catch (error: any) {
      logger.error({ error, id }, 'Failed to update contact');
      throw error;
    }
  }

  /**
   * Enrich contacts with extracted signature data
   * - Updates existing contacts with missing fields from signature
   * - Creates new contacts if they don't exist but we have signature data
   *
   * @param tenantId - Tenant ID
   * @param emailId - Email ID (for logging)
   * @param email - The email object containing sender info
   * @param signatureData - Extracted signature data
   * @param existingContacts - Contacts already extracted from this email
   * @returns Result of enrichment or null if no enrichment was needed
   */
  async enrichFromSignature(
    tenantId: string,
    emailId: string,
    email: Email,
    signatureData: SignatureData,
    existingContacts: Array<{ id: string; email: string; name?: string; customerId?: string }>,
    tx?: Transaction
  ): Promise<SignatureEnrichmentResult | null> {
    // The signature belongs to the sender of the email
    const senderEmail = email.from?.email?.toLowerCase();
    if (!senderEmail) {
      logger.debug({ emailId }, 'No sender email, skipping signature enrichment');
      return null;
    }

    if (!signatureBelongsToSender(signatureData.email, senderEmail)) {
      logger.info(
        {
          emailId,
          senderEmail,
          sigEmail: signatureData.email?.trim().toLowerCase(),
          tenantId,
          logType: 'SIGNATURE_REJECTED_SENDER_MISMATCH',
        },
        'Signature email belongs to a different person, rejecting extraction'
      );
      return null;
    }

    // Check if we have any meaningful signature data to apply
    const hasSignatureData = Object.entries(signatureData).some(([key, value]) => {
      if (key === 'email' || key === 'company') return false; // Skip email and company for this check
      return value && typeof value === 'string' && value.trim().length > 0;
    });

    if (!hasSignatureData) {
      logger.debug(
        { emailId, senderEmail },
        'No meaningful signature data extracted, skipping enrichment'
      );
      return null;
    }

    // Find the contact for the sender
    let contact = existingContacts.find(c => c.email.toLowerCase() === senderEmail);
    let contactId = contact?.id;

    // If contact doesn't exist in the provided list, try to find it in the database
    if (!contactId) {
      const dbContact = await this.contactRepository.findByEmail(tenantId, senderEmail, tx);
      contactId = dbContact?.id;
    }

    // If contact still doesn't exist but we have signature data, create a new contact
    if (!contactId) {
      logger.info(
        {
          tenantId,
          emailId,
          senderEmail,
          signatureName: signatureData.name,
          signatureTitle: signatureData.title,
          logType: 'SIGNATURE_CONTACT_CREATE',
        },
        'SIGNATURE ENRICHMENT: Creating new contact from signature data'
      );

      // Try to find a customer to associate with this contact
      // Use an existing contact's customerId if available
      let customerId: string | undefined;
      const contactWithCustomer = existingContacts.find(c => c.customerId);
      if (contactWithCustomer) {
        customerId = contactWithCustomer.customerId;
      }

      try {
        const newContact = await this.contactRepository.create({
          tenantId,
          email: senderEmail,
          name: signatureData.name || email.from?.name,
          title: signatureData.title,
          phone: signatureData.phone,
          mobile: signatureData.mobile,
          address: signatureData.address,
          website: signatureData.website,
          linkedin: signatureData.linkedin,
          x: signatureData.x,
          linktree: signatureData.linktree,
          customerId: customerId || null,
        }, tx);

        const fieldsSet = Object.entries(signatureData)
          .filter(([k, v]) => v && k !== 'email' && k !== 'company')
          .map(([k]) => k);

        logger.info(
          {
            tenantId,
            emailId,
            contactId: newContact.id,
            senderEmail,
            customerId,
            fieldsSet,
            logType: 'SIGNATURE_CONTACT_CREATED',
          },
          'SIGNATURE ENRICHMENT: New contact created from signature'
        );

        return {
          contactId: newContact.id,
          created: true,
          enriched: false,
          fieldsUpdated: fieldsSet,
        };
      } catch (createError: any) {
        // Contact might have been created by another process, try to find it again
        if (createError.code === '23505') { // Unique violation
          const dbContact = await this.contactRepository.findByEmail(tenantId, senderEmail, tx);
          contactId = dbContact?.id;
          if (!contactId) {
            throw createError;
          }
        } else {
          throw createError;
        }
      }
    }

    // Enrich existing contact with signature data
    const enrichResult = await this.contactRepository.enrichFromSignature(contactId, signatureData, tx);

    if (enrichResult.updated) {
      logger.info(
        {
          tenantId,
          emailId,
          contactId,
          senderEmail,
          fieldsUpdated: enrichResult.fieldsUpdated,
          signatureData: Object.fromEntries(
            enrichResult.fieldsUpdated.map(field => [field, signatureData[field as keyof SignatureData]])
          ),
          logType: 'SIGNATURE_CONTACT_ENRICHED',
        },
        'SIGNATURE ENRICHMENT: Contact enriched with signature data'
      );

      return {
        contactId,
        created: false,
        enriched: true,
        fieldsUpdated: enrichResult.fieldsUpdated,
      };
    }

    logger.debug(
      {
        tenantId,
        emailId,
        contactId,
        senderEmail,
      },
      'Contact already has all signature fields, no enrichment needed'
    );

    return {
      contactId,
      created: false,
      enriched: false,
      fieldsUpdated: [],
    };
  }
}
