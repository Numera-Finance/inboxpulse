/**
 * Verify whether Gemini caching is happening for our analyses pipeline.
 *
 * Strategy: build a prompt with the same shape `executeBatchCall` builds
 * (long static instructions + dynamic email body), call Gemini twice with
 * the SAME instructions but different bodies, and inspect `usage.cachedInputTokens`
 * on each response.
 *
 * Expected behavior:
 *   - Call 1: cachedInputTokens = 0 or undefined (first time, nothing cached)
 *   - Call 2: cachedInputTokens > 0 if Gemini implicit caching is active
 *
 * Run from apps/analysis:
 *   bun --env-file=.env.local run check-gemini-cache.ts
 */
import { generateObject } from 'ai';
import { google } from '@ai-sdk/google';
import { z } from 'zod';

// Mirror the prompt structure of executeBatchCall: long combined instructions,
// then per-email content. Keep instructions chunky (>1024 tokens) so the
// implicit cache is theoretically eligible.
const STATIC_INSTRUCTIONS = `
## Sentiment Analysis
Analyze the emotional tone of this email from a customer relationship perspective.
Return value (positive|negative|neutral) and confidence (0-1).
Default to NEUTRAL. The vast majority of business emails (95%+) are NEUTRAL.
Only classify as POSITIVE when the PRIMARY PURPOSE of the email is to express
genuine satisfaction, praise, or heartfelt gratitude — not as a side effect of
politeness. NEGATIVE = dissatisfaction, frustration, complaint, urgency due to
problems, threats to cancel, sarcasm/passive-aggressive language.

## Escalation Detection
Determine if the email requires escalation to management or specialized support.
Return detected (bool), confidence (0-1), urgency (low|medium|high|critical),
reason (brief explanation if detected). Indicators: explicit threats to escalate,
legal language, requests for management contact, repeat-of-prior-issue framing,
deadlines being missed, expressions of severe dissatisfaction. Avoid false
positives on routine status updates or polite urgency markers.

## Upsell Detection
Detect opportunities for upsell or cross-sell. Return detected (bool),
confidence (0-1), opportunity description (brief), product (specific name if
mentioned). Indicators: explicit interest in additional services, questions
about plan upgrades or expanded scope, mentions of new business needs that
align with our offerings, growth signals (hiring, expansion, new initiatives).

## Churn Risk
Assess risk of customer churn. Return riskLevel (low|medium|high|critical),
confidence, indicators (array of brief strings), reason. Indicators: explicit
mentions of competitors being evaluated, dissatisfaction with pricing, lack of
engagement signals, repeated unresolved issues, contract negotiation friction,
team turnover hints, talk of "review" or "evaluation" of vendor.

## Kudos Detection
Detect explicit praise or positive feedback. Return detected (bool), confidence,
message (the praise text if detected), category (product|service|team|other).
Only fire when the praise is concrete and actionable for an account team to
forward — not generic politeness.

## Competitor Mentions
Identify mentions of competitor products or services. Return detected (bool),
confidence, competitors (array of names), context (how they were mentioned).
Be precise — only flag actual product/company competitors, not general industry
references.

## Signature Extraction
Extract structured contact info from any signature in the email body. Return
name, title, company, email, phone, mobile, address, website, linkedin, x,
linktree. Omit any field not clearly present. Do not invent or guess. If the
signature appears to belong to someone other than the sender (e.g., embedded
forwarded message), return all fields as null.
`.trim();

const SCHEMA = z.object({
  sentiment: z.object({
    value: z.enum(['positive', 'negative', 'neutral']),
    confidence: z.number(),
  }),
});

async function call(label: string, body: string) {
  const prompt = `${STATIC_INSTRUCTIONS}\n\nEmail Subject: Quarterly check-in\n\nEmail Body:\n${body}`;
  const before = Date.now();
  const result = await generateObject({
    model: google('gemini-2.5-pro'),
    schema: SCHEMA,
    prompt,
    temperature: 0.1,
  });
  const ms = Date.now() - before;

  console.log(`\n=== ${label} ===`);
  console.log(`latency: ${ms}ms`);
  console.log(`prompt chars: ${prompt.length}  (~${Math.round(prompt.length / 4)} tokens)`);
  console.log('usage:', JSON.stringify(result.usage, null, 2));
  console.log('providerMetadata:', JSON.stringify((result as any).providerMetadata, null, 2));
  console.log('experimental_providerMetadata:', JSON.stringify((result as any).experimental_providerMetadata, null, 2));
  console.log('object:', JSON.stringify(result.object, null, 2));
  return result;
}

async function main() {
  console.log('Static instructions length:', STATIC_INSTRUCTIONS.length, 'chars');
  console.log('Approx tokens (chars/4):', Math.round(STATIC_INSTRUCTIONS.length / 4));

  // Same instructions, different body — implicit caching should pick up the prefix.
  await call(
    'CALL 1 (cold)',
    'Hi team, just checking in on Q1 numbers. Can you send the latest report when you have a chance? Thanks, Alex.',
  );

  // Wait briefly so Gemini has a chance to register the cache (TTL is several minutes).
  await new Promise((r) => setTimeout(r, 1500));

  await call(
    'CALL 2 (same prefix, different body)',
    'Hi team, following up on the quarterly review. Could you also share the projections for Q2? Appreciate it, Alex.',
  );

  await new Promise((r) => setTimeout(r, 1500));

  await call(
    'CALL 3 (same prefix, third body)',
    'Hi team, one more thing — please loop in Sara when you reply, she has questions about the budget. Thanks, Alex.',
  );

  console.log('\nIf cachedInputTokens > 0 on call 2 or 3, implicit caching is active.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
