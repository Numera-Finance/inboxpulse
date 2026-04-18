import type { Email } from '@crm/shared';
import { isPersonalEmailDomain } from '@crm/shared';
import { logger } from '../utils/logger';

export interface ExtractedDomain {
  domain: string;
  inferredName: string;
}

/**
 * Pure-extraction service. Returns extracted domains and a domain-derived
 * default name for each. Performs NO database writes — apps/api is responsible
 * for all customer persistence so the entire email-write happens in a single
 * transaction.
 */
export class DomainExtractionService {
  /**
   * Extract top-level domain from an email address.
   * Returns null for personal-domain addresses or malformed input.
   */
  extractTopLevelDomain(email: string): string | null {
    try {
      const domain = email?.split('@')[1]?.toLowerCase();
      if (!domain) {
        logger.warn({ email }, 'No domain found in email address');
        return null;
      }
      if (isPersonalEmailDomain(domain)) return null;
      const parts = domain.split('.');
      if (parts.length >= 2) return parts.slice(-2).join('.');
      return domain;
    } catch (error: any) {
      logger.error({ error: error.message, stack: error.stack, email }, 'Failed to extract top-level domain');
      return null;
    }
  }

  /**
   * Extract all unique non-personal domains from an email's participants
   * (from + tos + ccs + bccs). Returns each with a domain-derived default
   * name that apps/api can use as the fallback when there is no signature
   * company.
   */
  extractDomains(email: Email): ExtractedDomain[] {
    const seen = new Set<string>();
    const results: ExtractedDomain[] = [];

    const consider = (addr: { email: string } | undefined) => {
      if (!addr?.email) return;
      const d = this.extractTopLevelDomain(addr.email);
      if (!d || seen.has(d)) return;
      seen.add(d);
      results.push({ domain: d, inferredName: this.inferCustomerName(d) });
    };

    consider(email.from);
    for (const addr of email.tos || []) consider(addr);
    for (const addr of email.ccs || []) consider(addr);
    for (const addr of email.bccs || []) consider(addr);

    logger.info(
      {
        emailId: email.messageId,
        domainsFound: results.length,
        domains: results.map((d) => d.domain),
      },
      'Extracted domains from email'
    );
    return results;
  }

  /**
   * Naive customer-name inference from a domain.
   *   acme-corp.com → "Acme Corp"
   */
  inferCustomerName(domain: string): string {
    try {
      const namePart = domain.split('.')[0];
      if (!namePart) return domain;
      return namePart
        .split('-')
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ');
    } catch (error: any) {
      logger.warn({ error: error.message, domain }, 'Failed to infer customer name from domain');
      return domain;
    }
  }
}
