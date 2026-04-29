import { Hono } from 'hono';
import { container } from 'tsyringe';
import { RunService } from './service';
import { createRunRequestSchema, updateRunRequestSchema } from '@crm/clients';
import { InvalidInputError, NotFoundError, type RequestHeader } from '@crm/shared';

/** Try to get tenantId from requestHeader (set by session auth middleware on external routes) */
function getTenantIdFromContext(c: { get: (key: string) => unknown }): string | undefined {
  const header = c.get('requestHeader') as RequestHeader | undefined;
  return header?.tenantId;
}

const app = new Hono();

/**
 * Create a new run
 */
app.post('/', async (c) => {
  const body = await c.req.json();
  const validatedData = createRunRequestSchema.parse(body);

  const runService = container.resolve(RunService);
  const run = await runService.create(validatedData);
  return c.json({ data: run });
});

/**
 * Get run by ID
 */
app.get('/:runId', async (c) => {
  const runId = c.req.param('runId');

  const runService = container.resolve(RunService);
  const run = await runService.findById(runId);

  if (!run) throw new NotFoundError('Run', runId);
  return c.json({ data: run });
});

/**
 * Update a run
 */
app.patch('/:runId', async (c) => {
  const runId = c.req.param('runId');
  const body = await c.req.json();
  const data = updateRunRequestSchema.parse(body);

  const runService = container.resolve(RunService);
  const run = await runService.update(runId, data);
  return c.json({ data: run });
});

/**
 * Get runs for tenant
 */
app.get('/', async (c) => {
  const tenantId = c.req.query('tenantId');
  const integrationId = c.req.query('integrationId');
  const limit = parseInt(c.req.query('limit') || '10');

  const scopedTenantId = getTenantIdFromContext(c);
  const runService = container.resolve(RunService);

  let runs;
  if (integrationId) {
    runs = await runService.findByIntegration(integrationId, { limit }, scopedTenantId);
  } else if (tenantId) {
    runs = await runService.findByTenant(tenantId, { limit });
  } else {
    throw new InvalidInputError('tenantId or integrationId is required');
  }

  return c.json({ data: runs, count: runs.length });
});

export default app;
