/**
 * Mail that belongs to a client's CUSTOMERS, not to the client.
 *
 * We do the books for operating businesses, so their customer-facing systems
 * copy us on traffic that has nothing to do with our work. Blue Ocean Pool
 * Service is a client; `poolbrain.com` is the field-service software that emails
 * their homeowners "Your pool has been cleaned - thank you!". Homeowners reply
 * to it, sometimes unhappily, and 42 of those replies were sitting in the
 * classifier's training set as complaints:
 *
 *   "Still haven't received a reply on my email about my pool not being as
 *    clean as it used to be."
 *
 * A correct negative-sentiment call and completely wrong for this product. The
 * sentiment prompt was asked *is this negative*; the question that matters is
 * *is this client unhappy with US*. Trained on that mail, the gate learns to
 * fire on domestic grievances, and a bookkeeper in Pune gets escalated a pool
 * complaint from a homeowner in Texas.
 *
 * The cut is the NOTIFICATION SYSTEM, not the company. Blue Ocean's own mail —
 * "BOPS Bank, Checks and CC Weekly Tracker", "1099 & W9 Folders" — is a client
 * talking to us about their books, and if they are unhappy in it we need to
 * know. Excluding `blueoceanps.co` would have thrown that away with the rest.
 *
 * Two things this deliberately does NOT do:
 *
 * 1. **It does not exclude free-mail senders.** Their complaint rate is 9.4%
 *    against 2.6% for corporate domains, which reads like contamination and is
 *    not: founders run startups from personal Gmail, and those 184 positives
 *    include tax filings, DE annual reports and unpaid myStartUpCFO invoices.
 *    Cutting them would delete 17% of the training positives, most of them real.
 *
 * 2. **It does not match on subject matter.** A `/pool|lawn|hvac/` rule is the
 *    same mistake as the invented half of the idiom lexicon — it encodes what
 *    one contaminated cluster happened to be about, and the next one will be a
 *    dental practice or a trucking firm.
 *
 * The general form of this check is a participant test: our own domain should be
 * on the thread, per ADR-020. That needs `email_participants`, which the
 * training corpus does not carry, so this list stands in for it there. At
 * ingestion time prefer the participant check and treat this as the backstop.
 */

/**
 * Domains that send on behalf of a client to THEIR customers. Every message in
 * a thread touching one of these is consumer traffic.
 *
 * Add to this only with the counts that justify it — how many emails, how many
 * of them currently labelled complaints, and confirmation that the client's own
 * correspondence does not travel through the same domain.
 */
export const CUSTOMER_FACING_DOMAINS: readonly string[] = [
  // Blue Ocean Pool Service's field-service platform. 297 emails, 42 of them
  // labelled complaints, sent by 28 distinct homeowners on gmail/live/aol.
  'poolbrain.com',
];

const PATTERN = new RegExp(
  `\\b(${CUSTOMER_FACING_DOMAINS.map((d) => d.replace(/\./g, '\\.')).join('|')})\\b`,
  'i'
);

/**
 * Is this a client's customer writing to the client, rather than a client
 * writing to us?
 *
 * Checks the whole message including the quoted chain, because the homeowner's
 * reply carries the notification it is answering. The sender alone is not
 * enough — the replies come from ordinary personal addresses.
 */
export function isCustomerTraffic(sender: string, body: string): boolean {
  return PATTERN.test(sender) || PATTERN.test(body);
}
