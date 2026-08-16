import { z } from 'zod';

/**
 * Optional field for LLM structured output.
 *
 * Module instructions tell the model to return null for absent fields, but
 * z.optional() only accepts a MISSING key — a literal null failed validation,
 * which rejected the entire (batched) analysis object and triggered the full
 * retry/fallback chain. Accept null and normalize to undefined so downstream
 * types are unchanged.
 */
function llmOptional<T extends z.ZodTypeAny>(schema: T) {
  return schema
    .nullish()
    .transform((v): z.infer<T> | undefined => v ?? undefined);
}

/**
 * Optional signature field: like llmOptional, but also strips the literal
 * strings "null" / "n/a" / "" that models emit for absent signature fields.
 */
function signatureField() {
  return z
    .string()
    .nullish()
    .transform((v): string | undefined => {
      if (!v) return undefined;
      const trimmed = v.trim();
      if (trimmed === '' || /^(null|none|n\/a)$/i.test(trimmed)) return undefined;
      return trimmed;
    });
}

/**
 * Sentiment Analysis Schema
 */
export const sentimentSchema = z.object({
  value: z.enum(['positive', 'negative', 'neutral']),
  confidence: z.number().min(0).max(1),
  reason: llmOptional(z.string()),
});

export type SentimentResult = z.infer<typeof sentimentSchema>;

/**
 * Escalation Detection Schema
 */
export const escalationSchema = z.object({
  detected: z.boolean(),
  confidence: z.number().min(0).max(1),
  reason: llmOptional(z.string()),
  urgency: llmOptional(z.enum(['low', 'medium', 'high', 'critical'])),
});

export type EscalationResult = z.infer<typeof escalationSchema>;

/**
 * Upsell Detection Schema
 */
export const upsellSchema = z.object({
  detected: z.boolean(),
  confidence: z.number().min(0).max(1),
  opportunity: llmOptional(z.string()), // Description of the upsell opportunity
  product: llmOptional(z.string()), // Product/service mentioned
});

export type UpsellResult = z.infer<typeof upsellSchema>;

/**
 * Churn Risk Schema
 */
export const churnSchema = z.object({
  /**
   * 'none' exists because its absence made this field meaningless.
   *
   * The enum was low|medium|high|critical, so the model had no way to say "no
   * churn risk in this email" — the floor was 'low'. It duly returned 'low' for
   * 29,312 of 33,497 assessments, 87% of all mail, including invoice reminders
   * and scheduling notes. That was not a judgement about the customer; it was
   * the shape of the enum.
   */
  riskLevel: z.enum(['none', 'low', 'medium', 'high', 'critical']),
  confidence: z.number().min(0).max(1),
  indicators: z.array(z.string()).describe('Specific phrases or behaviors indicating churn risk'),
  reason: llmOptional(z.string()),
});

export type ChurnResult = z.infer<typeof churnSchema>;

/**
 * Kudos Detection Schema
 */
export const kudosSchema = z.object({
  detected: z.boolean(),
  confidence: z.number().min(0).max(1),
  message: llmOptional(z.string()), // The positive feedback message
  category: llmOptional(z.enum(['product', 'service', 'team', 'other'])),
});

export type KudosResult = z.infer<typeof kudosSchema>;

/**
 * Competitor Mention Schema
 */
export const competitorSchema = z.object({
  detected: z.boolean(),
  confidence: z.number().min(0).max(1),
  competitors: llmOptional(z.array(z.string())), // List of competitor names mentioned
  context: llmOptional(z.string()), // How competitors were mentioned
});

export type CompetitorResult = z.infer<typeof competitorSchema>;

/**
 * Signature Extraction Schema (already exists, re-export for consistency)
 * Note: This matches the schema in signature-extraction.ts
 */
export const signatureSchema = z.object({
  name: signatureField(),
  title: signatureField(),
  company: signatureField(),
  // Intentionally NOT z.string().email(): a malformed extraction (e.g.
  // "john [at] acme.com") must not reject the entire analysis batch.
  email: signatureField(),
  phone: signatureField(),
  mobile: signatureField(),
  address: signatureField(),
  website: signatureField(),
  linkedin: signatureField(),
  x: signatureField(),
  linktree: signatureField(),
});

export type SignatureResult = z.infer<typeof signatureSchema>;

/**
 * Context Search String Schema
 *
 * `query` is emitted verbatim into a Gmail search box, so it is stored as the
 * single string the model produced rather than decomposed into operands — the
 * consumer's job is to run it, not to rebuild it.
 *
 * `intent` is the scoring target for reranking. Retrieval happens later and
 * live, so the candidates cannot be ranked at analysis time — but what makes a
 * candidate good is a property of THIS email and is knowable now. Ordering
 * matters: `intent` is declared first so the model settles what it is looking
 * for before writing the query meant to find it.
 */
export const contextSearchStringSchema = z.object({
  intent: z.string(),
  query: z.string(),
  confidence: z.number().min(0).max(1),
});

export type ContextSearchStringResult = z.infer<typeof contextSearchStringSchema>;

/**
 * Map of analysis type to schema for easy lookup
 */
export const analysisSchemas = {
  'sentiment': sentimentSchema,
  'escalation': escalationSchema,
  'upsell': upsellSchema,
  'churn': churnSchema,
  'kudos': kudosSchema,
  'competitor': competitorSchema,
  'signature-extraction': signatureSchema,
  'context-search-string': contextSearchStringSchema,
} as const;

/**
 * Helper to get schema by analysis type
 */
export function getAnalysisSchema(type: keyof typeof analysisSchemas): z.ZodSchema<any> {
  const schema = analysisSchemas[type];
  if (!schema) {
    throw new Error(`No schema found for analysis type: ${type}`);
  }
  return schema;
}
