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

CRITICAL: Default to NEUTRAL. Only classify as POSITIVE when there is EXPLICIT emotional language expressing genuine satisfaction, delight, or heartfelt gratitude.

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

**POSITIVE** - Genuine satisfaction or praise (REQUIRES EXPLICIT EMOTIONAL LANGUAGE):
- Must contain words expressing genuine emotion: "happy", "delighted", "grateful", "impressed", "amazing", "fantastic", "love", "thrilled", "excellent"
- Expressions of happiness or delight ("I'm so happy with...", "This is amazing!")
- Compliments about service or product ("Your team has been fantastic")
- Heartfelt gratitude beyond routine politeness ("I really appreciate all the extra effort", "Grateful to be working together")
- Testimonials or recommendations
- Relief after problem resolution WITH expressed satisfaction

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

EXAMPLES - Classify as POSITIVE:
- "Grateful to be working together!" → POSITIVE (explicit gratitude)
- "Your team has been fantastic, thank you so much!" → POSITIVE (praise + enthusiasm)
- "I'm really happy with how this turned out" → POSITIVE (explicit happiness)
- "This is exactly what we needed, amazing work!" → POSITIVE (enthusiasm + praise)

Remember: "Thank you" alone is NEVER sufficient for positive. Scheduling a meeting is NEVER positive. Simple agreements are NEVER positive.`,
  schema: sentimentSchema,
  version: 'v1.2',
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
