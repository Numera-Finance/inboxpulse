import { describe, it, expect } from 'vitest';
import { isRealCommitment, filterCommitments, PLEASANTRY } from './commitments';

const c = (quote: string, what = 'something') => ({ what, quote });

describe('isRealCommitment', () => {
  it('rejects the live false positive that prompted this', () => {
    // Rendered on a real thread as "Manish Balsara — meet and learn from them".
    // Nobody undertook anything.
    expect(isRealCommitment(c('We should meet and learn from them.'))).toBe(false);
  });

  it('rejects suggestions in their usual disguises', () => {
    for (const q of [
      "Let's schedule a brief call next week.",
      'It would be good to get the Blitzz team involved.',
      'Maybe we look at the reporting side first.',
      'You should probably loop in engineering.',
      'Could we get a firm date on this?',
      'Worth exploring whether the agents angle applies.',
    ]) {
      expect(isRealCommitment(c(q)), q).toBe(false);
    }
  });

  it('keeps real undertakings', () => {
    for (const q of [
      "I'll send over the reconciliation log by Friday so you can see the scale of it.",
      'I will get you a firm date by Tuesday and will loop in our engineering lead.',
      'We are putting together the revised SOW this week.',
      'I plan to have the migration done before the sprint closes.',
      'Sending the deck across by end of day.',
    ]) {
      expect(isRealCommitment(c(q)), q).toBe(true);
    }
  });

  it('keeps an undertaking even when it is phrased around a suggestion', () => {
    // "we should" appears, but the speaker also committed. Undertaking wins.
    expect(
      isRealCommitment(c("We should get this closed out, so I'll send the summary tomorrow.")),
    ).toBe(true);
  });

  it('rejects pleasantries — the live failure on a thank-you thread', () => {
    // These rendered under "Who owes what" against two named people on a note
    // that was pure appreciation. Neither is a suggestion, so the original
    // absence-of-suggestion rule accepted both.
    for (const q of [
      'And honestly, this is just the beginning, I can\u2019t wait to carry this trend forward across everything we do together.',
      'This is just the beginning, and we look forward to carrying this momentum forward and creating even more impactful experiences together.',
      'We are really excited about what we\u2019ve built so far.',
      'Thank you again for the appreciation\u2014it means a lot to all of us!',
      'I am just really proud of what this team has achieved!',
    ]) {
      expect(isRealCommitment(c(q)), q).toBe(false);
      expect(PLEASANTRY.some((re) => re.test(q)), `PLEASANTRY should recognise: ${q}`).toBe(true);
    }
  });

  it('requires a positive undertaking, not merely the absence of a suggestion', () => {
    // The space of things that are NOT commitments is unbounded, so it cannot be
    // enumerated — only a positive test holds.
    expect(isRealCommitment(c('The weather in Denver was terrible last week.'))).toBe(false);
    expect(isRealCommitment(c('BookWise went live on Tuesday.'))).toBe(false);
  });

  it('fails closed when there is no quote to check', () => {
    // An unverifiable claim that a named person owes something is exactly what
    // this gate exists to stop.
    expect(isRealCommitment({ what: 'send the report' })).toBe(false);
    expect(isRealCommitment({ what: 'send the report', quote: '  ' })).toBe(false);
  });

  it('filters a list', () => {
    const kept = filterCommitments([
      c('We should meet and learn from them.'),
      c("I'll send the log by Friday."),
    ]);
    expect(kept).toHaveLength(1);
  });
});
