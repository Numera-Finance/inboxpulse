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

**NEGATIVE** - Dissatisfaction or frustration:
- Complaints or expressions of frustration
- Disappointment with service or product
- Urgency due to problems ("This is unacceptable", "I need this fixed immediately")
- Threats to cancel or escalate
- Sarcasm or passive-aggressive language

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
  version: 'v1.3',
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
Identify if this email contains an upsell opportunity.

Return:
- detected: true if upsell opportunity exists, false otherwise
- confidence: 0-1
- opportunity: description of the upsell opportunity (if detected)
- product: product or service mentioned (if detected)

Upsell indicators:
- Customer asking about premium features
- Interest in higher-tier plans
- Questions about additional products/services
- Mentions of needing more capacity/features`,
  schema: upsellSchema,
  version: 'v1.0',
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
Extract contact information from the "Email Signature" section provided.

Return:
- name: full name (if found)
- title: job title or position (if found)
- company: company name (if found)
- email: email address from signature (if different from sender)
- phone: phone number (if found)
- mobile: mobile/cell number (if found)
- address: physical address (if found)
- website: website URL (if found)
- linkedin: LinkedIn profile URL (if found)
- x: X (formerly Twitter) handle or URL (if found)
- linktree: Linktree profile URL (if found)

IMPORTANT: Only extract from the "Email Signature" section. If no signature section is provided, return empty values.
Do NOT extract information from the email body - only from the signature.`,
  schema: signatureSchema,
  version: 'v1.1',
};

/**
 * Domain Extraction Module (placeholder - handled by DomainExtractionService)
 * Note: Domain extraction doesn't use LLM, it's regex-based
 */
export const domainExtractionModule: AnalysisModule = {
  name: 'domain-extraction',
  description: 'Extract company domains from email addresses',
  instructions: 'Extract company domains from email addresses (handled by DomainExtractionService)',
  schema: z.object({
    domains: z.array(z.object({
      domain: z.string(),
    })),
  }),
  version: 'v1.0',
};

/**
 * Contact Extraction Module (placeholder - handled by ContactExtractionService)
 * Note: Contact extraction doesn't use LLM, it's regex-based
 */
export const contactExtractionModule: AnalysisModule = {
  name: 'contact-extraction',
  description: 'Extract contacts from email addresses',
  instructions: 'Extract contacts from email addresses (handled by ContactExtractionService)',
  schema: z.object({
    contacts: z.array(z.object({
      id: z.string(),
      email: z.string(),
      name: z.string().optional(),
      companyId: z.string().optional(),
    })),
  }),
  version: 'v1.0',
};

/**
 * All analysis modules
 */
export const allModules: AnalysisModule[] = [
  sentimentModule,
  escalationModule,
  upsellModule,
  churnModule,
  kudosModule,
  competitorModule,
  signatureModule,
  domainExtractionModule,
  contactExtractionModule,
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
  'domain-extraction': domainExtractionModule,
  'contact-extraction': contactExtractionModule,
};
