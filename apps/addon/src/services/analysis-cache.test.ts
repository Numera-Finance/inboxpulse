import { describe, it, expect } from 'vitest';
import { AnalysisCache } from './analysis-cache';
import { mkdtempSync, existsSync, readdirSync, readFileSync } from 'node:fs';

const K = (over: Partial<Parameters<typeof AnalysisCache.key>[0]> = {}) =>
  AnalysisCache.key({ threadId: 't1', viewerEmail: 'a@b.com', count: 3, latestMessageId: 'm3', ...over });

describe('AnalysisCache', () => {
  it('returns a cached reading for an unchanged thread', () => {
    const c = new AnalysisCache<string>();
    c.set(K(), 'reading');
    expect(c.get(K())).toBe('reading');
    expect(c.stats().hits).toBe(1);
  });

  it('misses when a new message arrives', () => {
    // A stale reading is worse than a slow one: "3 questions unanswered" is a
    // claim about a conversation that has since moved on.
    const c = new AnalysisCache<string>();
    c.set(K(), 'reading');
    expect(c.get(K({ count: 4, latestMessageId: 'm4' }))).toBeNull();
  });

  it('misses when a message is deleted, leaving the latest id unchanged', () => {
    const c = new AnalysisCache<string>();
    c.set(K(), 'reading');
    expect(c.get(K({ count: 2 }))).toBeNull();
  });

  it('never serves one viewer the analysis built for another', () => {
    // Account history is entitlement-scoped, so a shared entry would leak one
    // viewer's context to the other.
    const c = new AnalysisCache<string>();
    c.set(K(), 'mine');
    expect(c.get(K({ viewerEmail: 'other@b.com' }))).toBeNull();
  });

  it('is case-insensitive on the viewer address', () => {
    const c = new AnalysisCache<string>();
    c.set(K(), 'mine');
    expect(c.get(K({ viewerEmail: 'A@B.com' }))).toBe('mine');
  });

  it('expires entries', () => {
    let t = 0;
    const c = new AnalysisCache<string>(1000, 300, () => t);
    c.set(K(), 'reading');
    t = 999;
    expect(c.get(K())).toBe('reading');
    t = 1001;
    expect(c.get(K())).toBeNull();
  });

  it('stays bounded, evicting the least recently used', () => {
    const c = new AnalysisCache<string>(60_000, 3);
    for (const id of ['a', 'b', 'c']) c.set(K({ threadId: id }), id);
    c.get(K({ threadId: 'a' }));          // 'a' becomes most recent, 'b' now oldest
    c.set(K({ threadId: 'd' }), 'd');
    expect(c.stats().entries).toBe(3);
    expect(c.get(K({ threadId: 'b' }))).toBeNull();
    expect(c.get(K({ threadId: 'a' }))).toBe('a');
  });

});

/**
 * There is no disk path to disable, because there is no disk path.
 *
 * The cache could persist to disk behind ADDON_CACHE_DIR, unset in production.
 * Two reviewers made the same objection independently and both were right:
 * "my mail CAN be written to disk, and the difference between can and does is
 * one setting, flipped by one of four people, with no consent screen" and
 * "unset today is not absent — delete the code path".
 *
 * An unset environment variable is a promise about configuration. Deleting the
 * branch is a property of the software, which is the only kind of assurance
 * worth printing on a page.
 */
describe('no persistence', () => {
  it('imports nothing from node:fs', async () => {
    const src = await import('node:fs').then(() => null).catch(() => null);
    void src;
    const text = await import('node:fs/promises').then((m) =>
      m.readFile(new URL('./analysis-cache.ts', import.meta.url), 'utf8'),
    );
    expect(text).not.toContain('node:fs');
    expect(text).not.toContain('writeFileSync');
    expect(text).not.toContain('ADDON_CACHE_DIR');
  });
});
