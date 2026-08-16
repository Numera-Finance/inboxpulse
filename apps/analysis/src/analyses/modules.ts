import { z } from 'zod';
import type { Email } from '@crm/shared';
import type { AnalysisModule } from '../framework/types';
import { logger } from '../utils/logger';
import { sanitizeGmailQuery, participantAddresses } from './query-sanitizer';
import {
  sentimentSchema,
  escalationSchema,
  upsellSchema,
  churnSchema,
  kudosSchema,
  competitorSchema,
  signatureSchema,
  contextSearchStringSchema,
} from './schemas';

/**
 * Sentiment Analysis Module
 */
export const sentimentModule: AnalysisModule = {
  name: 'sentiment',
  description: 'Analyze the emotional tone of the email',
  instructions: `## Sentiment Analysis
Analyze the emotional tone of this email from a customer relationship perspective.

Return:
- value: positive|negative|neutral
- confidence: 0-1 (how confident you are in the sentiment classification)
- reason: one short sentence (max ~160 characters) justifying the classification, quoting or paraphrasing the specific phrase that drove it. Always provide this.

CRITICAL RULE: Default to NEUTRAL. The vast majority of business emails (95%+) are NEUTRAL. Only classify as POSITIVE when the PRIMARY PURPOSE of the email is to express genuine satisfaction, praise, or heartfelt gratitude — not as a side effect of politeness.

**NEUTRAL** - Standard business communication (THIS IS THE DEFAULT):
- Routine confirmations ("I have scheduled the payment", "confirming receipt")
- Polite acknowledgments ("Thank you for confirming", "Thanks for sending")
- Simple agreements ("Yes, that works", "Sure, I can do that", "Sounds good")
- Meeting scheduling ("Let's connect Tuesday", "I'll send an invite")
- Factual updates or status reports
- Forwarding information without commentary
- Questions or requests for information
- Standard business pleasantries without emotional content
- Automated notifications or transactional emails
- New Year/holiday greetings without additional emotional content
- Operational requests even with polite language ("I would also need...", "Could you please send...")
- Emails that contain a request or action item, even if they include "thank you"
- Enthusiastic sign-offs ("thank you so much!", "thanks a ton!") when the email body is a request, update, or operational matter
- Emails about HR, invoicing, onboarding, compliance, or administrative tasks — these are inherently operational regardless of tone

**POSITIVE** - Genuine satisfaction or praise (REQUIRES ALL of the following):
1. The email must contain words expressing genuine emotion: "happy", "delighted", "grateful", "impressed", "amazing", "fantastic", "love", "thrilled", "excellent", "outstanding"
2. The positive sentiment must be the PRIMARY PURPOSE of the email, not incidental politeness
3. The praise or gratitude must be ABOUT a specific service, product, outcome, or person — not just a generic closing pleasantry
- Examples: Compliments about service ("Your team has been fantastic at handling this")
- Heartfelt gratitude for specific help ("I really appreciate all the extra effort your team put in to resolve this")
- Testimonials or recommendations
- Expressed relief or satisfaction after problem resolution ("So glad this is finally working, you guys nailed it")

**NEGATIVE** — The customer is genuinely dissatisfied with US, and that dissatisfaction is the PRIMARY PURPOSE of the email.

Classify as NEGATIVE only when the customer ASSERTS that we did something wrong, failed them, or caused them harm — not when they merely ask, request, or rush us. The complaint must be aimed at our firm and be the main point of the email, not a passing remark in an otherwise operational message.

The key test is ASSERTION vs. INQUIRY. Saying "this is wrong / this is missing / you never did X" is dissatisfaction. Asking "is this right? / can you confirm X? / any update on X?" is NOT — it is a neutral question even if it voices mild doubt.

NEGATIVE signals — the customer ASSERTS a problem with us (NOT EXHAUSTIVE — reason about cases not listed here):
- States our work is wrong or does not match reality ("this is incorrect", "the numbers don't match", "you booked this to the wrong account")
- States we missed, lost, omitted, or failed to deliver something ("this is missing", "the files are gone", "you still haven't filed X")
- Complains we are unresponsive or slow — especially repeated or ignored follow-ups ("I've emailed twice with no reply", "every response takes weeks", "no one responded")
- Blames us for real harm — a penalty, a bounced/declined payment, or a missed deadline that WE caused
- Threatens to cancel, leave, switch providers, or escalate to management/legal; or expresses mistrust or loss of confidence in us
- Anger or sarcasm aimed at our firm

URGENCY IS NOT ESCALATION. A deadline, due date, or a request to prioritize or expedite ("ASAP", "by Friday", "on priority", "as a matter of urgency", "urgent") does NOT make an email negative on its own. Treat an urgent request as NEUTRAL unless it ALSO carries one of the NEGATIVE signals above — for example, the customer is chasing us because we already failed to deliver, or blames us for a deadline we are about to miss.

NEUTRAL even when worded strongly or with time-pressure (NOT EXHAUSTIVE — reason about cases not listed here):
- A request to send, prepare, fix, update, process, or grant access to something — even if marked urgent or carrying a deadline ("please share the W9 by tomorrow", "give KK QBO access on priority")
- A question, clarification, status check, or request for confirmation — even if it voices mild uncertainty ("can you confirm the fee?", "I'm not sure I see the confirmation", "is this right?", "any update on the open items?")
- A price, fee, quote, or scope discussion ("we don't want to pay for that twice")
- Frustration aimed at a third party (a bank, the IRS, a vendor, another provider) — even if forwarded to us — UNLESS the customer explicitly blames US or asks us to fix OUR OWN failure
- The customer explaining or apologizing for their OWN delay, mistake, or missing information ("sorry I couldn't get to it earlier", "I don't have the 2022 W-2")
- The customer disagreeing with a correction we proposed, or saying a change is not needed — this is a discussion, not dissatisfaction
- An informational or operational notice — a company winding down, a routine AR/AP review, providing documents we requested, or looping in a colleague to coordinate

THE ONE QUESTION. Everything above is detail; this is the decision:

"Does the client state or imply that WE did something wrong, failed to deliver,
missed something, were too slow, or caused them a problem?"

- YES → NEGATIVE. This holds even when they are polite, even when it is phrased
  as a question ("why is this missing?", "I don't see the return"), and even
  when they are chasing us again about something still outstanding.
- NO → NEUTRAL.

A REQUEST CAN BE A COMPLAINT. This is the single most common mistake: the
client wraps a failure in a polite ask, and the classifier reads the grammar
instead of the content. Look at WHAT is being asked for, not how.

- "Please send me the reports" → NEUTRAL. New work.
- "No vendor bills entered. Please send me the reports" → NEGATIVE. Work we
  already owed is missing, and they are telling us so.
- "Can you set up the payroll account?" → NEUTRAL. New work.
- "Please reconcile and FIX the LiveARR row" → NEGATIVE. Fixing implies we got
  it wrong.
- "Can you share a timeline?" → NEUTRAL.
- "Can you share a timeline for what Drew asked for last week?" → NEGATIVE.
  They are chasing something already promised.
- "Please check why the balance is off" → NEGATIVE. They found a discrepancy in
  our work.
- "It was accidentally enabled and we incurred big fees" → NEGATIVE. We caused
  a cost, however calmly they describe it.

The test: does the request point at work we ALREADY owed, delivered wrongly, or
left incomplete? Then it is NEGATIVE, no matter how courteous the wording. Only
a request for genuinely NEW work is NEUTRAL.

Four cases are commonly mistaken for YES. Each is NEUTRAL *on its own* — but
each becomes NEGATIVE the moment the client also alleges a failure on our side.
Do not stop at the first match; ask whether we are blamed as well.

- Frustration aimed at a THIRD PARTY (Gusto, Deel, a bank, the IRS, a state
  agency, their own auditor or team). NEUTRAL — unless they say we caused it,
  or that we failed to handle it.
- A fee, price, quote or scope discussion. NEUTRAL — unless the complaint is
  that we billed for work we did not do, or delivered less than we charged for.
- Time-pressure alone: "ASAP", "by Friday", "please prioritise". NEUTRAL —
  unless the urgency exists because we already missed something.
- Not about our firm: forwarded notices, portal alerts, feedback forms about
  someone else's business. NEUTRAL — no exception; this one really is not ours.

Measured on 120 production negatives, the classifier is right about 72% of the
time and over-fires on the rest, concentrated in exactly these four cases. It
does not under-fire: a search of mail labelled neutral found the complaint
language there belongs to third parties and automated notices, not to missed
complaints. Correct the over-firing WITHOUT becoming reluctant — a missed
complaint costs more than a false one.

EXAMPLES - Classify as NEUTRAL (NOT positive):
- "Yes, that works. Thank you." → NEUTRAL (simple acknowledgment)
- "Sure, we can connect on Tuesday." → NEUTRAL (scheduling)
- "Thanks for sending this over." → NEUTRAL (routine politeness)
- "Got it, will review." → NEUTRAL (acknowledgment)
- "Happy New Year! Please share the report." → NEUTRAL (greeting + request)
- "Thank you for the update." → NEUTRAL (routine thanks)
- "We got it from here, thank you so much!!!!" → NEUTRAL (acknowledgment with enthusiastic sign-off, but primary purpose is confirming they'll handle it)
- "I would also need the Passport Barcode Page Image. Please share." → NEUTRAL (operational request)
- "Thank you so much for your help! Can you also send me the invoice?" → NEUTRAL (request with polite opening)
- "Great, thanks! I'll review and get back to you." → NEUTRAL (acknowledgment)

EXAMPLES - Classify as POSITIVE:
- "Your team has been fantastic, I can't thank you enough for going above and beyond!" → POSITIVE (specific praise about team + emotional gratitude)
- "I'm really happy with how this turned out, excellent work" → POSITIVE (explicit happiness about outcome)
- "This is exactly what we needed, amazing work!" → POSITIVE (enthusiasm + praise about deliverable)
- "I wanted to write to say how impressed I am with the level of support we've received" → POSITIVE (dedicated email expressing satisfaction)

KEY TEST: Ask yourself — "Is the primary purpose of this email to express positive emotion, or is positive language just used as social courtesy?" If it's courtesy, classify as NEUTRAL.

Remember: "Thank you" or "thank you so much" alone is NEVER sufficient for positive. Exclamation marks do NOT change neutral to positive. Scheduling, requests, operational updates, and confirmations are ALWAYS neutral regardless of politeness level.`,
  schema: sentimentSchema,
  version: 'v1.6',
};

/**
 * Escalation Detection Module
 */
export const escalationModule: AnalysisModule = {
  name: 'escalation',
  description: 'Detect if the email requires escalation',
  instructions: `## Escalation Detection
Determine if this email requires escalation to management or specialized support.

Return:
- detected: true if escalation is needed, false otherwise
- confidence: 0-1
- urgency: low|medium|high|critical (if detected)
- reason: brief explanation (if detected)

Escalation indicators:
- Threats to cancel or leave
- Legal concerns or threats
- Demands to speak to manager/executive
- Extreme frustration or anger
- Repeated unresolved issues
- High-value customer concerns`,
  schema: escalationSchema,
  version: 'v1.0',
};

/**
 * Upsell Detection Module
 */
export const upsellModule: AnalysisModule = {
  name: 'upsell',
  description: 'Identify upsell opportunities',
  instructions: `## Upsell Detection

MyStartupCFO is a finance & accounting services firm. An upsell is a **new sales or account-expansion opportunity** for a service MyStartupCFO offers but is not already delivering to this client.

Return:
- detected: true ONLY if all conditions below are met. Default to false.
- confidence: 0-1
- opportunity: ≤30 words paraphrasing what the client said and which MyStartupCFO service addresses it. Do not invent details.
- product: the matching service group name from the taxonomy (exact text).

## Conditions for detected: true (all four required)

1. **Pain or ask in the Email Body** — either:
   - A problem, delay, penalty, quality issue, confusion, manual workaround, or open F&A / tax / compliance question the client is currently shouldering on their own.
   - A direct ask for MyStartupCFO to take on, start, or expand work.

2. **Signal maps cleanly to exactly one taxonomy group below, excluding Bookkeeping (basic).**

3. **The service is NOT already being delivered to this client.** Judge from thread participants and prior turns:
   - If any @mystartupcfo.com address or MyStartupCFO service partner is on the thread (sender, To, Cc, or any prior turn) executing or coordinating that same work, the service is in-flight → detected: false.
   - The active presence of MyStartupCFO staff replying about the work is sufficient evidence the service is being delivered. Do not require an explicit statement.
   - Operational coordination on existing work — providing data, answering open items, approving drafts, asking for status, requesting corrections — is not an upsell signal.

4. **The client is not winding down, dissolving, shutting down, or leaving.** Closing-out work for a dissolving entity, a customer announcing they are switching to another provider, or a customer ending the engagement is churn or transition work, not upsell → detected: false. This applies even when dissolution filings or final-period work are part of MyStartupCFO's service taxonomy.

## Service taxonomy (use these exact group names for \`product\`)

**Bookkeeping (basic)** — INCLUDED in every engagement, NEVER upsell:
- Standard ledger maintenance covered by the base engagement: bank and credit-card reconciliation, payroll journal entries, monthly close entries, standard balance sheet / P&L / cash flow reporting, balance-sheet schedules, and recording invoices from client-provided data.

**Bookkeeping (advanced)**:
- Chart-of-accounts restructuring, class / department / location / project tagging, revenue recognition under ASC 606, inventory reconciliation, sales-tax administration, and grant reporting.

**F&A operations**:
- Accounts payable operations, accounts receivable operations, payroll operations, cap-table maintenance, financial modeling, CFO advisory and investor / management reporting, M&A and due-diligence support, audit support, and finance-tool setup.

**Custom reporting**:
- Entity consolidation, budget vs. actuals, MIS in client format, and custom F&A reports.

**Compliance and tax**:
- 1099 filings, state annual reports and Statements of Information, state registrations and de-registrations, payroll and tax notice handling, sales-nexus studies, sales-tax filings, federal and state income-tax returns, foreign tax filings, BOI, BE-12, TRC, dissolution filings, tax planning, and R&D credit studies.

**F&A and company admin**:
- Company formation, EIN registration, state incorporation, compliance registrations, virtual office services, and registered-agent services.

## Rules

- Derive pain signals and asks ONLY from the Email Body. Ignore the Email Signature section.
- Use thread participants and thread context ONLY to judge whether the service is already being delivered, never to source pain signals.
- If the sender is MyStartupCFO staff or a third-party partner / vendor writing about their own ops rather than as a client, detected: false.
- \`product\` must be one of the six exact taxonomy group names above. If the signal doesn't cleanly map to one, detected: false. Do not invent product names.
- Acknowledgments, scheduling, FYIs, forwards with no commentary, and routine status updates are not upsell signals.
- Confidence ≥ 0.85 only when the signal is concrete, the service is clearly not already being delivered, the client is not winding down, and the taxonomy match is unambiguous. When any of these are uncertain, prefer detected: false.

When uncertain on any of the four conditions, default to detected: false.`,
  schema: upsellSchema,
  version: 'v1.3',
};

/**
 * Churn Risk Module
 */
export const churnModule: AnalysisModule = {
  name: 'churn',
  description: 'Assess customer churn risk',
  instructions: `## Churn Risk Assessment
Assess whether this email carries evidence that the customer may leave.

Return:
- riskLevel: none|low|medium|high|critical
- confidence: 0-1
- indicators: array of the specific phrases that drove the level. MUST be empty when riskLevel is none.
- reason: summary explanation (optional)

CRITICAL RULE: Default to NONE. The overwhelming majority of business email
carries no churn signal at all. Return NONE unless the email contains at least
one of the indicators below — an ordinary request, invoice, scheduling note or
status update is NONE, not low.

Do not treat routine operational friction as churn risk. A client asking where
something is, correcting a figure, or chasing a deadline is doing business with
us, not leaving us.

Churn risk indicators — return a level above NONE only if one is present:
- Threats to cancel, switch providers, or not renew
- Mentioning competitors positively, or saying they are evaluating alternatives
- Repeated complaints about the same unresolved issue
- Explicit loss of trust or confidence in us
- Disputing our fees as poor value, or asking to reduce scope to cut cost
- Naming a capability gap as a reason to look elsewhere

Level guide:
- none: no indicator present. This is the default and the most common answer.
- low: one indicator, stated mildly and in passing
- medium: an indicator stated directly, or more than one present
- high: explicit dissatisfaction with our value, or an alternative being considered
- critical: a stated intention to leave, cancel, or escalate to termination`,
  schema: churnSchema,
  version: 'v1.1',
};

/**
 * Kudos Detection Module
 */
export const kudosModule: AnalysisModule = {
  name: 'kudos',
  description: 'Detect positive feedback and praise',
  instructions: `## Kudos Detection
Identify if this email contains positive feedback or praise.

Return:
- detected: true if kudos/praise detected, false otherwise
- confidence: 0-1
- message: the positive feedback message (if detected)
- category: product|service|team|other (if detected)

Kudos indicators:
- Praise for product quality
- Compliments about service
- Thank you messages
- Positive testimonials
- Appreciation for team members`,
  schema: kudosSchema,
  version: 'v1.0',
};

/**
 * Competitor Mention Module
 */
export const competitorModule: AnalysisModule = {
  name: 'competitor',
  description: 'Detect mentions of competitors',
  instructions: `## Competitor Detection
Identify if competitors are mentioned in this email.

Return:
- detected: true if competitors mentioned, false otherwise
- confidence: 0-1
- competitors: array of competitor names mentioned (if detected)
- context: how competitors were mentioned (comparison, switching, etc.) (if detected)

Look for:
- Competitor company names
- Comparisons to other products/services
- Mentions of switching to competitors
- Competitive analysis or research`,
  schema: competitorSchema,
  version: 'v1.0',
};

/**
 * Signature Extraction Module
 */
export const signatureModule: AnalysisModule = {
  name: 'signature-extraction',
  description: 'Extract contact information from email signature',
  instructions: `## Signature Extraction
The "Email Signature" section contains the sender's reply text with the signature
attached at the end. Find the signature within it and extract the structured fields.

Return (each field nullable; omit if not clearly present):
- name: full name
- title: job title or position
- company: company or organization name
- email: email address shown in the signature
- phone: phone number
- mobile: mobile / cell number
- address: physical address
- website: website URL
- linkedin: LinkedIn profile URL
- x: X (formerly Twitter) handle or URL
- linktree: Linktree profile URL

CRITICAL — sender ownership rule:
The signature must belong to the sender of this email. The "From:" line above
identifies the sender. If the only signature you can find in the text clearly
belongs to a different person (e.g., a forwarded/quoted message embedded in the
reply, where the signature names someone other than the sender or carries an
email address on a different domain), return ALL fields as null. Do not attribute
someone else's signature to the sender.

Other rules:
- Do not invent or guess. If a field is not clearly visible in the signature,
  it must be null.
- The reply text may be short and contain no real signature (e.g., just "Best,
  John"). In that case return all fields as null — there is nothing to extract.
- Do not extract from the email body content above the signature, only from the
  signature itself.`,
  schema: signatureSchema,
  version: 'v1.2',
};

/**
 * Context Search String Module
 *
 * Unlike every other module here, the output is not a verdict about the email —
 * it is an instruction for retrieving other emails. The reader never sees the
 * string itself; it is run against the mailbox and only the results surface.
 */
export const contextSearchStringModule: AnalysisModule = {
  name: 'context-search-string',
  description: 'Generate a Gmail search string that finds context for this email',
  instructions: `## Context Search String
Given this email's sender, receiver, CCs, subject, and body, generate a search
string (such as with "ands" and "ors") that can be entered into a Gmail-like
search bar to find context that could aid with understanding the email.

Return:
- intent: one sentence (max ~160 characters) naming what would count as useful
  context for this email — the specific decision, obligation, request or thread
  of work a reader would be trying to catch up on. Retrieved candidates are
  later scored against this sentence, so name the thing at stake rather than
  restating the subject line.
- query: the search string
- confidence: 0-1 (how likely this string is to surface genuinely related email)

Rules:
- If the email only includes acknowledgements or similar gestures such as "ok,
  thanks" or "will do", center the string primarily around the participants and
  the subject. State the intent in terms of what the acknowledgement is
  answering — the underlying request or proposal, not the acknowledgement.
- Keep the elements in the string at a maximum of three terms.`,
  schema: contextSearchStringSchema,
  version: 'v1.1',

  /**
   * Make the generated query runnable before it is stored.
   *
   * Two corrections, both for failures Gmail reports as silence rather than as
   * an error: addresses the model invented (`sandeep@mystartupcfo.com` on a
   * thread whose participant is `sshroff@mystartupcfo.com`), and conjunctions
   * pinning both ends of the conversation, which describe the email being read
   * instead of searching around it. Either one makes the panel read as "no
   * context exists". Correcting here means the stored query is the one that
   * will actually be run.
   */
  postProcess: (result: unknown, email: Email): unknown => {
    const parsed = contextSearchStringSchema.safeParse(result);
    if (!parsed.success) return result;

    const { query, removed } = sanitizeGmailQuery(
      parsed.data.query,
      participantAddresses(email)
    );
    if (removed.length === 0) return result;

    logger.warn(
      {
        emailId: email.messageId,
        removed,
        before: parsed.data.query,
        after: query,
      },
      'context-search-string: repaired an unrunnable query'
    );

    return { ...parsed.data, query };
  },
};

/**
 * All analysis modules (LLM analyses only — domain and contact extraction are
 * pure regex on the analyze handler, not analyses).
 */
export const allModules: AnalysisModule[] = [
  sentimentModule,
  escalationModule,
  upsellModule,
  churnModule,
  kudosModule,
  competitorModule,
  signatureModule,
  contextSearchStringModule,
];

/**
 * Modules by name for easy lookup
 */
export const modulesByName: Record<string, AnalysisModule> = {
  'sentiment': sentimentModule,
  'escalation': escalationModule,
  'upsell': upsellModule,
  'churn': churnModule,
  'kudos': kudosModule,
  'competitor': competitorModule,
  'signature-extraction': signatureModule,
  'context-search-string': contextSearchStringModule,
};
