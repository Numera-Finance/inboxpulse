/**
 * Centralized LLM model defaults.
 *
 * Change these in ONE place to upgrade the default model used across all
 * analysis types, thread summarization, and email classification.
 */

/** Default primary LLM model used for analysis, summarization, and classification. */
export const DEFAULT_LLM_MODEL = 'gemini-3-flash-preview';

/** Default fallback LLM model used when the primary model fails. */
export const DEFAULT_LLM_FALLBACK_MODEL = 'gemini-2.0-flash-lite';
