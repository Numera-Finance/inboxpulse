import { Hono } from 'hono';
import { container } from 'tsyringe';
import { IntegrationService } from './service';
import type { IntegrationSource } from './schema';
import { updateRunStateSchema, updateAccessTokenSchema, updateWatchExpirySchema, updateParametersRequestSchema } from '@crm/clients';
import { InvalidInputError, NotFoundError, type RequestHeader } from '@crm/shared';
import { logger } from '../utils/logger';
import { internalFetch } from '../utils/internal-fetch';
import { getEnv } from '../env';

/** Try to get tenantId from requestHeader (set by session auth middleware on external routes) */
function getTenantIdFromContext(c: { get: (key: string) => unknown }): string | undefined {
  const header = c.get('requestHeader') as RequestHeader | undefined;
  return header?.tenantId;
}

const app = new Hono();

// Helper to validate integration source
function isValidSource(source: string): source is IntegrationSource {
  return ['gmail', 'outlook', 'slack', 'other'].includes(source);
}

function assertValidSource(source: string): asserts source is IntegrationSource {
  if (!isValidSource(source)) throw new InvalidInputError('Invalid source');
}

/**
 * List integrations with optional filters
 * GET /api/integrations?tenantId=xxx&source=gmail
 */
app.get('/', async (c) => {
  const tenantId = c.req.query('tenantId');
  const sourceParam = c.req.query('source');

  if (!tenantId) throw new InvalidInputError('tenantId query parameter is required');

  const integrationService = container.resolve(IntegrationService);
  let integrations = await integrationService.listByTenant(tenantId);

  // Filter by source if provided
  if (sourceParam) {
    assertValidSource(sourceParam);
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
    throw new InvalidInputError('tenantId, authType, and keys are required');
  }

  const integrationService = container.resolve(IntegrationService);
  const result = await integrationService.createOrUpdate({ tenantId, authType, keys });
  return c.json(result);
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

  if (!email) throw new InvalidInputError('email query parameter is required');
  assertValidSource(source);

  const tenantId = getTenantIdFromContext(c);
  const integrationService = container.resolve(IntegrationService);
  const integration = await integrationService.findByEmail(email, source, tenantId);

  if (!integration) throw new NotFoundError('Integration', email);
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

  assertValidSource(source);

  const tenantId = getTenantIdFromContext(c);
  const integrationService = container.resolve(IntegrationService);
  const integrations = await integrationService.findIntegrationsNeedingWatchRenewal(
    source,
    daysBeforeExpiry,
    tenantId
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
  assertValidSource(source);

  const integrationService = container.resolve(IntegrationService);
  const credentials = await integrationService.getCredentials(tenantId, source);

  if (!credentials) throw new NotFoundError('Integration', `${tenantId}/${source}`);
  return c.json({ data: credentials });
});

/**
 * Get integration metadata (without exposing keys)
 */
app.get('/:tenantId/:source', async (c) => {
  const tenantId = c.req.param('tenantId');
  const source = c.req.param('source');
  assertValidSource(source);

  const integrationService = container.resolve(IntegrationService);
  const integration = await integrationService.getIntegration(tenantId, source);

  if (!integration) throw new NotFoundError('Integration', `${tenantId}/${source}`);
  return c.json({ data: integration });
});

/**
 * Update token expiration (for OAuth refresh)
 */
app.put('/:tenantId/:source/token-expiration', async (c) => {
  const tenantId = c.req.param('tenantId');
  const source = c.req.param('source');
  const { expiresAt } = await c.req.json();

  assertValidSource(source);
  if (!expiresAt) throw new InvalidInputError('expiresAt is required');

  const integrationService = container.resolve(IntegrationService);
  await integrationService.updateTokenExpiration(tenantId, source, new Date(expiresAt));
  return c.json({ success: true });
});

/**
 * Update refresh token (for OAuth re-authorization)
 */
app.put('/:tenantId/:source/refresh-token', async (c) => {
  const tenantId = c.req.param('tenantId');
  const source = c.req.param('source');
  const { refreshToken } = await c.req.json();

  assertValidSource(source);
  if (!refreshToken) throw new InvalidInputError('refreshToken is required');

  const integrationService = container.resolve(IntegrationService);
  await integrationService.updateRefreshToken(tenantId, source, refreshToken);
  logger.info({ tenantId, source }, 'Refresh token updated successfully');
  return c.json({ success: true, message: 'Refresh token updated' });
});

/**
 * Update integration keys (partial update)
 */
app.patch('/:tenantId/:source/keys', async (c) => {
  const tenantId = c.req.param('tenantId');
  const source = c.req.param('source');
  const { keys, updatedBy } = await c.req.json();

  assertValidSource(source);
  if (!keys) throw new InvalidInputError('keys is required');

  const integrationService = container.resolve(IntegrationService);
  const integration = await integrationService.updateKeys(tenantId, source, { keys, updatedBy });
  return c.json({ integration });
});

/**
 * Get integration by ID
 * GET /api/integrations/:integrationId
 */
app.get('/:integrationId', async (c) => {
  const integrationId = c.req.param('integrationId');

  const integrationService = container.resolve(IntegrationService);
  const integration = await integrationService.getById(integrationId);

  if (!integration) throw new NotFoundError('Integration', integrationId);
  return c.json({ data: integration });
});

/**
 * Update run state (lastRunToken, lastRunAt) by integration ID
 */
app.patch('/:integrationId/run-state', async (c) => {
  const integrationId = c.req.param('integrationId');
  const body = await c.req.json();
  const state = updateRunStateSchema.parse(body);

  const integrationService = container.resolve(IntegrationService);
  await integrationService.updateRunState(integrationId, state);
  return c.json({ success: true });
});

/**
 * Update access token after refresh by integration ID
 */
app.patch('/:integrationId/access-token', async (c) => {
  const integrationId = c.req.param('integrationId');
  const body = await c.req.json();
  const data = updateAccessTokenSchema.parse(body);

  const integrationService = container.resolve(IntegrationService);
  await integrationService.updateAccessToken(integrationId, data);
  return c.json({ success: true });
});

/**
 * Update watch expiry timestamps by integration ID
 */
app.patch('/:integrationId/watch-expiry', async (c) => {
  const integrationId = c.req.param('integrationId');
  const body = await c.req.json();
  const data = updateWatchExpirySchema.parse(body);

  const integrationService = container.resolve(IntegrationService);
  await integrationService.updateWatchExpiry(integrationId, data);
  return c.json({ success: true });
});

/**
 * Update integration parameters by integration ID
 * Used for settings like blacklist emails, etc.
 */
app.patch('/:integrationId/parameters', async (c) => {
  const integrationId = c.req.param('integrationId');
  const body = await c.req.json();
  const data = updateParametersRequestSchema.parse(body);

  const integrationService = container.resolve(IntegrationService);
  await integrationService.updateParameters(integrationId, data.parameters);
  return c.json({ success: true });
});

/**
 * Get watch status (for debugging)
 */
app.get('/:tenantId/:source/watch-status', async (c) => {
  const tenantId = c.req.param('tenantId');
  const source = c.req.param('source');
  assertValidSource(source);

  const integrationService = container.resolve(IntegrationService);
  const integration = await integrationService.getIntegration(tenantId, source);

  if (!integration) throw new NotFoundError('Integration', `${tenantId}/${source}`);

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

  assertValidSource(source);

  // Stop Gmail watch first. Fail-soft: a failed stop shouldn't block deactivation.
  if (source === 'gmail') {
    try {
      const gmailServiceUrl = getEnv().SERVICE_GMAIL_URL;
      if (gmailServiceUrl) {
        const watchResponse = await internalFetch(`${gmailServiceUrl}/api/watch?tenantId=${tenantId}`, {
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
        { tenantId, source, error: watchError },
        'Failed to stop Gmail watch - continuing with deactivation'
      );
    }
  }

  const integrationService = container.resolve(IntegrationService);
  await integrationService.deactivate(tenantId, source, updatedBy);

  return c.json({ message: 'Integration disconnected', tenantId, source });
});

export default app;
