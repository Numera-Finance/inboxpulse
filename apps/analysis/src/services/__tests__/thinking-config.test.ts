/**
 * Do the Gemini 3 request settings actually reach Gemini, and only Gemini 3?
 *
 * `providerOptions` is a bag the AI SDK hands to the provider. An unrecognised
 * key in it is IGNORED, not rejected — no error, no warning, no compile failure
 * if the object is cast. So a test that only checks "we passed an object to
 * generateObject" passes against a version that sets `thinking_level` or nests
 * it one level wrong, and the service quietly keeps paying for default-level
 * thinking on every email.
 *
 * Same shape as the consent gate in CLAUDE.md: present, called, governing
 * nothing. So the load-bearing assertions here are against the outgoing HTTP
 * body, not against our own return values.
 */
import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { generateObject } from 'ai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_LLM_MODEL, DEFAULT_THINKING_LEVEL } from '@crm/shared';
import {
  isGemini3OrLater,
  providerOptionsFor,
  temperatureFor,
  type AIProvider,
} from '../model-options';

const AI_SERVICE_SOURCE = join(__dirname, '..', 'ai-service.ts');

interface GeminiRequestBody {
  generationConfig?: {
    temperature?: number;
    thinkingConfig?: { thinkingLevel?: string };
  };
}

/** Send one request through the real Google provider and return what went over the wire. */
async function captureGeminiBody(
  model: string,
  extra: { temperature?: number; providerOptions?: Record<string, unknown> }
): Promise<GeminiRequestBody> {
  let captured: GeminiRequestBody | null = null;

  // Capture the outgoing request and abort. We only care what we sent; a faked
  // Gemini response would be a second thing to keep correct.
  const capturingFetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    captured = JSON.parse(String(init?.body)) as GeminiRequestBody;
    throw new Error('captured');
  }) as unknown as typeof fetch;

  const google = createGoogleGenerativeAI({ apiKey: 'test-key', fetch: capturingFetch });

  await expect(
    generateObject({
      model: google(model),
      schema: z.object({ sentiment: z.string() }),
      prompt: 'Judge this email.',
      maxRetries: 0,
      ...(extra as object),
    })
  ).rejects.toThrow();

  if (captured === null) throw new Error('no request was sent');
  return captured;
}

describe('isGemini3OrLater', () => {
  it.each([
    ['gemini-3.5-flash', true],
    ['gemini-3.1-flash-lite', true],
    ['gemini-3-pro-preview', true],
    ['gemini-3', true],
    ['gemini-10-flash', true],
    ['gemini-2.5-flash', false],
    ['gemini-2.0-flash', false],
    ['gemini-flash-lite-latest', false],
    ['gemma-3-27b-it', false],
    ['gpt-4o-mini', false],
  ])('%s → %s', (model, expected) => {
    expect(isGemini3OrLater(model)).toBe(expected);
  });

  it('covers the shipped default, so the settings below apply in production', () => {
    expect(isGemini3OrLater(DEFAULT_LLM_MODEL)).toBe(true);
  });
});

describe('providerOptionsFor', () => {
  it('carries the shared thinking level for Gemini 3', () => {
    const level = providerOptionsFor('google', 'gemini-3.5-flash').providerOptions?.google
      .thinkingConfig?.thinkingLevel;

    expect(level).toBe(DEFAULT_THINKING_LEVEL);
    // Pinned, not just "some level": unset lets Google change it under us, and
    // 'low' left the analysis calls with no reasoning at all (ADR-039). A change
    // here should come with eval numbers, not just an edited constant.
    // (The add-on is not evidence for any level — it deploys reasoning_effort
    // 'none' through the OpenAI-compatible endpoint, a different field.)
    expect(level).toBe('medium');
  });

  it('sends nothing to Google models that do not take thinkingLevel', () => {
    // Unknown model strings route to 'google', and callers can name the model.
    for (const model of ['gemini-2.5-flash', 'gemma-3-27b-it', 'some-unknown-model']) {
      expect(providerOptionsFor('google', model)).toEqual({});
    }
  });

  it('sends nothing for providers that express reasoning differently', () => {
    const nonGoogle: Exclude<AIProvider, 'google'>[] = ['openai', 'anthropic', 'xai'];

    for (const provider of nonGoogle) {
      // Even a Gemini-3-looking name must not leak the option to another provider.
      expect(providerOptionsFor(provider, 'gemini-3.5-flash')).toEqual({});
    }
  });
});

describe('temperatureFor', () => {
  it('omits temperature on Gemini 3 so the model default applies', () => {
    expect(temperatureFor('google', 'gemini-3.5-flash', 0.7)).toEqual({});
  });

  it('keeps the configured temperature everywhere else', () => {
    expect(temperatureFor('google', 'gemini-2.5-flash', 0.3)).toEqual({ temperature: 0.3 });
    expect(temperatureFor('openai', 'gpt-4o-mini', 0.7)).toEqual({ temperature: 0.7 });
    expect(temperatureFor('anthropic', 'gemini-3.5-flash', 0.7)).toEqual({ temperature: 0.7 });
  });

  it('sends nothing when no temperature was configured', () => {
    expect(temperatureFor('openai', 'gpt-4o-mini')).toEqual({});
  });
});

describe('what actually reaches the Gemini request body', () => {
  it('Gemini 3: thinkingLevel present, temperature absent', async () => {
    const model = 'gemini-3.5-flash';
    const body = await captureGeminiBody(model, {
      ...temperatureFor('google', model, 0.7),
      ...providerOptionsFor('google', model),
    });

    // If the SDK had ignored our key this is undefined.
    expect(body.generationConfig?.thinkingConfig?.thinkingLevel).toBe(DEFAULT_THINKING_LEVEL);
    expect(body.generationConfig?.temperature).toBeUndefined();
  });

  it('Gemini 2.5: no thinkingLevel, configured temperature kept', async () => {
    const model = 'gemini-2.5-flash';
    const body = await captureGeminiBody(model, {
      ...temperatureFor('google', model, 0.3),
      ...providerOptionsFor('google', model),
    });

    expect(body.generationConfig?.thinkingConfig).toBeUndefined();
    expect(body.generationConfig?.temperature).toBe(0.3);
  });

  it('negative control: nothing is sent when no options are passed', async () => {
    // Without this the assertions above cannot distinguish "we set it" from
    // "the SDK sends this anyway".
    const body = await captureGeminiBody('gemini-3.5-flash', {});

    expect(body.generationConfig?.thinkingConfig).toBeUndefined();
    expect(body.generationConfig?.temperature).toBeUndefined();
  });
});

describe('every model call in AIService goes through both helpers', () => {
  // Derived, not enumerated: every options object that builds a model must
  // spread both helpers. This finds `generateText` and `generateObject` today
  // and finds a third call added next month without anyone remembering this
  // test exists.
  const source = readFileSync(AI_SERVICE_SOURCE, 'utf-8');
  const optionsBlocks = (source.match(/const \w+Options: any = \{[\s\S]*?\n {8}\};/g) ?? []).filter(
    (block) => block.includes('this.getModel(')
  );

  it('finds the call sites, so the check below is not vacuous', () => {
    expect(optionsBlocks).toHaveLength(2);
  });

  it('spreads providerOptionsFor and temperatureFor, and sets no raw temperature', () => {
    for (const block of optionsBlocks) {
      expect(block, `missing providerOptionsFor:\n${block}`).toContain(
        '...providerOptionsFor(model.provider, model.model)'
      );
      expect(block, `missing temperatureFor:\n${block}`).toContain(
        '...temperatureFor(model.provider, model.model, model.temperature)'
      );
      // A raw `temperature:` line would override the helper when it omits the field.
      expect(block, `raw temperature bypasses temperatureFor:\n${block}`).not.toMatch(
        /^\s*temperature:/m
      );
    }
  });
});
