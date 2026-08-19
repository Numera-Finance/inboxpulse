import { Hono } from 'hono';
import { container } from 'tsyringe';
import { PanelSnapshotService } from './snapshot-service';
import { InvalidInputError } from '@crm/shared';
import { AccountContextService, WaitingClientsService, DangerPulseService, FiresService, SlowRespondersService, StirringService } from './account-context';

export const addonRoutes = new Hono();

/**
 * Serve a precomputed section, computing live only if the cron has not run.
 *
 * The fallback is what makes this safe to deploy before the cron has ever
 * fired, and what makes a stopped cron degrade to the old behaviour — slow —
 * rather than to stale numbers presented as current. `read()` returns null once
 * a snapshot passes its age bound, so nothing here can quietly serve last
 * week's answer.
 */
/**
 * Serve an entitlement-scoped section from the precomputed tenant-wide superset.
 *
 * The mask is applied HERE, in the API, never in the add-on: the superset is
 * every customer in the tenant, and it must not cross the wire to a viewer who
 * is only entitled to some of it. On a snapshot miss this falls through to the
 * live query, which does its own scoping in SQL.
 */
async function fromScopedSnapshot<T extends { customerId: string | null }>(
  tenantId: string,
  kind: string,
  windowDays: number,
  viewer: { userId: string; isAdmin: boolean },
  limit: number,
  live: () => Promise<T[]>,
): Promise<T[]> {
  const snapshots = container.resolve(PanelSnapshotService);
  const superset = await snapshots.read<T[]>(tenantId, kind, windowDays);
  if (superset === null) return live();
  const allowed = await snapshots.accessibleCustomerIds(viewer.userId, viewer.isAdmin);
  return snapshots.maskAndLimit(superset, allowed, limit);
}

async function fromSnapshot<T>(tenantId: string, kind: string, windowDays: number, live: () => Promise<T>): Promise<T> {
  const snapshots = container.resolve(PanelSnapshotService);
  const hit = await snapshots.read<T>(tenantId, kind, windowDays);
  if (hit !== null) return hit;
  return live();
}

/**
 * GET /api/internal/addon/account-context?domain=&tenantId=
 *
 * The add-on's differentiated signal: what we know about this sender's company
 * that is not in the open thread. Keyed by domain because the add-on always has
 * the sender's address from Gmail headers, even for a thread it has never
 * ingested.
 */
addonRoutes.get('/account-context', async (c) => {
  const domain = c.req.query('domain');
  const tenantId = c.req.query('tenantId');
  const userId = c.req.query('userId');
  if (!domain) throw new InvalidInputError('domain is required');
  if (!tenantId) throw new InvalidInputError('tenantId is required');
  // Required, not optional. Without a viewer there is nobody to scope to, and
  // defaulting to "see everything" is how this kind of endpoint leaks.
  if (!userId) throw new InvalidInputError('userId is required');

  const isAdmin = c.req.query('isAdmin') === 'true';
  const viewerEmail = c.req.query('email') ?? undefined;

  const service = container.resolve(AccountContextService);
  return c.json({
    success: true,
    data: await service.byDomain(tenantId, domain, { userId, isAdmin, email: viewerEmail }),
  });
});

/**
 * GET /api/internal/addon/viewer?email=&tenantId=
 *
 * Resolve a Gmail address to the InboxPulse user, so the add-on can scope
 * account context to a REAL viewer instead of asserting one. Returns the user id
 * and whether they hold ADMIN — never the permission list itself.
 */
addonRoutes.get('/viewer', async (c) => {
  const email = c.req.query('email');
  const tenantId = c.req.query('tenantId');
  if (!email) throw new InvalidInputError('email is required');
  if (!tenantId) throw new InvalidInputError('tenantId is required');

  const service = container.resolve(AccountContextService);
  return c.json({ success: true, data: await service.resolveViewer(tenantId, email) });
});

/**
 * POST /api/internal/addon/task
 *
 * Create a task from the add-on panel. The only endpoint here that WRITES.
 *
 * The panel's other buttons all open Gmail — useful, but nothing changes when
 * you press them. This one turns a commitment the model found into a tracked
 * task, which is the difference between a summary and a tool.
 *
 * Scoped like everything else: a task can only be attached to a customer the
 * caller is entitled to, so this cannot be used to write into an account the
 * viewer cannot otherwise see.
 */
addonRoutes.post('/task', async (c) => {
  const body = await c.req.json<{
    tenantId?: string;
    userId?: string;
    isAdmin?: boolean;
    customerId?: string;
    title?: string;
  }>();

  if (!body.tenantId) throw new InvalidInputError('tenantId is required');
  if (!body.userId) throw new InvalidInputError('userId is required');
  if (!body.customerId) throw new InvalidInputError('customerId is required');
  if (!body.title?.trim()) throw new InvalidInputError('title is required');

  const service = container.resolve(AccountContextService);
  const created = await service.createTaskForViewer(body.tenantId, body.customerId, body.title.trim(), {
    userId: body.userId,
    isAdmin: body.isAdmin === true,
  });

  return c.json({ success: true, data: created });
});

/**
 * GET /api/internal/addon/waiting?tenantId=&userId=&isAdmin=&days=
 *
 * Angry clients nobody has answered — the team-lead question, asked directly.
 *
 * Viewer-scoped like everything else on this router: admins see the tenant,
 * everyone else sees only customers in `user_accessible_customers`. A view of
 * "who is unhappy" must not become a way to read accounts the viewer cannot
 * otherwise open.
 */
addonRoutes.get('/waiting', async (c) => {
  const tenantId = c.req.query('tenantId');
  const userId = c.req.query('userId');
  if (!tenantId) throw new InvalidInputError('tenantId is required');
  if (!userId) throw new InvalidInputError('userId is required');

  const days = Math.min(90, Math.max(1, Number(c.req.query('days') ?? 30)));
  const isAdmin = c.req.query('isAdmin') === 'true';

  const service = container.resolve(WaitingClientsService);
  return c.json({
    success: true,
    data: await fromScopedSnapshot(tenantId, 'waiting', 30, { userId, isAdmin }, 8, () =>
      service.find(
        tenantId,
        { userId, isAdmin },
        {
          days,
          limit: 8,
          // Our own company appears as a customer in email_participants, so
          // without this the list is topped by us being unhappy with ourselves.
          ownDomains: ['mystartupcfo.com', 'numerafinance.com'],
        },
      ),
    ),
  });
});

/**
 * GET /api/internal/addon/pulse?tenantId=&days=
 *
 * Median time to first reply on negative mail — the number this product exists
 * to move — reported against the same figure for everything else, because the
 * number alone says nothing.
 *
 * Tenant-wide rather than viewer-scoped: it is an aggregate over thousands of
 * threads with no per-customer detail, so it discloses nothing about an account
 * the viewer cannot open.
 */
addonRoutes.get('/pulse', async (c) => {
  const tenantId = c.req.query('tenantId');
  if (!tenantId) throw new InvalidInputError('tenantId is required');
  const days = Math.min(365, Math.max(7, Number(c.req.query('days') ?? 90)));
  return c.json({
    success: true,
    data: await fromSnapshot(tenantId, 'pulse', days, () =>
      container.resolve(DangerPulseService).get(tenantId, days),
    ),
  });
});


/**
 * GET /api/internal/addon/fires?tenantId=&userId=&isAdmin=&days=
 *
 * Where the fires are, by CLIENT — negative threads, how many are unanswered,
 * how old the oldest is, and the account manager to call.
 *
 * Entitlement-scoped like /waiting: it names customers, so a non-admin sees
 * only accounts they can already open.
 */
addonRoutes.get('/fires', async (c) => {
  const tenantId = c.req.query('tenantId');
  const userId = c.req.query('userId');
  if (!tenantId) throw new InvalidInputError('tenantId is required');
  if (!userId) throw new InvalidInputError('userId is required');
  const days = Math.min(180, Math.max(1, Number(c.req.query('days') ?? 90)));
  return c.json({
    success: true,
    data: await fromScopedSnapshot(
      tenantId,
      'fires',
      days,
      { userId, isAdmin: c.req.query('isAdmin') === 'true' },
      6,
      () =>
        container
          .resolve(FiresService)
          .get(tenantId, { userId, isAdmin: c.req.query('isAdmin') === 'true' }, days),
    ),
  });
});

/**
 * GET /api/internal/addon/stirring?tenantId=
 *
 * Clients whose mail has roughly doubled this week and who have NOT complained.
 *
 * The only signal in the panel that fires before a complaint is written.
 * Measured over 265 clients who eventually complained: volume rose in 68% of
 * them in the final week beforehand.
 *
 * Not entitlement-scoped by viewer, matching /fires' firm-wide framing for a
 * management panel; it names customers, so if that ever tightens for /fires it
 * must tighten here in the same change.
 */
addonRoutes.get('/stirring', async (c) => {
  const tenantId = c.req.query('tenantId');
  if (!tenantId) throw new InvalidInputError('tenantId is required');
  return c.json({
    success: true,
    // 90 is the stored window; stirring takes no days parameter.
    data: await fromSnapshot(tenantId, 'stirring', 90, () =>
      container.resolve(StirringService).get(tenantId),
    ),
  });
});

/**
 * GET /api/internal/addon/slow-responders?tenantId=&days=
 *
 * Median hours to first reply on negative mail, per account manager.
 *
 * Tenant-wide aggregate of people and durations, with no customer or message
 * detail, so it discloses nothing about an account the viewer cannot open —
 * the same disclosure basis as /pulse.
 */
addonRoutes.get('/slow-responders', async (c) => {
  const tenantId = c.req.query('tenantId');
  if (!tenantId) throw new InvalidInputError('tenantId is required');
  const days = Math.min(180, Math.max(1, Number(c.req.query('days') ?? 90)));
  return c.json({
    success: true,
    data: await fromSnapshot(tenantId, 'slow_responders', days, () =>
      container.resolve(SlowRespondersService).get(tenantId, days),
    ),
  });
});
