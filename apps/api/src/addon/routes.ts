import { Hono } from 'hono';
import { container } from 'tsyringe';
import { InvalidInputError } from '@crm/shared';
import { AccountContextService, WaitingClientsService } from './account-context';

export const addonRoutes = new Hono();

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
    data: await service.find(
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
  });
});
