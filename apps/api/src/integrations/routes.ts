import { Hono } from 'hono';
import { container } from 'tsyringe';
import { IntegrationService } from './service';
import type { IntegrationSource } from './schema';
import { updateRunStateSchema, updateAccessTokenSchema, updateWatchExpirySchema, updateParametersSchema } from '@crm/clients';
import { logger } from '../utils/logger';

const app = new Hono();

// Helper to validate integration source
function isValidSource(source: string): source is IntegrationSource {
  return ['gmail', 'outlook', 'slack', 'other'].includes(source);
}

/**
 * List integrations with optional filters
 * GET /api/integrations?tenantId=xxx&source=gmail
 */
app.get('/', async (c) => {
  const tenantId = c.req.query('tenantId');
  const sourceParam = c.req.query('source');

  if (!tenantId) {
    return c.json({ error: 'tenantId query parameter is required' }, 400);
  }

  const integrationService = container.resolve(IntegrationService);
  let integrations = await integrationService.listByTenant(tenantId);

  // Filter by source if provided
  if (sourceParam) {
    if (!isValidSource(sourceParam)) {
      return c.json({ error: 'Invalid source' }, 400);
    }
    integrations = integrations.filter(i => i.source === sourceParam);
  }

  return c.json({ integrations });
});

/**
 * Create or update integration
 */
app.post('/', async (c) => {
  const body = await c.req.json();
  const { tenantId, authType, keys } = body;

  if (!tenantId || !authType || !keys) {
    return c.json({ error: 'tenantId, authType, and keys are required' }, 400);
  }

  const integrationService = container.resolve(IntegrationService);

  try {
    const result = await integrationService.createOrUpdate({ tenantId, authType, keys });
    return c.json(result);
  } catch (error: any) {
    logger.error({ error }, 'Failed to create/update integration');
    return c.json({ error: error.message }, 500);
  }
});

/**
 * Find integration by email (for webhook lookup)
 * Returns the full integration so we have the ID for subsequent updates
 * IMPORTANT: This must come BEFORE /:tenantId/:source to avoid route conflicts
 */
app.get('/lookup/by-email', async (c) => {
  const email = c.req.query('email');
  const sourceParam = c.req.query('source');
  const source = (sourceParam || 'gmail') as string;

  if (!email) {
    return c.json({ error: 'email query parameter is required' }, 400);
  }

  if (!isValidSource(source)) {
    return c.json({ error: 'Invalid source' }, 400);
  }

  const integrationService = container.resolve(IntegrationService);
  const integration = await integrationService.findByEmail(email, source);

  if (!integration) {
    return c.json({ error: 'No integration found for email' }, 404);
  }

  return c.json({ data: integration });
});

/**
 * Find integrations that need watch renewal (expiring within specified days)
 * Used by scheduled jobs to proactively renew watches
 * IMPORTANT: This must come BEFORE /:tenantId to avoid route conflicts
 */
app.get('/watch/renewals', async (c) => {
  const source = c.req.query('source') || 'gmail';
  const daysBeforeExpiry = parseInt(c.req.query('daysBeforeExpiry') || '2', 10);

  if (!isValidSource(source)) {
    return c.json({ error: 'Invalid source' }, 400);
  }

  const integrationService = container.resolve(IntegrationService);
  const integrations = await integrationService.findIntegrationsNeedingWatchRenewal(
    source,
    daysBeforeExpiry
  );

  return c.json({
    integrations,
    count: integrations.length,
    source,
    daysBeforeExpiry,
  });
});

/**
 * Get integration credentials (decrypted) - Internal use only
 */
app.get('/:tenantId/:source/credentials', async (c) => {
  const tenantId = c.req.param('tenantId');
  const source = c.req.param('source');

  if (!isValidSource(source)) {
    return c.json({ error: 'Invalid source' }, 400);
  }

  const integrationService = container.resolve(IntegrationService);
  const credentials = await integrationService.getCredentials(tenantId, source);

  if (!credentials) {
    return c.json({ error: 'Integration not found' }, 404);
  }

  // Return in ApiResponse format expected by IntegrationClient
  return c.json({ data: credentials });
});

/**
 * Get integration metadata (without exposing keys)
 */
app.get('/:tenantId/:source', async (c) => {
  const tenantId = c.req.param('tenantId');
  const source = c.req.param('source');

  if (!isValidSource(source)) {
    return c.json({ error: 'Invalid source' }, 400);
  }

  const integrationService = container.resolve(IntegrationService);
  const integration = await integrationService.getIntegration(tenantId, source);

  if (!integration) {
    return c.json({ error: 'Integration not found' }, 404);
  }

  // Return in ApiResponse format expected by IntegrationClient
  return c.json({ data: integration });
});

/**
 * Update token expiration (for OAuth refresh)
 */
app.put('/:tenantId/:source/token-expiration', async (c) => {
  const tenantId = c.req.param('tenantId');
  const source = c.req.param('source');
  const { expiresAt } = await c.req.json();

  if (!isValidSource(source)) {
    return c.json({ error: 'Invalid source' }, 400);
  }

  if (!expiresAt) {
    return c.json({ error: 'expiresAt is required' }, 400);
  }

  const integrationService = container.resolve(IntegrationService);

  try {
    await integrationService.updateTokenExpiration(tenantId, source, new Date(expiresAt));
    return c.json({ success: true });
  } catch (error: any) {
    logger.error({ error }, 'Failed to update token expiration');
    return c.json({ error: error.message }, 500);
  }
});

/**
 * Update refresh token (for OAuth re-authorization)
 */
app.put('/:tenantId/:source/refresh-token', async (c) => {
  const tenantId = c.req.param('tenantId');
  const source = c.req.param('source');
  const { refreshToken } = await c.req.json();

  if (!isValidSource(source)) {
    return c.json({ error: 'Invalid source' }, 400);
  }

  if (!refreshToken) {
    return c.json({ error: 'refreshToken is required' }, 400);
  }

  const integrationService = container.resolve(IntegrationService);

  try {
    await integrationService.updateRefreshToken(tenantId, source, refreshToken);
    logger.info({ tenantId, source }, 'Refresh token updated successfully');
    return c.json({ success: true, message: 'Refresh token updated' });
  } catch (error: any) {
    logger.error({ error, tenantId, source }, 'Failed to update refresh token');
    return c.json({ error: error.message }, 500);
  }
});

/**
 * Update integration keys (partial update)
 */
app.patch('/:tenantId/:source/keys', async (c) => {
  const tenantId = c.req.param('tenantId');
  const source = c.req.param('source');
  const { keys, updatedBy } = await c.req.json();

  if (!isValidSource(source)) {
    return c.json({ error: 'Invalid source' }, 400);
  }

  if (!keys) {
    return c.json({ error: 'keys is required' }, 400);
  }

  const integrationService = container.resolve(IntegrationService);

  try {
    const integration = await integrationService.updateKeys(tenantId, source, { keys, updatedBy });
    return c.json({ integration });
  } catch (error: any) {
    logger.error({ error }, 'Failed to update keys');
    return c.json({ error: error.message }, 500);
  }
});

/**
 * Get integration by ID
 * GET /api/integrations/:integrationId
 */
app.get('/:integrationId', async (c) => {
  const integrationId = c.req.param('integrationId');

  const integrationService = container.resolve(IntegrationService);
  const integration = await integrationService.getById(integrationId);

  if (!integration) {
    return c.json({ error: 'Integration not found' }, 404);
  }

  return c.json({ data: integration });
});

/**
 * Update run state (lastRunToken, lastRunAt) by integration ID
 */
app.patch('/:integrationId/run-state', async (c) => {
  const integrationId = c.req.param('integrationId');
  const body = await c.req.json();

  const integrationService = container.resolve(IntegrationService);

  try {
    const state = updateRunStateSchema.parse(body);
    await integrationService.updateRunState(integrationId, state);
    return c.json({ success: true });
  } catch (error: any) {
    if (error.name === 'ZodError') {
      return c.json({ error: 'Invalid request data', details: error.errors }, 400);
    }
    return c.json({ error: error.message }, 500);
  }
});

/**
 * Update access token after refresh by integration ID
 */
app.patch('/:integrationId/access-token', async (c) => {
  const integrationId = c.req.param('integrationId');
  const body = await c.req.json();

  const integrationService = container.resolve(IntegrationService);

  try {
    const data = updateAccessTokenSchema.parse(body);
    await integrationService.updateAccessToken(integrationId, data);
    return c.json({ success: true });
  } catch (error: any) {
    if (error.name === 'ZodError') {
      return c.json({ error: 'Invalid request data', details: error.errors }, 400);
    }
    return c.json({ error: error.message }, 500);
  }
});

/**
 * Update watch expiry timestamps by integration ID
 */
app.patch('/:integrationId/watch-expiry', async (c) => {
  const integrationId = c.req.param('integrationId');
  const body = await c.req.json();

  const integrationService = container.resolve(IntegrationService);

  try {
    const data = updateWatchExpirySchema.parse(body);
    await integrationService.updateWatchExpiry(integrationId, data);
    return c.json({ success: true });
  } catch (error: any) {
    if (error.name === 'ZodError') {
      return c.json({ error: 'Invalid request data', details: error.errors }, 400);
    }
    return c.json({ error: error.message }, 500);
  }
});

/**
 * Update integration parameters by integration ID
 * Used for settings like blacklist emails, etc.
 */
app.patch('/:integrationId/parameters', async (c) => {
  const integrationId = c.req.param('integrationId');
  const body = await c.req.json();

  const integrationService = container.resolve(IntegrationService);

  try {
    const data = updateParametersSchema.parse(body);
    await integrationService.updateParameters(integrationId, data.parameters);
    return c.json({ success: true });
  } catch (error: any) {
    if (error.name === 'ZodError') {
      return c.json({ error: 'Invalid request data', details: error.errors }, 400);
    }
    return c.json({ error: error.message }, 500);
  }
});

/**
 * Get watch status (for debugging)
 */
app.get('/:tenantId/:source/watch-status', async (c) => {
  const tenantId = c.req.param('tenantId');
  const source = c.req.param('source');

  if (!isValidSource(source)) {
    return c.json({ error: 'Invalid source' }, 400);
  }

  const integrationService = container.resolve(IntegrationService);
  const integration = await integrationService.getIntegration(tenantId, source);

  if (!integration) {
    return c.json({ error: 'Integration not found' }, 404);
  }

  const now = new Date();
  const needsRenewal = !integration.watchExpiresAt || integration.watchExpiresAt < now;
  const daysUntilExpiry = integration.watchExpiresAt
    ? Math.ceil((integration.watchExpiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
    : null;

  return c.json({
    watchSetAt: integration.watchSetAt,
    watchExpiresAt: integration.watchExpiresAt,
    needsRenewal,
    daysUntilExpiry,
  });
});

/**
 * Disconnect integration (stop watch and deactivate)
 */
app.delete('/:tenantId/:source', async (c) => {
  const tenantId = c.req.param('tenantId');
  const source = c.req.param('source');
  const { updatedBy } = await c.req.json().catch(() => ({}));

  if (!isValidSource(source)) {
    return c.json({ error: 'Invalid source' }, 400);
  }

  // Stop Gmail watch first (if it's a gmail integration)
  if (source === 'gmail') {
    try {
      const gmailServiceUrl = process.env.SERVICE_GMAIL_URL;
      if (gmailServiceUrl) {
        const watchResponse = await fetch(`${gmailServiceUrl}/api/watch?tenantId=${tenantId}`, {
          method: 'DELETE',
        });

        if (watchResponse.ok) {
          logger.info({ tenantId, source }, 'Gmail watch stopped successfully');
        } else {
          const errorText = await watchResponse.text();
          logger.warn(
            { tenantId, source, status: watchResponse.status, error: errorText },
            'Failed to stop Gmail watch - continuing with deactivation'
          );
        }
      }
    } catch (watchError: any) {
      logger.warn(
        { tenantId, source, error: watchError.message },
        'Failed to stop Gmail watch - continuing with deactivation'
      );
      // Don't fail the disconnect if watch stop fails
    }
  }

  const integrationService = container.resolve(IntegrationService);
  await integrationService.deactivate(tenantId, source, updatedBy);

  return c.json({ message: 'Integration disconnected', tenantId, source });
});

export default app;
