// tsyringe decorators in account-context.ts need the polyfill at load time.
import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import { tidyQuote } from './account-context';

/**
 * The tails here are real, taken from the quotes the extraction produced
 * against production mail. The panel column is about 250px, so a quote that
 * runs into a signature block costs the row its meaning.
 */
describe('tidyQuote', () => {
  it('drops a sign-off and the signature behind it', () => {
    const q = tidyQuote('merchant valuation report for Sep 2025 in our Data Room. Regards, Himanshu Email ID: hsriv');
    expect(q).toContain('in our Data Room');
    expect(q).not.toMatch(/Regards|Email ID|hsriv/);
  });

  it('keeps the sentence that carries the evidence', () => {
    const q = tidyQuote('an escalation on this thread. While preparing our Series A data room, we found calculation errors in');
    expect(q).toContain('preparing our Series A data room');
  });

  it('does not cut on a sign-off word that opens the quote', () => {
    // "best" at position 0 is part of the sentence, not a sign-off.
    const q = tidyQuote('best case we close the round in March and the data room is ready');
    expect(q).toContain('data room');
  });

  it('breaks on a word, never mid-word', () => {
    const long = 'we are updating our 2025 data room and need the December reconciliation schedules before the buyer diligence call on Thursday afternoon';
    const q = tidyQuote(long);
    expect(q.length).toBeLessThanOrEqual(97);
    // The last token is either whole or the ellipsis.
    expect(q.replace('…', '').trim()).toMatch(/\w$/);
    expect(long).toContain(q.replace('…', '').trim());
  });

  it('returns empty for empty, so the caller can fall back to the subject', () => {
    expect(tidyQuote('')).toBe('');
    expect(tidyQuote('   ')).toBe('');
  });
});
