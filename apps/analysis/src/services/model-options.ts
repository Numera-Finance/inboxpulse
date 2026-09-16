import type { GoogleGenerativeAIProviderOptions } from '@ai-sdk/google';
import { DEFAULT_THINKING_LEVEL } from '@crm/shared';

/**
 * Supported AI providers
 */
export type AIProvider = 'openai' | 'anthropic' | 'google' | 'xai';

/**
 * Per-model request settings, kept apart from `AIService` on purpose.
 *
 * `AIService` pulls in tsyringe, Langfuse and the env loader, so the cache
 * diagnostic script could not import these helpers from there. It has to send
 * exactly what the pipeline sends, or it measures a different request.
 */

/**
 * True for Gemini 3 and later, the families that take `thinkingLevel` and are
 * tuned for the default temperature.
 *
 * Decided by MODEL, not provider. Unknown model strings are routed to Google by
 * `executor.parseModelString` and the `/summarize` route, and both accept a
 * caller-supplied model, so "provider is google" also covers `gemini-2.5-*`
 * (which takes `thinkingBudget`, not `thinkingLevel`) and Gemma.
 */
export function isGemini3OrLater(model: string): boolean {
  const match = /^gemini-(\d+)(?:[.-]|$)/.exec(model);
  return match !== null && Number(match[1]) >= 3;
}

/**
 * Request options that belong to one provider rather than to the AI SDK core.
 *
 * Gemini 3.x thinks by default and bills it as output tokens, so the budget is
 * set explicitly rather than inherited. Spread into BOTH `generateText` and
 * `generateObject` — the same decision written twice is the one that drifts.
 *
 * An unrecognised `providerOptions` key is silently IGNORED by the SDK rather
 * than rejected, so a typo here would cost nothing at compile time and
 * everything at run time. That is why `thinking-config.test.ts` asserts against
 * the outgoing HTTP body and not against this return value alone.
 */
export function providerOptionsFor(
  provider: AIProvider,
  model: string
): { providerOptions?: { google: GoogleGenerativeAIProviderOptions } } {
  if (provider !== 'google' || !isGemini3OrLater(model)) return {};
  return {
    providerOptions: {
      google: { thinkingConfig: { thinkingLevel: DEFAULT_THINKING_LEVEL } },
    },
  };
}

/**
 * The sampling temperature to send, or nothing.
 *
 * Google's guidance for Gemini 3 is to leave temperature at its default of 1.0:
 * lower values can make the model loop or reason worse. The executor hardcodes
 * 0.7 and summarisation and the email filter use 0.3 — values chosen for 2.x —
 * so for Gemini 3 and later the field is omitted and the model default applies.
 * Other models keep the configured value. Unmeasured on our mail, like the
 * thinking level.
 */
export function temperatureFor(
  provider: AIProvider,
  model: string,
  temperature?: number
): { temperature?: number } {
  if (provider === 'google' && isGemini3OrLater(model)) return {};
  return temperature === undefined ? {} : { temperature };
}
