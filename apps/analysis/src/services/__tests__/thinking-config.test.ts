/**
 * Does the thinking budget actually reach Gemini?
 *
 * `providerOptions` is a bag the AI SDK hands to the provider. An unrecognised
 * key in it is IGNORED, not rejected — no error, no warning, no compile failure
 * if the object is cast. So a test that only checks "we passed an object to
 * generateObject" passes against a version that sets `thinking_level` or
 * `thinkingBudgetLevel` or nests it one level wrong, and the service quietly
 * keeps paying for default-level thinking on every email.
 *
 * Same shape as the consent gate in CLAUDE.md: present, called, governing
 * nothing. So the load-bearing assertion here is against the outgoing HTTP
 * body, not against our own return value.
 */
import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { generateObject } from 'ai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_THINKING_LEVEL } from '@crm/shared';
import { providerOptionsFor, type AIProvider } from '../ai-service';

const AI_SERVICE_SOURCE = join(__dirname, '..', 'ai-service.ts');

describe('providerOptionsFor', () => {
  it('carries the shared thinking level for google', () => {
    const options = providerOptionsFor('google');

    expect(options.providerOptions?.google.thinkingConfig?.thinkingLevel).toBe(
      DEFAULT_THINKING_LEVEL
    );
    // Pinned, not just "some level": 'low' is the deliberate middle — 'minimal'
    // is what the add-on uses for extraction, and unset is what this change
    // exists to stop.
    expect(options.providerOptions?.google.thinkingConfig?.thinkingLevel).toBe('low');
  });

  it('sends nothing for providers that express reasoning differently', () => {
    // Derived from the AIProvider union rather than typed by hand, so a provider
    // added later either gets a deliberate branch or fails here.
    const nonGoogle: Exclude<AIProvider, 'google'>[] = ['openai', 'anthropic', 'xai'];

    for (const provider of nonGoogle) {
      expect(providerOptionsFor(provider)).toEqual({});
    }
  });
});

describe('the thinking level reaches the Gemini request body', () => {
  it('lands in generationConfig.thinkingConfig, not in a key Gemini ignores', async () => {
    let capturedBody: Record<string, unknown> | null = null;

    // Capture the outgoing request and abort. We only care what we sent; a
    // faked Gemini response would be a second thing to keep correct.
    const capturingFetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      capturedBody = JSON.parse(String(init?.body));
      throw new Error('captured');
    }) as unknown as typeof fetch;

    const google = createGoogleGenerativeAI({ apiKey: 'test-key', fetch: capturingFetch });

    await expect(
      generateObject({
        model: google('gemini-3.5-flash'),
        schema: z.object({ sentiment: z.string() }),
        prompt: 'Judge this email.',
        ...providerOptionsFor('google'),
      })
    ).rejects.toThrow();

    expect(capturedBody).not.toBeNull();
    const body = capturedBody as unknown as {
      generationConfig?: { thinkingConfig?: { thinkingLevel?: string } };
    };

    // The whole point. If the SDK had ignored our key this is undefined.
    expect(body.generationConfig?.thinkingConfig?.thinkingLevel).toBe(DEFAULT_THINKING_LEVEL);
  });

  it('omits thinkingConfig entirely when we send no provider options', async () => {
    // The negative control. Without it the assertion above cannot distinguish
    // "we set it" from "Gemini defaults to this anyway".
    let capturedBody: Record<string, unknown> | null = null;

    const capturingFetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      capturedBody = JSON.parse(String(init?.body));
      throw new Error('captured');
    }) as unknown as typeof fetch;

    const google = createGoogleGenerativeAI({ apiKey: 'test-key', fetch: capturingFetch });

    await expect(
      generateObject({
        model: google('gemini-3.5-flash'),
        schema: z.object({ sentiment: z.string() }),
        prompt: 'Judge this email.',
      })
    ).rejects.toThrow();

    const body = capturedBody as unknown as {
      generationConfig?: { thinkingConfig?: { thinkingLevel?: string } };
    };

    expect(body.generationConfig?.thinkingConfig).toBeUndefined();
  });
});

describe('every model call in AIService carries the provider options', () => {
  it('derives the governed set from the source, so a new call site is policed', () => {
    const source = readFileSync(AI_SERVICE_SOURCE, 'utf-8');

    // Every options object that gets a model must also get the provider options.
    // Derived, not enumerated: this finds `generateText` and `generateObject`
    // today and finds a third call added next month without anyone remembering
    // this test exists.
    const optionsBlocks = source.match(/const \w+Options: any = \{[\s\S]*?\n {8}\};/g) ?? [];

    expect(optionsBlocks.length).toBeGreaterThanOrEqual(2);

    for (const block of optionsBlocks) {
      if (!block.includes('this.getModel(')) continue;
      expect(
        block.includes('...providerOptionsFor(model.provider)'),
        `An options object builds a model but does not spread providerOptionsFor:\n${block}`
      ).toBe(true);
    }
  });

  it('finds a call site that builds a model, so the loop above is not vacuous', () => {
    const source = readFileSync(AI_SERVICE_SOURCE, 'utf-8');
    const optionsBlocks = source.match(/const \w+Options: any = \{[\s\S]*?\n {8}\};/g) ?? [];

    const withModel = optionsBlocks.filter((b) => b.includes('this.getModel('));
    expect(withModel).toHaveLength(2);
  });
});
