import type { Email } from '@crm/shared';
import { resolveCustomerKeyForEmail } from '@crm/shared';
import type { ExtractedContact } from '@crm/clients';
import { logger } from '../utils/logger';

export type { ExtractedContact } from '@crm/clients';

/**
 * Pure-extraction service. Returns participants found in an email. Performs
 * NO database writes — apps/api is responsible for all contact persistence so
 * the entire email-write happens in a single transaction.
 */
export class ContactExtractionService {
  /**
   * Extract all unique participant contacts from an email
   * (from + tos + ccs + bccs). De-duplicates by lowercase email.
   */
  extractContacts(email: Email): ExtractedContact[] {
    const seen = new Set<string>();
    const contacts: ExtractedContact[] = [];

    const add = (addr: { email: string; name?: string } | undefined) => {
      if (!addr?.email) return;
      const emailKey = addr.email.toLowerCase();
      if (seen.has(emailKey)) return;
      const customerKey = resolveCustomerKeyForEmail(addr.email, addr.name);
      if (!customerKey) return; // malformed address — skip
      seen.add(emailKey);
      contacts.push({ email: addr.email, name: addr.name, customerDomain: customerKey.domain });
    };

    try {
      add(email.from);
      for (const addr of email.tos || []) add(addr);
      for (const addr of email.ccs || []) add(addr);
      for (const addr of email.bccs || []) add(addr);

      logger.info(
        { emailId: email.messageId, contactsFound: contacts.length },
        'Extracted contacts from email'
      );
      return contacts;
    } catch (error: any) {
      logger.error(
        { error: error.message, stack: error.stack, emailId: email.messageId },
        'Failed to extract contacts from email'
      );
      return [];
    }
  }
}
