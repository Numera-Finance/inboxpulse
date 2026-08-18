import { describe, expect, it } from 'vitest';
import { checkQuotes } from './quotes';

describe('checkQuotes', () => {
  it('keeps a quotation the sender actually wrote', () => {
    const r = checkQuotes(
      `The client says "this is not good enough" about the March close.`,
      '<div>Honestly this is not good enough for a March close.</div>',
    );
    expect(r.text).toContain('"this is not good enough"');
    expect(r.fabricated).toHaveLength(0);
  });

  it('demotes a quotation the sender never wrote', () => {
    // 30% of stored reasonings quote a phrase that is not in the email. On a
    // surface meant to teach the register, a studied phrase that was never there
    // is the worst available error.
    const r = checkQuotes(
      `The client says "you have completely failed us" here.`,
      'I would appreciate an update when you have a moment.',
    );
    expect(r.text).toBe('The client says you have completely failed us here.');
    expect(r.fabricated).toEqual(['you have completely failed us']);
  });

  it('sees through markup and entities', () => {
    const r = checkQuotes(
      `They wrote "it isn't reconciled".`,
      "<p>Frankly it isn&#39;t reconciled and hasn&rsquo;t been for weeks.</p>",
    );
    expect(r.fabricated).toHaveLength(0);
  });

  it('accepts a quote that trails off, since the model clips mid-sentence', () => {
    const r = checkQuotes(
      `They note "the VAT line is still wrong and..." in passing.`,
      'the VAT line is still wrong and nobody has looked at it',
    );
    expect(r.fabricated).toHaveLength(0);
  });

  it('handles curly quotes, which Gmail emits constantly', () => {
    const r = checkQuotes('They said “not good to have so many iterations”.', 'Not good to have so many iterations.');
    expect(r.fabricated).toHaveLength(0);
  });

  it('leaves reasoning without quotations untouched', () => {
    const plain = 'The client is chasing an overdue reconciliation for the third time.';
    expect(checkQuotes(plain, 'any body').text).toBe(plain);
  });

  it('does not choke on an empty or missing body', () => {
    const r = checkQuotes('They said "something".', '');
    expect(r.text).toBe('They said something.');
  });

  it('ignores spans too short to be a meaningful citation', () => {
    // Apostrophes and stray marks in ordinary prose are not quotations.
    const r = checkQuotes(`It's a 'fee' question.`, 'unrelated body');
    expect(r.fabricated).toHaveLength(0);
  });
});
