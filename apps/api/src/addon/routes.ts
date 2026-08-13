import { Hono } from 'hono';
import { container } from 'tsyringe';
import { InvalidInputError } from '@crm/shared';
import { AccountContextService } from './account-context';

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

  const service = container.resolve(AccountContextService);
  return c.json({
    success: true,
    data: await service.byDomain(tenantId, domain, { userId, isAdmin }),
  });
});
