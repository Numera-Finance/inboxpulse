/**
 * Centralized LLM model defaults.
 *
 * Change these in ONE place to upgrade the default model used across all
 * analysis types, thread summarization, and email classification.
 *
 * `gemini-2.5-flash` was retired by Google's preview-model shutdown; the
 * recommended GA target for it is the 3.x flash tier, and we take the
 * like-for-like tier rather than a lite variant on purpose. docs/EXPERIMENTS.md
 * measured 2.5-flash at 95% recall / 66% precision on the complaint set and
 * gemini-3.1-flash-lite at 85% / 71% on the same set: dropping a tier trades
 * away roughly one complaint in seven, which is the signal this pipeline exists
 * to catch. The recall figure is NOT inherited by the new model — it has to be
 * re-measured on the same 49-email set before it is quoted anywhere.
 */

/** Default primary LLM model used for analysis, summarization, and classification. */
export const DEFAULT_LLM_MODEL = 'gemini-3.5-flash';

/** Default fallback LLM model used when the primary model fails. */
export const DEFAULT_LLM_FALLBACK_MODEL = 'gemini-3.5-flash';

/**
 * Thinking level for the Gemini 3.x flash tier, as `thinkingConfig.thinkingLevel`.
 *
 * NOT left unset. The 3.x models are reasoning models that think by default, and
 * thinking is billed as output tokens on top of the latency. `apps/addon/src/env.ts`
 * records the failure mode on a LOCAL reasoning model (nemotron via Ollama, not
 * Gemini): with thinking on, three runs of the deep read ran past 120s and
 * returned nothing. Evidence of the risk, not a Gemini measurement.
 *
 * 'medium', raised from 'low' after the first production calls (ADR-039). On
 * 'low', the long analysis calls — sentiment, churn, upsell, ~6,500 input tokens —
 * reported NO reasoning tokens, where gemini-2.5-flash had used a median of
 * 1,568 on the same calls. Those are the calls that decide whether something is
 * a complaint, and the 95% recall baseline was measured with thinking on.
 *
 * Still not a measured optimum. Run the 49-email complaint set at low / medium /
 * high and keep the cheapest level whose recall matches the old baseline.
 *
 * Google-only. OpenAI and Anthropic express reasoning budgets differently and are
 * left alone by `AIService`.
 */
export const DEFAULT_THINKING_LEVEL = 'medium';
