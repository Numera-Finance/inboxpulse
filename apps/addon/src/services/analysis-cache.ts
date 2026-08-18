/**
 * Remember what a thread was analysed as, for as long as the thread has not
 * changed.
 *
 * Reopening a thread re-ran the whole pipeline -- classify, extract, write --
 * and paid ~4.2s to produce a byte-identical answer. The panel is opened far
 * more often than mail changes: you read a thread, switch away, come back,
 * scroll up. Every one of those was a full re-analysis.
 *
 * IN MEMORY ONLY, AND THAT IS THE POINT.
 *
 * The whole reason a personal mailbox can be analysed at all is that nothing is
 * written down: the card says "Analysed live. Not stored", and that has to stay
 * literally true. A cache that survives the process, or reaches the shared
 * tenant database, would quietly turn the demo path into ingestion -- which is
 * exactly the thing this deployment exists to avoid. So: a Map, in this
 * process, gone on restart. No disk, no database, no cross-user sharing.
 *
 * KEYED ON CONTENT, NOT ON THREAD ID.
 *
 * Keying on the thread id alone would serve a stale reading after a new message
 * arrives -- and a stale reading is worse than a slow one, because "3 questions
 * unanswered" is a claim about a conversation that has since moved on. The key
 * therefore includes the message count and the id of the latest message, so any
 * new mail on the thread produces a different key and a fresh analysis. That is
 * cheaper and more reliable than trying to invalidate.
 *
 * The viewer is in the key as well. Two people can open the same thread and the
 * reading is not the same for both -- account history is scoped to what each of
 * them is entitled to see, so a shared entry would leak one viewer's context to
 * the other.
 */

import { createHash } from 'node:crypto';

export interface CacheStats {
  hits: number;
  misses: number;
  entries: number;
  /** Entries recovered from disk on a cold start. */
  restored?: number;
}

interface Entry<T> {
  value: T;
  expires: number;
}

/** Long enough to cover a working session, short enough that nothing lingers. */
const TTL_MS = 30 * 60 * 1000;

/**
 * Bounded so a long-running process cannot grow without limit. Threads are
 * evicted oldest-first; at this size a heavy day of reading still fits, and the
 * cost of a miss is one re-analysis rather than an error.
 */
const MAX_ENTRIES = 300;

export class AnalysisCache<T> {
  private readonly map = new Map<string, Entry<T>>();
  private hits = 0;
  private misses = 0;

  constructor(
    private readonly ttlMs: number = TTL_MS,
    private readonly maxEntries: number = MAX_ENTRIES,
    private readonly now: () => number = Date.now,
  ) {}

  /** sha256 of the key — the key itself contains an email address. */


  /**
   * Build a key from what the analysis actually depends on.
   *
   * `latestMessageId` is what makes a new reply miss the cache. `count` catches
   * the case where a message is deleted rather than added, which leaves the
   * latest id unchanged.
   */
  static key(parts: {
    threadId: string | null | undefined;
    viewerEmail: string | undefined;
    count: number;
    latestMessageId: string | null | undefined;
  }): string {
    return [
      parts.threadId ?? 'none',
      (parts.viewerEmail ?? 'anon').toLowerCase(),
      parts.count,
      parts.latestMessageId ?? 'none',
    ].join('|');
  }

  get(key: string): T | null {
    const hit = this.map.get(key);
    if (!hit) {
      this.misses += 1;
      return null;
    }
    if (hit.expires <= this.now()) {
      this.evict(key);
      this.misses += 1;
      return null;
    }
    // Refresh insertion order so the entries in active use are the last evicted.
    this.map.delete(key);
    this.map.set(key, hit);
    this.hits += 1;
    return hit.value;
  }

  set(key: string, value: T): void {
    this.map.delete(key);
    const entry = { value, expires: this.now() + this.ttlMs };
    this.map.set(key, entry);
    while (this.map.size > this.maxEntries) {
      const oldest = this.map.keys().next();
      if (oldest.done) break;
      this.evict(oldest.value);
    }
  }

  private evict(key: string): void {
    this.map.delete(key);
  }

  stats(): CacheStats {
    return {
      hits: this.hits,
      misses: this.misses,
      entries: this.map.size,
    };
  }

  /**
   * Drop everything, disk included.
   *
   * A cache holding analysed personal mail has to be destroyable in one call,
   * or the promise that it is disposable is not real.
   */
  clear(): void {
    this.map.clear();
  }
}
