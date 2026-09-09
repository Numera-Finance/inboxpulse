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
  const table = svc.slice(svc.indexOf('FROM (VALUES'), svc.indexOf('AS p(tier, seq, phrase)'));
  /** Executable SQL only. A `-- LEAST() took the earliest phrase` comment
   *  explains why the mechanism is not that, and must not trip the check. */
  const code = svc.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
  /** The VALUES rows with their explanatory `--` lines removed. */
  const rows = table.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');

  /** Tier for a phrase as the SQL VALUES table declares it. */
  const tierOf = (phrase: string): number => {
    const m = table.match(new RegExp(`\\((\\d+),\\s*\\d+,\\s*'${phrase}'\\)`));
    if (!m) throw new Error(`phrase not in the priority table: ${phrase}`);
    return Number(m[1]);
  };

  it('picks by declared tier, not by position in the body', () => {
    // Position-first quoted "2910 Convertible Notes" from a client whose
    // subject line read "cleaning up cap table to prepare for a financing".
    expect(table).toContain('FROM (VALUES');
    expect(svc).toContain('ORDER BY p.tier, p.seq');
    expect(code).not.toContain('LEAST(');
  });

  it('ranks a declaration above a term sheet, above a data room, above an artifact', () => {
    expect(tierOf('we are raising')).toBeLessThan(tierOf('term sheet'));
    expect(tierOf('term sheet')).toBeLessThan(tierOf('data room'));
    expect(tierOf('data room')).toBeLessThan(tierOf('convertible note'));
  });

  it('breaks within-tier ties deterministically', () => {
    // Without seq, two phrases of equal tier resolve arbitrarily and the quote
    // a row shows can change between runs on unchanged data.
    const seqs = [...table.matchAll(/\(\s*\d+,\s*(\d+),/g)].map((m) => Number(m[1]));
    expect(seqs.length).toBeGreaterThan(10);
    expect(new Set(seqs).size).toBe(seqs.length);
  });

  it('orders rows by evidence strength before recency', () => {
    const order = svc.slice(svc.indexOf('ORDER BY coalesce(hit.tier'));
    const tierAt = order.indexOf('hit.tier');
    const dateAt = order.indexOf('received_at');
    expect(tierAt).toBeGreaterThan(-1);
    expect(dateAt).toBeGreaterThan(tierAt);
  });

  it('keeps a row whose phrase falls outside the searched window', () => {
    // A CROSS JOIN drops the row entirely when no phrase matches; the panel
    // then silently shows fewer clients than the signal found.
    expect(svc).toContain('LEFT JOIN LATERAL');
    expect(svc).toContain('coalesce(hit.tier, 9)');
    expect(svc).toContain('coalesce(hit.pos, 1)');
  });

  it('matches on word boundaries, not substrings', () => {
    // "your series b" contains 'our series b'. position() matched it, so an
    // auditor's document-request thread was ranked as a declaration and took
    // two of the five rows above a client who had said they were raising.
    expect(code).not.toContain('position(p.phrase');
    expect(code).toContain('regexp_instr');
    expect(code).toContain("'(^|[^a-z0-9])(' || p.phrase || ')([^a-z0-9]|$)'");
    expect(code).toContain("~ ('(^|[^a-z0-9])' || p.phrase || '([^a-z0-9]|$)')");
  });

  it('spells out the fundraise words instead of a stem', () => {
    // A right-hand boundary rejects the stem 'fundrais', so it would never fire.
    expect(rows).not.toContain("'fundrais'");
    expect(rows).toContain("'fundraise'");
    expect(rows).toContain("'fundraising'");
  });

  it('searches the subject as well as the body', () => {
    expect(svc).toContain("coalesce(e.subject, '') || '. ' || coalesce(e.body, '')");
  });
});
