import { injectable, inject } from 'tsyringe';
import type { Email } from '@crm/shared';
import { ContactClient } from '@crm/clients';
import { logger } from '../utils/logger';
import { getEnv } from '../env';

export interface ExtractedContact {
  id: string;
  email: string;
  name?: string | null;
  customerId?: string | null;
}

@injectable()
export class ContactExtractionService {
  private contactClient: ContactClient;

  constructor() {
    this.contactClient = new ContactClient(getEnv().SERVICE_API_URL, { internal: true });
  }

  /**
   * Extract all contacts from email (from, tos, ccs, bccs)
   */
  extractContacts(email: Email): Array<{ email: string; name?: string }> {
    const contacts: Array<{ email: string; name?: string }> = [];

    try {
      // From sender
      contacts.push({
        email: email.from.email,
        name: email.from.name,
      });

      // Recipients
      const allRecipients = [
        ...(email.tos || []),
        ...(email.ccs || []),
        ...(email.bccs || []),
      ];

      for (const addr of allRecipients) {
        // Avoid duplicates
        if (!contacts.some((c) => c.email === addr.email)) {
          contacts.push({
            email: addr.email,
            name: addr.name,
          });
        }
      }

      logger.info({ emailId: email.messageId, contactsFound: contacts.length }, 'Extracted contacts from email');
      return contacts;
    } catch (error: any) {
      logger.error({ error: error.message, stack: error.stack, emailId: email.messageId }, 'Failed to extract contacts from email');
      return [];
    }
  }

  /**
   * Extract contacts and create/update them, linking to customers
   */
  async extractAndCreateContacts(
    tenantId: string,
    email: Email,
    customers: Array<{ id: string; domains: string[] }>
  ): Promise<ExtractedContact[]> {
    try {
      const contacts = this.extractContacts(email);
      const createdContacts: ExtractedContact[] = [];

      logger.info({ tenantId, contactsCount: contacts.length, customersCount: customers.length }, 'Creating/updating contacts from email');

      // Create a map of domain -> customer for quick lookup
      // Customer now has domains array, so we need to map all domains
      const domainToCustomer = new Map<string, string>();
      for (const customer of customers) {
        // Map all domains for this customer
        for (const domain of customer.domains) {
          domainToCustomer.set(domain, customer.id);
        }
      }

      for (const contact of contacts) {
        try {
          // Find customer for this contact's email domain
          const emailDomain = this.extractDomainFromEmail(contact.email);
          const customerId = emailDomain ? domainToCustomer.get(emailDomain) : undefined;

          // Upsert contact
          const created = await this.contactClient.upsertContact({
            tenantId,
            customerId,
            email: contact.email,
            name: contact.name,
          });

          createdContacts.push({
            id: created.id,
            email: created.email,
            name: created.name || undefined,
            customerId: created.customerId || undefined,
          });

          logger.info({ tenantId, email: contact.email, contactId: created.id, customerId }, 'Successfully created/updated contact');
        } catch (error: any) {
          logger.error(
            { error: error.message, stack: error.stack, tenantId, email: contact.email },
            'Failed to create/update contact'
          );
          // Continue with other contacts even if one fails
        }
      }

      logger.info({ tenantId, contactsCreated: createdContacts.length }, 'Completed contact extraction');
      return createdContacts;
    } catch (error: any) {
      logger.error({ error: error.message, stack: error.stack, tenantId, emailId: email.messageId }, 'Failed to extract and create contacts');
      throw error;
    }
  }

  /**
   * Extract domain from email address
   */
  private extractDomainFromEmail(email: string): string | null {
    try {
      const domain = email.split('@')[1]?.toLowerCase();
      if (!domain) return null;

      // Extract top-level domain (same logic as domain extraction)
      const parts = domain.split('.');
      if (parts.length >= 2) {
        return parts.slice(-2).join('.');
      }
      return domain;
    } catch (error: any) {
      logger.warn({ error: error.message, email }, 'Failed to extract domain from email');
      return null;
    }
  }
}
