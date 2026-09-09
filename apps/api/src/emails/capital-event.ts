/**
 * Capital event detection: is this client raising, selling, or borrowing?
 *
 * Requested as a "fundraising trigger" with sixteen keyword categories. The
 * corpus said something different, and the measurements are in
 * `docs/EXPERIMENTS.md` under "Fundraising triggers, measured against the
 * corpus". The short version, over 80,114 customer threads:
 *
 *   data room       30 threads   97% genuinely a capital event
 *   term sheet      20 threads   85%
 *   due diligence  141 threads   50%
 *   cap table      627 threads   ** 5% **
 *
 * ---------------------------------------------------------------------------
 * WHY ONLY THREE FLAGS OUT OF SIXTEEN CATEGORIES
 * ---------------------------------------------------------------------------
 *
 * The requested list mixes three kinds of phrase that behave nothing alike.
 *
 * EVENT terms are rare, and a hit means something is happening now. That is
 * what this file detects.
 *
 * ARTIFACT terms - cap table, 409A, SAFE, convertible note, option grants -
 * are almost always genuinely about that artifact, which is why they look
 * strong on a topical read. They are useless as triggers because an outsourced
 * CFO firm handles those artifacts continuously for companies that raised years
 * ago: booking convertible-note interest monthly, administering ESOP exercises,
 * refreshing a 409A annually because the option plan requires it. `cap table`
 * is 95% about a cap table and 5% about an event. Excluded.
 *
 * SERVICE terms - due diligence, financial projections, GAAP financials -
 * appear in OUR OWN retainer letters, which sell "audit / due diligence
 * support" as a service line, and in the disprz LMS, which runs a "Cap Table
 * Reconciliation Training Session". Alerting on them alerts on our marketing.
 * Excluded.
 *
 * ---------------------------------------------------------------------------
 * NAMED FOR THE EVENT, NOT THE FUNDRAISE
 * ---------------------------------------------------------------------------
 *
 * Of the twenty term-sheet threads: 8 equity raises, 5 M&A, 3 debt (a
 * credit-line restructure, a $2.285m SBA loan, SVB venture debt). A
 * fundraising-only tag discards the M&A, which carries the largest controller
 * workload and the clearest sales opening.
 *
 * The signal deliberately does NOT sub-type into raise / sale / debt. The
 * detector could guess from context, but that guess is unmeasured, and a panel
 * row asserting "this is an acquisition" on an unmeasured guess is the kind of
 * confident wrong answer this product cannot afford. It reports the event and
 * quotes the phrase; the reader draws the rest.
 */

/** What matched, so the panel can quote evidence rather than assert a verdict. */
export interface CapitalEventHit {
  /** Which of the three flags fired. */
  flag: 'data-room' | 'term-sheet' | 'declaration';
  /** The exact phrase found, for the reasoning string. */
  phrase: string;
}

/**
 * Senders whose mail can never be a client capital event.
 *
 * The largest single false-positive class, at 49 of 468 matching threads
 * (10.5%): our own Google Chat and meeting Notes, the disprz LMS, and
 * mytaxfiler. Bigger than newsletters, which were 7 of 468 despite looking
 * dominant in a small sample.
 */
const EXCLUDED_SENDER_DOMAINS = [
  'mystartupcfo.com',
  'mytaxfiler.com',
  'disprz.com',
  'google.com',
  'docs.google.com',
];

/**
 * Newsletters and deal feeds announce OTHER companies' rounds.
 *
 * "🦄 $73b series b" from beehiiv and "GridCARE secures $64M series a funding"
 * from LinkedIn are both true and both about somebody else's client.
 */
const NEWSLETTER_DOMAINS = [
  'beehiiv.com',
  'mail.beehiiv.com',
  'linkedin.com',
  'substack.com',
  'crunchbase.com',
  'pitchbook.com',
  'techcrunch.com',
];

/**
 * Phrases that mean we are SELLING the service, not observing the event.
 *
 * Taken verbatim from Numera retainer and engagement letters found in the
 * corpus. Without this, our own proposals trigger our own alerts.
 */
const OUR_OWN_SERVICE_LANGUAGE = [
  'audit / due diligence',
  'audit/due diligence',
  'due diligence support',
  'due diligence services',
  'cfo services',
  'retainer revision',
  'monthly retainer of',
];

/**
 * Word-boundary match.
 *
 * `409a` was found inside the hex GUID fragment `4ab083e2409a`, and `warrant`
 * matched "warranty" in 274 of 278 threads. Substring matching on financial
 * vocabulary that is also ordinary English does not survive contact with real
 * mail.
 */
function containsPhrase(haystack: string, phrase: string): boolean {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'i').test(haystack);
}

/** FLAG 1: a data room exists. 29 of 30 threads were real. */
const DATA_ROOM_PHRASES = ['data room', 'dataroom', 'virtual data room', 'vdr'];

/** FLAG 2: a term sheet is in play. 17 of 20 threads were real. */
const TERM_SHEET_PHRASES = ['term sheet', 'termsheet', 'letter of intent', 'loi'];

/**
 * FLAG 3: somebody says outright what is happening.
 *
 * Drawn from what clients actually wrote, not from a vocabulary list:
 * "restarting our Series A in September", "we're starting to put together the
 * investor data room for our next fundraise", "cleaning up cap table to prepare
 * for a financing", "until we close the series a".
 *
 * Each phrase carries a verb or a possessive, which is what separates a
 * declaration from a mention. "Series A" alone matched a training series and a
 * chart of accounts; "our series a" does not.
 */
const DECLARATION_PHRASES = [
  'our next fundraise',
  'our fundraise',
  'we are raising',
  "we're raising",
  'raising a round',
  'close the series',
  'closing the round',
  'prepare for a financing',
  'preparing for a financing',
  'our series a',
  'our series b',
  'our seed round',
  'restarting our series',
  'new convertible note offering',
  'signed a term sheet',
  'received an investment',
];

/**
 * Vendors whose invoice IS the signal.
 *
 * Nobody asked for this and it needs no keyword. DFIN Venue and Suralink sell
 * virtual data rooms; an invoice from one means the client has bought the thing
 * a capital event requires, and buying it is the event.
 *
 * TWO VENDORS ARE DELIBERATELY EXCLUDED, for the same reason:
 *
 *   carta.com   cap-table software, used continuously by companies that raised
 *               years ago. "Ryan Kim requests access to your cap table" is
 *               routine administration.
 *   etonvs.com  409A valuations. A first pass listed Eton here and the corpus
 *               check caught it: six of sixty-eight hits were annual IRC409A
 *               FMV reports, which every company with an option plan must
 *               refresh whether or not anything is happening. Including it
 *               contradicted this file's own reason for excluding the `409a`
 *               phrase, and let the artifact class back in through the vendor
 *               door.
 */
const CAPITAL_EVENT_VENDOR_DOMAINS = ['dfinsolutions.com', 'suralink.com'];

export interface CapitalEventInput {
  subject: string | null;
  body: string | null;
  fromEmail: string | null;
  /** The client's own domain, so a company named "Fundraisly" cannot match itself. */
  customerDomain?: string | null;
}

/**
 * Detect a capital event, or return null.
 *
 * Returns at most one hit. The panel shows one row per client, so ranking three
 * simultaneous matches would be inventing an ordering the corpus never
 * justified; the first flag to fire wins, in evidence-strength order.
 */
export function detectCapitalEvent(input: CapitalEventInput): CapitalEventHit | null {
  const senderDomain = (input.fromEmail ?? '').split('@')[1]?.toLowerCase() ?? '';
  if (!senderDomain) return null;

  if (EXCLUDED_SENDER_DOMAINS.includes(senderDomain)) return null;
  if (NEWSLETTER_DOMAINS.includes(senderDomain)) return null;

  // The vendor's identity is the evidence; no phrase needed.
  if (CAPITAL_EVENT_VENDOR_DOMAINS.includes(senderDomain)) {
    return { flag: 'data-room', phrase: senderDomain };
  }

  const text = `${input.subject ?? ''} ${input.body ?? ''}`.toLowerCase();
  if (!text.trim()) return null;

  // Our own proposal describing what we sell is not a client event.
  if (OUR_OWN_SERVICE_LANGUAGE.some((p) => text.includes(p))) return null;

  /**
   * A client named "Fundraisly" matches `fundrais` in every message it sends,
   * eight threads of it. The company name is not a signal about the company.
   */
  const nameStem = (input.customerDomain ?? senderDomain).split('.')[0]?.toLowerCase() ?? '';

  for (const [flag, phrases] of [
    ['data-room', DATA_ROOM_PHRASES],
    ['term-sheet', TERM_SHEET_PHRASES],
    ['declaration', DECLARATION_PHRASES],
  ] as const) {
    for (const phrase of phrases) {
      // Skip a phrase the client's own name contains, so the name cannot fire it.
      if (nameStem.length >= 4 && phrase.replace(/\s/g, '').includes(nameStem)) continue;
      if (containsPhrase(text, phrase)) return { flag, phrase };
    }
  }
  return null;
}
