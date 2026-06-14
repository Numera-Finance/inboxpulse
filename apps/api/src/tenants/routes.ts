import { Hono } from 'hono';
import { container } from 'tsyringe';
import { TenantService } from './service';
import { getRequestHeader } from '../utils/request-header';
import type { HonoEnv } from '../types/hono';
import { NotFoundError, type ApiResponse } from '@crm/shared';

const app = new Hono<HonoEnv>();

/**
 * Create tenant
 */
app.post('/', async (c) => {
  const { name } = await c.req.json();
  const requestHeader = c.get('requestHeader');

  const tenantService = container.resolve(TenantService);
  const tenant = await tenantService.create(requestHeader, { name });
  return c.json<ApiResponse<typeof tenant>>({ success: true, data: tenant });
});

/**
 * Get the current user's tenant (resolved from session).
 * Must be defined before /:tenantId so Hono doesn't route "me" as a UUID.
 */
app.get('/me', async (c) => {
  const requestHeader = getRequestHeader(c);
  const tenantService = container.resolve(TenantService);
  const tenant = await tenantService.findById(requestHeader.tenantId);

  if (!tenant) throw new NotFoundError('Tenant', requestHeader.tenantId);
  return c.json<ApiResponse<typeof tenant>>({ success: true, data: tenant });
});

/**
 * Get tenant by ID
 */
app.get('/:tenantId', async (c) => {
  const tenantId = c.req.param('tenantId');

  const tenantService = container.resolve(TenantService);
  const tenant = await tenantService.findById(tenantId);

  if (!tenant) throw new NotFoundError('Tenant', tenantId);
  return c.json<ApiResponse<typeof tenant>>({ success: true, data: tenant });
});

export default app;
