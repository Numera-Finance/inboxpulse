import { Hono } from 'hono';
import { container } from 'tsyringe';
import { RunService } from './service';
import { createRunRequestSchema, updateRunRequestSchema } from '@crm/clients';
import type { RequestHeader } from '@crm/shared';
import { logger } from '../utils/logger';

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

  const runService = container.resolve(RunService);

  try {
    // Validate and coerce data using Zod schema from client package
    // This automatically converts date strings to Date objects and validates all fields
    // Both client and server use the same schema for consistency
    const validatedData = createRunRequestSchema.parse(body);

    const run = await runService.create(validatedData);
    // Return in ApiResponse format expected by RunClient
    return c.json({ data: run });
  } catch (error: any) {
    // Handle Zod validation errors
    if (error.name === 'ZodError') {
      logger.error({
        errors: error.errors,
        body,
      }, 'Invalid run creation request');
      return c.json({ error: 'Invalid request data', details: error.errors }, 400);
    }
    return c.json({ error: error.message }, 400);
  }
});

/**
 * Get run by ID
 */
app.get('/:runId', async (c) => {
  const runId = c.req.param('runId');

  const runService = container.resolve(RunService);
  const run = await runService.findById(runId);

  if (!run) {
    return c.json({ error: 'Run not found' }, 404);
  }

  // Return in ApiResponse format expected by RunClient
  return c.json({ data: run });
});

/**
 * Update a run
 */
app.patch('/:runId', async (c) => {
  const runId = c.req.param('runId');
  const body = await c.req.json();

  const runService = container.resolve(RunService);

  try {
    // Validate and coerce data using Zod schema from client package
    // This automatically converts date strings to Date objects and validates all fields
    // Both client and server use the same schema for consistency
    const data = updateRunRequestSchema.parse(body);

    const run = await runService.update(runId, data);
    // Return in ApiResponse format expected by RunClient
    return c.json({ data: run });
  } catch (error: any) {
    return c.json({ error: error.message }, 400);
  }
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

  try {
    let runs;
    if (integrationId) {
      runs = await runService.findByIntegration(integrationId, { limit }, scopedTenantId);
    } else if (tenantId) {
      runs = await runService.findByTenant(tenantId, { limit });
    } else {
      return c.json({ error: 'tenantId or integrationId is required' }, 400);
    }

    // Return in ApiResponse format expected by RunClient
    return c.json({ data: runs, count: runs.length });
  } catch (error: any) {
    return c.json({ error: error.message }, 400);
  }
});

export default app;
