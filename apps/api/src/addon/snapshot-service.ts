import { injectable, inject } from 'tsyringe';
import type { Database } from '@crm/database';
import { sql } from '@crm/database';
import { logger } from '../utils/logger';
import { DangerPulseService, StirringService, SlowRespondersService } from './account-context';

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
 * Deliberately NOT here: `fires` and `waiting`. Those are scoped to the viewer's
 * entitlements, so there is one answer per user rather than per tenant, and they
 * already answer in 125-256ms. Precomputing per user would trade a fast query
 * for a large table and a staleness problem.
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

  /** Every tenant with a connected mailbox — the set worth precomputing for. */
  async tenantsToRefresh(): Promise<string[]> {
    const rows = await this.db.execute<{ tenant_id: string }>(sql`
      SELECT DISTINCT tenant_id::text AS tenant_id FROM integrations WHERE tenant_id IS NOT NULL
    `);
    return (rows as unknown as Array<{ tenant_id: string }>).map((r) => r.tenant_id);
  }
}
