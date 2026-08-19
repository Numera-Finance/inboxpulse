import { injectable, inject } from 'tsyringe';
import type { Database } from '@crm/database';
import { sql } from '@crm/database';
import { logger } from '../utils/logger';
import {
  DangerPulseService,
  StirringService,
  SlowRespondersService,
  FiresService,
  WaitingClientsService,
} from './account-context';

/**
 * Precomputed tenant-wide panel sections.
 *
 * The three sections here are 90-day aggregates that are identical for every
 * viewer in a tenant, and they were recomputed on every panel open. Measured on
 * production at 25 concurrent opens, `stirring` timed out on 65% of calls and
 * `pulse` on 57% — and a timed-out section renders as ABSENT, which on this
 * panel reads as "nothing is wrong". The product was already lying by omission
 * at two dozen users.
 *
 * Precomputing decouples the cost from the number of readers. Two hundred users
 * were paying two hundred times for one answer that changes a few times an hour.
 *
 * `fires` and `waiting` are here too, and the reason is worth stating because an
 * earlier version of this comment said the opposite. They LOOK per-viewer, but
 * reading both services shows the viewer appears exactly once in each: a
 * `customer_id IN (SELECT ... FROM user_accessible_customers)` clause. Every
 * aggregate — negative counts, unanswered, oldest, arc, engagement, owner — is a
 * property of the CUSTOMER and is identical for everyone who can see it.
 *
 * So the expensive part is tenant-wide and the entitlement is a mask applied at
 * the end. We precompute the unmasked superset once and filter it per viewer
 * against their accessible-customer set, which is ~19 rows per user. Measured:
 * the fires query spends ~750ms in its `engagement` (382ms) and `monthly`
 * (334ms) CTEs; filtering a cached superset is single-digit milliseconds.
 *
 * The ordering keys are per-customer, so filtering a sorted superset yields the
 * same order as filtering inside the query — the mask cannot reorder what
 * survives it.
 */
@injectable()
export class PanelSnapshotService {
  constructor(@inject('Database') private readonly db: Database) {}

  /** Recompute and store every tenant-wide section for one tenant. */
  async refreshTenant(tenantId: string, windowDays = 90): Promise<{ kind: string; ms: number }[]> {
    const jobs: Array<{ kind: string; run: () => Promise<unknown> }> = [
      { kind: 'pulse', run: () => new DangerPulseService(this.db).get(tenantId, windowDays) },
      { kind: 'stirring', run: () => new StirringService(this.db).get(tenantId) },
      { kind: 'slow_responders', run: () => new SlowRespondersService(this.db).get(tenantId, windowDays) },
      // Computed AS AN ADMIN and unlimited: this is the superset every viewer's
      // list is a subset of. Never served to a viewer without the mask below.
      // COSTS 29 SECONDS, measured on production with 81 fires.
      //
      // Not the aggregates — `nameWhoTalksToThem` resolves an owner for each
      // fire that lacks one, via a LATERAL that scans 90 days of mail per
      // customer. At the panel's limit of 6 that is a few hundred milliseconds;
      // unbounded it is ~700ms x ~40 customers.
      //
      // Acceptable HERE and nowhere else: this is a read, off the request path,
      // holding no locks, and MVCC means it blocks no writer. The 200-user load
      // test passed with zero timeouts while this ran every five minutes. What
      // it is not is free — it holds one connection for 29s of every 300, and
      // that grows with ingestion. The fix is a set-based rewrite of the owner
      // lookup rather than a LATERAL per customer, and it is not done.
      {
        kind: 'fires',
        run: () => new FiresService(this.db).get(tenantId, { userId: '', isAdmin: true }, windowDays, 200),
      },
      {
        kind: 'waiting',
        run: () =>
          new WaitingClientsService(this.db).find(
            tenantId,
            { userId: '', isAdmin: true },
            { days: 30, limit: 200, ownDomains: ['mystartupcfo.com', 'numerafinance.com'] },
          ),
      },
    ];

    const done: { kind: string; ms: number }[] = [];
    for (const job of jobs) {
      const started = Date.now();
      try {
        const payload = await job.run();
        const ms = Date.now() - started;
        // A failed computation must never overwrite a good snapshot: the write
        // only happens on success, so readers keep the last real answer.
        await this.db.execute(sql`
          INSERT INTO panel_snapshots (tenant_id, kind, payload, window_days, compute_ms, computed_at)
          VALUES (${tenantId}, ${job.kind}, ${JSON.stringify(payload ?? null)}::jsonb, ${windowDays}, ${ms}, now())
          ON CONFLICT (tenant_id, kind, window_days) DO UPDATE
            SET payload = EXCLUDED.payload,
                compute_ms = EXCLUDED.compute_ms,
                computed_at = EXCLUDED.computed_at
        `);
        done.push({ kind: job.kind, ms });
      } catch (error) {
        // Logged and skipped rather than thrown: one broken section must not
        // stop the other two from refreshing.
        logger.error(
          { tenantId, kind: job.kind, error: error instanceof Error ? error.message : String(error) },
          'panel snapshot refresh failed',
        );
      }
    }
    return done;
  }

  /**
   * Read a snapshot, or null when there is none fresh enough to serve.
   *
   * `maxAgeMs` is generous on purpose. These are 90-day windows; a ten-minute-old
   * count of who is waiting is not meaningfully different from a current one, and
   * it is very different from a section that renders nothing. Past the bound the
   * caller falls back to computing live, so a cron that has stopped running
   * degrades to today's behaviour rather than to silently ancient numbers.
   */
  async read<T>(tenantId: string, kind: string, windowDays = 90, maxAgeMs = 15 * 60 * 1000): Promise<T | null> {
    const rows = await this.db.execute<{ payload: T; age_ms: number }>(sql`
      SELECT payload, (extract(epoch from (now() - computed_at)) * 1000)::bigint AS age_ms
      FROM panel_snapshots
      WHERE tenant_id = ${tenantId} AND kind = ${kind} AND window_days = ${windowDays}
      LIMIT 1
    `);
    const row = (rows as unknown as Array<{ payload: T; age_ms: string | number }>)[0];
    if (!row) return null;
    if (Number(row.age_ms) > maxAgeMs) return null;
    return row.payload;
  }

  /**
   * The customers this viewer may see, as a Set for filtering a superset.
   *
   * Admins get null, meaning "no mask" — distinct from an empty Set, which means
   * "entitled to nothing" and must yield an empty list rather than everything.
   * Conflating those two is how an entitlement check becomes a data leak.
   */
  async accessibleCustomerIds(userId: string, isAdmin: boolean): Promise<Set<string> | null> {
    if (isAdmin) return null;
    const rows = await this.db.execute<{ customer_id: string }>(sql`
      SELECT customer_id::text AS customer_id
      FROM user_accessible_customers
      WHERE user_id = ${userId}
    `);
    return new Set((rows as unknown as Array<{ customer_id: string }>).map((r) => r.customer_id));
  }

  /** Apply the entitlement mask to a precomputed superset, then cap it. */
  maskAndLimit<T extends { customerId: string | null }>(
    rows: T[],
    allowed: Set<string> | null,
    limit: number,
  ): T[] {
    if (allowed === null) return rows.slice(0, limit);
    // A row with no customer is not attributable to an entitlement, so a
    // non-admin does not see it — the same behaviour as the SQL `IN`, which
    // never matches NULL.
    return rows.filter((r) => r.customerId !== null && allowed.has(r.customerId)).slice(0, limit);
  }

  /** Every tenant with a connected mailbox — the set worth precomputing for. */
  async tenantsToRefresh(): Promise<string[]> {
    const rows = await this.db.execute<{ tenant_id: string }>(sql`
      SELECT DISTINCT tenant_id::text AS tenant_id FROM integrations WHERE tenant_id IS NOT NULL
    `);
    return (rows as unknown as Array<{ tenant_id: string }>).map((r) => r.tenant_id);
  }
}
