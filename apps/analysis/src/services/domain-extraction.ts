import type { Email } from '@crm/shared';
import { resolveCustomerKeyForEmail } from '@crm/shared';
import type { ExtractedDomain } from '@crm/clients';
import { logger } from '../utils/logger';

export type { ExtractedDomain } from '@crm/clients';

/**
 * Pure-extraction service. Returns extracted domains and a domain-derived
 * default name for each. Performs NO database writes — apps/api is responsible
 * for all customer persistence so the entire email-write happens in a single
 * transaction.
 *
 * All domain/personal branching lives in
 * `@crm/shared.resolveCustomerKeyForEmail`; this class only iterates the
 * participants and dedupes.
 */
export class DomainExtractionService {
  /**
   * Extract domains for every participant (from + tos + ccs + bccs).
   * Corporate participants collapse to one entry per top-level domain.
   * Personal-email participants each get their own per-address pseudo-domain
   * so every inbound gmail/yahoo/etc. sender becomes a first-class customer
   * that the user can later merge.
   *
   * `inferredName` prefers the participant's display name from the header
   * (e.g. "Uzi Dutta" in `"Uzi Dutta" <uzi.dutta@gmail.com>`) and falls back
   * to a local-part-derived name only when the header carries no name.
   */
  extractDomains(email: Email): ExtractedDomain[] {
    const seen = new Set<string>();
    const results: ExtractedDomain[] = [];

    const consider = (addr: { email: string; name?: string } | undefined) => {
      if (!addr?.email) return;
      const key = resolveCustomerKeyForEmail(addr.email, addr.name);
      if (!key || seen.has(key.domain)) return;
      seen.add(key.domain);
      results.push({ domain: key.domain, inferredName: key.defaultName });
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

}
