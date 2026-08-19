import { describe, it, expect } from 'vitest';
import { rankTriage, splitQuiet } from './triage';

const NOW = new Date(2026, 7, 14, 12, 0).getTime();
const H = (n: number) => NOW - n * 3_600_000;
const t = (mode: any, at: number, subject = 's') => ({ threadId: subject, subject, from: 'a@b.com', mode, at });

describe('rankTriage', () => {
  it('puts what decays fastest first', () => {
    // Ordered by what a thread COSTS you to leave, not by how much the panel
    // can say about it.
    const r = rankTriage(
      [t('fyi', H(1), 'fyi'), t('working', H(1), 'work'), t('complaint', H(1), 'complaint'), t('scheduling', H(1), 'sched')],
      NOW,
    );
    expect(r.map((x) => x.mode)).toEqual(['complaint', 'scheduling', 'working', 'fyi']);
  });

  it('within a mode, oldest first', () => {
    // The thing waiting longest is the thing most likely to have been forgotten.
    const r = rankTriage([t('working', H(2), 'new'), t('working', H(40), 'old')], NOW);
    expect(r[0].subject).toBe('old');
  });

  it('reports age in hours', () => {
    expect(rankTriage([t('working', H(5))], NOW)[0].ageHours).toBe(5);
  });

  it('survives a missing timestamp rather than inventing an age', () => {
    expect(rankTriage([t('working', 0)], NOW)[0].ageHours).toBe(0);
  });

  it('gives every item a plain-language reason', () => {
    for (const i of rankTriage([t('complaint', H(1)), t('fyi', H(1))], NOW)) {
      expect(i.why.length).toBeGreaterThan(10);
    }
  });
});

describe('splitQuiet', () => {
  it('separates what needs nothing rather than ranking it last', () => {
    // A queue that ends in twelve notifications is a queue people stop reading.
    const { work, quiet } = splitQuiet(rankTriage([t('fyi', H(1), 'a'), t('complaint', H(1), 'b')], NOW));
    expect(work.map((w) => w.subject)).toEqual(['b']);
    expect(quiet.map((q) => q.subject)).toEqual(['a']);
  });
});
