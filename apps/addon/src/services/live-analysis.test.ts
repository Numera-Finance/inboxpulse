import { describe, it, expect } from 'vitest';
import { parseAnalysis } from './live-analysis';

describe('parseAnalysis', () => {
  it('parses a bare JSON object', () => {
    const r = parseAnalysis('{"sentiment":"negative","reason":"Repeatedly raised, unresolved."}');
    expect(r).toEqual({
      sentiment: 'negative',
      reason: 'Repeatedly raised, unresolved.',
      ephemeral: true,
    });
  });

  it('parses JSON wrapped in a fenced block', () => {
    const r = parseAnalysis('```json\n{"sentiment":"positive","reason":"Thanks given."}\n```');
    expect(r?.sentiment).toBe('positive');
  });

  it('parses JSON preceded by prose', () => {
    const r = parseAnalysis('Sure! Here is the result:\n{"sentiment":"neutral","reason":"Routine."}');
    expect(r?.sentiment).toBe('neutral');
  });

  it('rejects a sentiment outside the allowed set', () => {
    expect(parseAnalysis('{"sentiment":"furious","reason":"x"}')).toBeNull();
  });

  it('rejects output with no JSON at all', () => {
    expect(parseAnalysis('I think this message is negative.')).toBeNull();
  });

  it('rejects malformed JSON', () => {
    expect(parseAnalysis('{"sentiment":"negative", "reason":}')).toBeNull();
  });

  it('substitutes a placeholder when reason is missing', () => {
    expect(parseAnalysis('{"sentiment":"neutral"}')?.reason).toBe('No reason given.');
  });

  it('is case-insensitive on sentiment', () => {
    expect(parseAnalysis('{"sentiment":"NEGATIVE","reason":"x"}')?.sentiment).toBe('negative');
  });
});
