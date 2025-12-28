import { Context, Next } from 'hono';
import type { RequestHeader } from '@crm/shared';

/**
 * Extract RequestHeader from request headers
 * This middleware extracts tenant and user info from headers
 */
export async function requestHeaderMiddleware(c: Context, next: Next) {
  const tenantId = c.req.header('x-tenant-id');
  const userId = c.req.header('x-user-id');
  const permissionsHeader = c.req.header('x-permissions');
  const permissions = permissionsHeader
    ? permissionsHeader.split(',').map((p) => parseInt(p, 10)).filter((p) => !isNaN(p))
    : [];

  if (!tenantId || !userId) {
    return c.json({ error: 'Missing required headers: x-tenant-id, x-user-id' }, 401);
  }

  const requestHeader: RequestHeader = {
    tenantId,
    userId,
    permissions,
  };

  c.set('requestHeader', requestHeader);

  await next();
}
