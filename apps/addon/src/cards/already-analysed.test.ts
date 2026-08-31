import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildThreadCard } from './thread';

/**
 * Regression: a message the panel had ALREADY analysed and stored came back with
 * "Read this thread" and "Analyse and save" offered again, every time it was
 * opened.
 *
 * The cause was that the card asked the wrong question. Its only lookup was
 * `resolveThreadByMessage` -> `findByMessageIdsScoped`, which inner-joins
 * `email_participants` on a non-null `customer_id` and the entitlement filter —
 * i.e. "is this a tracked CLIENT thread". But "Analyse and save" is only ever
 * offered on a thread that resolved to NO customer, and `LiveSaveService` writes
 * no participant rows, so the rows that button creates are invisible to the only
 * lookup that could have found them. The answer was structurally always "no".
 *
 * Two halves, and this file covers both, because either alone leaves the bug:
 *   1. the card must RENDER an already-stored reading instead of the buttons;
 *   2. `/gmail/contextual` must actually ask, and must gate `analysisPending` on
 *      the answer — a card that renders correctly from an input nobody sets is
 *      still a card that shows the button.
 */

const flat = (input: Parameters<typeof buildThreadCard>[0]): string =>
  JSON.stringify(buildThreadCard(input));

const PENDING = {
  messageId: 'm1',
  providerThreadId: 't1',
  status: 'untracked' as const,
  baseUrl: 'http://localhost:4005',
};

describe('a message that was already analysed', () => {
  it('offers both buttons when nothing is stored', () => {
    // The control case. Without this the assertions below would pass against a
    // card that never renders the buttons at all, which is not the fix.
    const s = flat({ ...PENDING, analysisPending: true, canSave: true });
    expect(s).toContain('Read this thread');
    expect(s).toContain('Analyse and save');
  });

  it('offers neither once a reading is stored, and says so', () => {
    const s = flat({
      ...PENDING,
      analysisPending: false,
      canSave: false,
      storedAnalysis: { sentiment: 'negative', reason: 'Chasing an unpaid invoice.' },
    });
    expect(s).not.toContain('Analyse and save');
    expect(s).not.toContain('Read this thread');
    // Silence is not the fix. A card that merely drops its controls is
    // indistinguishable from one that failed, and only one of those is fixed by
    // pressing something.
    expect(s).toContain('Already analysed');
    expect(s).toContain('negative');
    expect(s).toContain('Chasing an unpaid invoice.');
  });

  it('reports when it was analysed, as a date rather than a timestamp', () => {
    const s = flat({
      ...PENDING,
      storedAnalysis: {
        sentiment: 'neutral',
        reason: '',
        analysedAt: '2026-04-08T21:03:30.062Z',
      },
    });
    expect(s).toContain('2026-04-08');
    expect(s).not.toContain('21:03:30');
  });

  it('does not claim an analysis it does not have', () => {
    const s = flat({ ...PENDING, analysisPending: true, canSave: true });
    expect(s).not.toContain('Already analysed');
  });
});

/**
 * The wiring half, asserted against the source rather than a mock.
 *
 * A behavioural test here would need the whole Hono app, Gmail credentials and a
 * database. What actually broke was smaller and is checkable directly: the
 * handler has to ASK, and the answer has to gate the branch that sets
 * `analysisPending`. Both are one line, and both were absent.
 */
describe('/gmail/contextual asks the database', () => {
  const src = readFileSync(join(__dirname, '..', 'index.ts'), 'utf8');

  it('looks up a stored reading for the open message', () => {
    expect(src).toContain('findStoredAnalysis(');
  });

  it('gates the analysis branch on the answer', () => {
    // The guard that decides whether the buttons are offered at all. If this
    // stops mentioning `stored`, a saved message is offered for re-analysis
    // again and every assertion above still passes.
    expect(src).toMatch(/if \(!stored && !trend\.length && !flagged\.length/);
  });

  it('asks BEFORE deciding, not after', () => {
    // Order, not presence — the same rule the consent gate follows. A lookup
    // that runs after `analysisPending` is set cannot influence it.
    const lookup = src.indexOf('await findStoredAnalysis(');
    const branch = src.indexOf('if (!stored && !trend.length');
    expect(lookup).toBeGreaterThan(-1);
    expect(branch).toBeGreaterThan(-1);
    expect(lookup).toBeLessThan(branch);
  });
});

/**
 * THE QUESTION HAS TO BE THE NARROW ONE.
 *
 * The first cut of this lookup asked "does this message have a sentiment
 * analysis". Measured on the clone that matched 35,863 rows — the entire
 * analysed corpus — where the number the Save button had actually written was
 * SEVEN. Every message the batch pipeline had ever touched rendered "Already
 * analysed" and lost both of its buttons.
 *
 * `email_analyses.model_used` is the provenance marker LiveSaveService stamps on
 * its own writes and existing corpus rows leave NULL, so it is the difference
 * between the two questions. Asserted against the repository source because the
 * predicate lives in SQL, and a card-level test cannot see it.
 */
describe('the stored-analysis lookup asks only about the panel own writes', () => {
  const repo = readFileSync(
    join(__dirname, '..', '..', '..', 'api', 'src', 'emails', 'repository.ts'),
    'utf8',
  );

  const fn = (): string => {
    const at = repo.indexOf('async findStoredAnalysisByMessageIds(');
    expect(at).toBeGreaterThan(-1);
    return repo.slice(at, repo.indexOf('\n  async ', at + 10));
  };

  it('filters on the panel provenance marker', () => {
    // Drop this line and the button disappears from ~35,000 messages.
    expect(fn()).toContain('isNotNull(emailAnalyses.modelUsed)');
  });

  it('still requires an analysis row at all, not merely a stored email', () => {
    // The other half: a leftJoin here would report every ingested message as
    // analysed, including the ones still queued for the analyser.
    expect(fn()).toContain('innerJoin(emailAnalyses');
    expect(fn()).not.toContain('leftJoin(emailAnalyses');
  });
});
