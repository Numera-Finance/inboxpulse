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
    // The offset is what the SQL supplies. Passing 0 here described a window
    // the extractor never produces, and the assertion only held because the
    // old end-trim took the LAST sentence break in the window.
    const raw = 'an escalation on this thread. While preparing our Series A data room, we found calculation errors in';
    const q = tidyQuote(raw, raw.indexOf('data room'));
    expect(q).toContain('preparing our Series A data room');
    expect(q).not.toContain('an escalation');
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

  /**
   * The four below are the quotes the panel actually rendered on 2026-09-09,
   * with the offset the SQL window produces. Three of five opened mid-sentence
   * or ran into the next message's greeting.
   */
  it('does not open inside the previous sentence', () => {
    // Rendered: "electronically. The consents are in the data room."
    const raw =
      'action is taken by unanimous written consent, signed electronically. The consents are in the data room.';
    const q = tidyQuote(raw, raw.indexOf('data room'));
    expect(q).toBe('The consents are in the data room.');
  });

  it('does not open inside a parenthetical', () => {
    // Rendered: "to be cross-billed) Review the data room shared and revert..."
    const raw = 'the Gusto invoice (to be cross-billed) Review the data room shared and revert for any pending docs';
    const q = tidyQuote(raw, raw.indexOf('data room'));
    expect(q.startsWith('Review the data room')).toBe(true);
    expect(q).not.toContain('cross-billed');
  });

  it('stops where the next message begins', () => {
    // Rendered: "...need your help on the model. Hello @Pritika Sood , Hope you are doing..."
    const raw = 'restarting our Series A in September, need your help on the model. Hello @Pritika Sood, Hope you are doing well';
    const q = tidyQuote(raw, raw.indexOf('restarting our Series'));
    expect(q).toContain('our Series A in September');
    expect(q).not.toMatch(/Hello|Pritika/);
  });

  it('drops a greeting that opens the quote rather than quoting it', () => {
    // Rendered: "Data room requests. Hi Sukrati, Could you please provide..."
    const raw = 'Data room requests. Hi Sukrati, Could you please provide the latest P L statement';
    const q = tidyQuote(raw, raw.indexOf('Data room'));
    expect(q).toBe('Data room requests.');
  });

  it('never moves the start past the evidence', () => {
    // The earlier sentence-start attempt pushed the phrase off the window.
    const raw = 'First sentence here. Second one too. we are raising a bridge round this quarter';
    const q = tidyQuote(raw, raw.indexOf('we are raising'));
    expect(q).toContain('we are raising');
  });

  it('ends at the first sentence break after the evidence, not the last', () => {
    // lastIndexOf ran DeepSource's quote on into the next paragraph:
    // "...in the data room. Decision process: Key decisions are taken jointly..."
    const raw =
      'signed electronically. The consents are in the data room. Decision process: Key decisions are taken jointly.';
    const q = tidyQuote(raw, raw.indexOf('data room'));
    expect(q).toBe('The consents are in the data room.');
  });

  it('cuts a greeting that lands exactly on the floor', () => {
    // A flat floor of 12 blocked this cut at index 12 and rendered
    // "Term Sheet. Hi Sandeep". The floor is now the lead plus the shortest
    // phrase the extractor can match.
    const raw = 'ALP Term Sheet. Hi Sandeep - Thank you for this, we will be in touch';
    const q = tidyQuote(raw, raw.toLowerCase().indexOf('term sheet'));
    expect(q).toBe('Term Sheet.');
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
