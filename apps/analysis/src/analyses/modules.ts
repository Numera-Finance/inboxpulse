import { z } from 'zod';
import type { AnalysisModule } from '../framework/types';
import {
  sentimentSchema,
  escalationSchema,
  upsellSchema,
  churnSchema,
  kudosSchema,
  competitorSchema,
  signatureSchema,
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

**NEGATIVE** — Genuine dissatisfaction directed at US, or urgency/time-pressure about our work.

Classify as NEGATIVE when either condition holds:
1. DISSATISFACTION WITH US: the customer is unhappy with something WE did or failed to do — our service, deliverable, timeline, error, or communication — and that dissatisfaction is the PRIMARY PURPOSE of the email, not a passing remark in an otherwise operational message.
2. URGENCY: the customer signals time-pressure about our work — an explicit deadline, or a request to prioritize, expedite, or act quickly — regardless of tone, and even when no dissatisfaction is expressed.

Signals of dissatisfaction with us (NOT EXHAUSTIVE — reason about cases not listed here):
- Complaints about our work quality
- Disappointment with our responsiveness
- Threats to cancel, leave, or escalate to management/legal
- Anger or sarcasm aimed at our firm
- Being blamed for a problem that caused the customer real harm

Signals that do NOT by themselves make an email NEGATIVE (NOT EXHAUSTIVE — reason about cases not listed here):
- A price / fee / quote negotiation
- A question, clarification, or help request
- Frustration aimed at a third party rather than us
- The customer apologizing for their own delay or mistake
- An automated or transactional notice

DOUBLE-CHECK before finalizing your classification. Re-read the email and ask:
"Is the customer unhappy with something WE did or failed to do, as the main point of the email — OR are they expressing urgency or time-pressure about our work?"
- If YES to either → NEGATIVE.
- If the negativity is only about price, a third party, or their own mistake, AND there is no urgency → NEUTRAL.
Revise your initial classification if this check disagrees with it.

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
  version: 'v1.4',
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
Assess the risk level that this customer will churn.

Return:
- riskLevel: low|medium|high|critical
- confidence: 0-1
- indicators: array of specific phrases or behaviors indicating churn risk
- reason: summary explanation (optional)

Churn risk indicators:
- Threats to cancel or switch providers
- Mentioning competitors positively
- Repeated complaints or unresolved issues
- Loss of trust or confidence
- Price sensitivity concerns
- Feature gaps compared to competitors`,
  schema: churnSchema,
  version: 'v1.0',
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
};
