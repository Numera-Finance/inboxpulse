import type { Inngest } from 'inngest';
import { container } from 'tsyringe';
import { logger } from '../../utils/logger';
import { PanelSnapshotService } from '../snapshot-service';

/**
 * Keep the panel's tenant-wide sections warm.
 *
 * These queries are 90-day aggregates identical for every viewer, and
 * recomputing them per panel open did not survive two dozen concurrent users:
 * `stirring` exceeded the add-on's 6s abort on 65% of calls, `pulse` on 57%.
 * An aborted section renders as absent, and absent reads as calm.
 *
 * Every five minutes, because that is well inside the 15-minute staleness bound
 * the readers accept — a cron that misses one run must not push a tenant over
 * the edge into recomputing live during the morning peak, which is precisely
 * when it could least afford to.
 *
 * `fires` and `waiting` are computed here UNMASKED — as an admin, unlimited —
 * because the entitlement filter is a mask over the result rather than part of
 * the computation. The mask is applied per request in `routes.ts`, never in the
 * add-on, so a superset spanning the whole tenant does not cross the wire to a
 * viewer entitled to part of it.
 *
 * Tenants are refreshed sequentially. Fanning out would finish sooner and would
 * put every tenant's three heavy queries on the database at the same instant,
 * which is the load pattern this function exists to remove.
 */
export const createPanelSnapshotCronFunction = (inngest: Inngest) => {
  return inngest.createFunction(
    { id: 'panel-snapshot-cron', name: 'Panel Snapshot Refresh', retries: 1 },
    { cron: '*/5 * * * *' },
    async ({ step }) => {
      const service = container.resolve(PanelSnapshotService);

      const tenants = await step.run('list-tenants', async () => service.tenantsToRefresh());
      if (!tenants.length) {
        logger.info('panel snapshot cron: no tenants with integrations');
        return { tenants: 0, sections: 0 };
      }

      const result = await step.run('refresh-all', async () => {
        let sections = 0;
        let slowest = 0;
        for (const tenantId of tenants) {
          const done = await service.refreshTenant(tenantId, 90);
          sections += done.length;
          slowest = Math.max(slowest, ...done.map((d) => d.ms), 0);
        }
        return { sections, slowest };
      });

      logger.info(
        { tenants: tenants.length, sections: result.sections, slowestMs: result.slowest },
        'panel snapshots refreshed',
      );
      return { tenants: tenants.length, ...result };
    },
  );
};
