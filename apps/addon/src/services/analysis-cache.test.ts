import { describe, it, expect } from 'vitest';
import { AnalysisCache } from './analysis-cache';
import { mkdtempSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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

  describe('disk backing', () => {
    const dir = () => mkdtempSync(join(tmpdir(), 'ac-'));

    it('survives a restart', () => {
      // The in-memory cache dies with the process, so a code change or a tunnel
      // reconnect re-analysed every thread already read.
      const d = dir();
      new AnalysisCache<string>(60_000, 300, Date.now, d).set(K(), 'reading');
      const fresh = new AnalysisCache<string>(60_000, 300, Date.now, d);
      expect(fresh.get(K())).toBe('reading');
      expect(fresh.stats().restored).toBe(1);
    });

    it('does not write anything when no directory is configured', () => {
      // Off by default: storing analysed personal mail must be opt-in.
      const c = new AnalysisCache<string>();
      c.set(K(), 'reading');
      expect(c.stats().restored).toBeUndefined();
    });

    it('never writes the email address to a filename', () => {
      const d = dir();
      new AnalysisCache<string>(60_000, 300, Date.now, d).set(K(), 'x');
      const names = readdirSync(d).join(' ');
      expect(names).not.toContain('a@b.com');
      expect(names).toMatch(/^[0-9a-f]{64}\.json$/);
    });

    it('drops expired entries from disk instead of resurrecting them', () => {
      const d = dir();
      let t = 0;
      new AnalysisCache<string>(1000, 300, () => t, d).set(K(), 'reading');
      t = 5000;
      const fresh = new AnalysisCache<string>(1000, 300, () => t, d);
      expect(fresh.get(K())).toBeNull();
      expect(readdirSync(d)).toHaveLength(0);
    });

    it('clear() destroys the directory', () => {
      // A cache holding analysed personal mail has to be destroyable in one
      // call, or "disposable" is not a real claim.
      const d = dir();
      const c = new AnalysisCache<string>(60_000, 300, Date.now, d);
      c.set(K(), 'reading');
      c.clear();
      expect(existsSync(d)).toBe(false);
    });

    it('keeps working when the directory cannot be written', () => {
      const c = new AnalysisCache<string>(60_000, 300, Date.now, '/proc/nonexistent/nope');
      c.set(K(), 'reading');
      expect(c.get(K())).toBe('reading');
    });
  });
});
