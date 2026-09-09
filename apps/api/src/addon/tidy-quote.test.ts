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

/**
 * The extraction picks WHICH phrase by priority, not by position in the text.
 * Structural, on the SQL, because the alternative is a live database.
 */
describe('quote extraction ranks phrases by strength', () => {
  const src = require('node:fs').readFileSync(
    require('node:path').join(__dirname, 'account-context.ts'), 'utf8',
  ) as string;
  const svc = src.slice(src.indexOf('export class CapitalEventsService'));

  it('uses COALESCE, not LEAST', () => {
    // LEAST took the earliest phrase in the body, so SkyCentrics quoted
    // "2910 Convertible Notes" while its subject said "prepare for a financing".
    const window = svc.slice(svc.indexOf('SELECT COALESCE('), svc.indexOf('AS pos'));
    expect(window).toContain('COALESCE(');
    expect(window).not.toContain('LEAST(');
  });

  it('ranks a declaration above a data-room mention, and that above an artifact', () => {
    const window = svc.slice(svc.indexOf('SELECT COALESCE('), svc.indexOf('AS pos'));
    const at = (p: string) => window.indexOf(p);
    expect(at("'prepare for a financing'")).toBeLessThan(at("'data room'"));
    expect(at("'term sheet'")).toBeLessThan(at("'data room'"));
    expect(at("'data room'")).toBeLessThan(at("'convertible note'"));
  });

  it('searches the subject as well as the body', () => {
    // SkyCentrics' evidence is in the subject and its body is bookkeeping.
    expect(svc).toContain("coalesce(e.subject, '') || '. ' || coalesce(e.body, '')");
  });
});
