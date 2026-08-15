// The services carry tsyringe decorators, which need the polyfill at load time.
import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import type { Database } from '@crm/database';
import { WaitingClientsService, DangerPulseService, OwnerLoadService } from './account-context';

/**
 * Every management metric must require somebody from this firm on the thread.
 *
 * This is a regression test for a live wrong answer, not a style rule. We sync
 * our own mailboxes, including the per-client group ids a team listens on, and
 * clients auto-forward into those addresses so their bookkeeper sees the
 * traffic. A forwarded message keeps its original `To:`, so no address of ours
 * appears on it — one client contributed 925 threads of which 786 have no
 * address of ours anywhere. Scoring "unhappy client, nobody replied" over that
 * corpus measures the CLIENT's own customer service and books the result
 * against an account manager who was never on the thread. Two named people were
 * on that list for threads they had never seen. See ADR-020.
 *
 * The check is structural on purpose. The predicate is a SQL fragment, so the
 * behavioural version needs a database and lives with the skipped integration
 * tests. What this catches is the cheap and likely regression: a fourth service
 * added without it, or the fragment dropped from one of the three call sites
 * while the other two keep it — which fails silently, because a metric missing
 * this predicate returns MORE rows rather than none.
 */

/** A database that records the SQL it is handed and returns nothing. */
function recordingDb(): { db: Database; sql: () => string } {
  const seen: string[] = [];
  const db = {
    execute: (query: unknown): Promise<unknown[]> => {
      // Drizzle's SQL object carries its fragments on `queryChunks`. Stringify
      // the whole thing rather than reaching for internals by name: the test
      // only needs to know whether the predicate is present in what was built.
      seen.push(JSON.stringify(query));
      return Promise.resolve([]);
    },
  } as unknown as Database;
  return { db, sql: () => seen.join('\n') };
}

const TENANT = '00000000-0000-0000-0000-000000000001';

describe('management metrics require a firm participant on the thread', () => {
  it('WaitingClientsService filters to threads we are on', async () => {
    const { db, sql } = recordingDb();
    await new WaitingClientsService(db).find(
      TENANT,
      { userId: 'u1', isAdmin: true },
      { days: 90, limit: 10, ownDomains: [] },
    );
    expect(sql()).toContain('participant_type');
  });

  it('DangerPulseService filters to threads we are on', async () => {
    const { db, sql } = recordingDb();
    await new DangerPulseService(db).get(TENANT, 90);
    expect(sql()).toContain('participant_type');
  });

  it('OwnerLoadService filters to threads we are on', async () => {
    const { db, sql } = recordingDb();
    await new OwnerLoadService(db).get(TENANT, 30);
    expect(sql()).toContain('participant_type');
  });

  /**
   * The predicate must be evaluated over the whole thread.
   *
   * The flagged message is inbound FROM the client by construction — that is
   * what makes it a complaint nobody answered. A message-level test would
   * therefore exclude every thread it is meant to keep, and the sections would
   * go empty rather than wrong. Asserting the correlated subquery joins on
   * thread_id pins the distinction that makes this work at all.
   */
  it('matches across the thread, not the single message', async () => {
    const { db, sql } = recordingDb();
    await new WaitingClientsService(db).find(
      TENANT,
      { userId: 'u1', isAdmin: true },
      { days: 90, limit: 10, ownDomains: [] },
    );
    expect(sql()).toContain('e2.thread_id');
  });
});

/**
 * Customers marked as non-clients must be excluded from client reviews.
 *
 * The own-domain rule counts staff accounts on a domain, which catches
 * mystartupcfo.com and misses an outsourced delivery partner completely — from
 * the mail alone, a CA practice doing our back-office work looks exactly like a
 * client, and the allocation grid cannot distinguish it either (role-holders
 * are 100% mystartupcfo.com). So the verdict is recorded in
 * customer_relationships rather than derived, and rather than hardcoded: the
 * previous attempt at hardcoding put `blueoceanps` in a constant and silently
 * dropped a real customer with 45 threads from the review.
 */
describe('non-client customers are excluded', () => {
  it('WaitingClientsService consults customer_relationships', async () => {
    const { db, sql } = recordingDb();
    await new WaitingClientsService(db).find(
      TENANT,
      { userId: 'u1', isAdmin: true },
      { days: 90, limit: 10, ownDomains: [] },
    );
    expect(sql()).toContain('customer_relationships');
  });

  it('OwnerLoadService consults customer_relationships', async () => {
    const { db, sql } = recordingDb();
    await new OwnerLoadService(db).get(TENANT, 30);
    expect(sql()).toContain('customer_relationships');
  });

  /**
   * Absence must mean CLIENT, never the reverse.
   *
   * Only non-clients are ever inserted, so the filter has to be a NOT EXISTS. If
   * it were ever inverted into a requirement that a row be present, every
   * customer would vanish from every section at once — and silently, because an
   * empty section looks like good news.
   */
  it('excludes on presence of a row, so an unlisted customer stays a client', async () => {
    const { db, sql } = recordingDb();
    await new OwnerLoadService(db).get(TENANT, 30);
    const q = sql();
    const at = q.indexOf('customer_relationships');
    expect(q.slice(Math.max(0, at - 400), at)).toContain('NOT EXISTS');
  });
});
