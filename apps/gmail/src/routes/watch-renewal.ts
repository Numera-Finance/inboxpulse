import { Hono } from 'hono';
import { IntegrationClient, RunClient, EmailClient, Integration } from '@crm/clients';
import { SyncService } from '../services/sync';
import { GmailClientFactory } from '../services/gmail-client-factory';
import { GmailService } from '../services/gmail';
import { EmailParserService } from '../services/email-parser';
import { logger } from '../utils/logger';
import { getEnv } from '../env';

const app = new Hono();

// API service base URL for clients (lazy to ensure env is loaded)
const getApiBaseUrl = (): string => getEnv().SERVICE_API_URL;

// Helper to get internal API headers for service-to-service calls
type HeadersInit = NonNullable<ConstructorParameters<typeof Headers>[0]>;

function getInternalHeaders(): HeadersInit {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  const apiKey = getEnv().SERVICE_API_KEY;
  if (apiKey) {
    headers['x-internal-api-key'] = apiKey;
  }

  return headers;
}


const emailParser = new EmailParserService();

/**
 * Route to renew Gmail watches expiring within 2 days
 * Called by cron job every 4 hours
 * 
 * GET /api/watch/renew-expiring
 * 
 * Returns summary of renewals attempted
 */
app.get('/renew-expiring', async (c) => {
  logger.info('Starting watch renewal check');

  try {
    const apiBaseUrl = getApiBaseUrl();
    const integrationClient = new IntegrationClient(apiBaseUrl, { internal: true });
    const runClient = new RunClient(apiBaseUrl, { internal: true });
    const emailClient = new EmailClient(apiBaseUrl, { internal: true });
    const gmailClientFactory = new GmailClientFactory(integrationClient);
    const gmailService = new GmailService(gmailClientFactory);
    const syncService = new SyncService(
      integrationClient,
      runClient,
      emailClient,
      gmailService,
      emailParser
    );

    // Get all Gmail integrations that need watch renewal (expiring within 2 days)
    const response = await fetch(
      `${apiBaseUrl}/api/internal/integrations/watch/renewals?source=gmail&daysBeforeExpiry=2`,
      { headers: getInternalHeaders() }
    );

    if (!response.ok) {
      throw new Error(`Failed to fetch integrations: ${response.statusText}`);
    }

    const data = await response.json() as { integrations: Array<{ tenantId: string; watchExpiresAt?: string | null }> };
    const integrations = data.integrations || [];

    logger.info(
      { count: integrations.length },
      `Found ${integrations.length} integrations needing watch renewal`
    );

    const results = {
      checked: integrations.length,
      renewed: 0,
      failed: 0,
      details: [] as Array<{
        tenantId: string;
        status: 'renewed' | 'failed';
        error?: string;
      }>,
    };

    // Renew watch for each integration using SyncService
    for (const partialIntegration of integrations) {
      const { tenantId } = partialIntegration;

      try {
        logger.info({ tenantId }, 'Renewing watch for integration');

        // Fetch full integration to get ID (needed for renewWatch)
        const integration = await integrationClient.getByTenantAndSource(tenantId, 'gmail');
        if (!integration) {
          throw new Error(`Integration not found for tenant ${tenantId}`);
        }

        const { historyId, watchExpiresAt, watchSetAt } = await syncService.renewWatch(integration);

        results.renewed++;
        results.details.push({
          tenantId,
          status: 'renewed',
        });

        logger.info(
          {
            tenantId,
            historyId,
            watchSetAt,
            watchExpiresAt,
            daysUntilExpiry: Math.ceil(
              (watchExpiresAt.getTime() - watchSetAt.getTime()) / (1000 * 60 * 60 * 24)
            ),
          },
          'Watch renewed successfully'
        );
      } catch (error: any) {
        results.failed++;
        results.details.push({
          tenantId,
          status: 'failed',
          error: error.message,
        });

        logger.error(
          {
            tenantId,
            error: {
              message: error.message,
              stack: error.stack,
              name: error.name,
            },
          },
          'Failed to renew watch for integration'
        );
      }
    }

    logger.info(
      {
        checked: results.checked,
        renewed: results.renewed,
        failed: results.failed,
      },
      'Watch renewal check completed'
    );

    return c.json({
      success: true,
      summary: {
        checked: results.checked,
        renewed: results.renewed,
        failed: results.failed,
      },
      details: results.details,
    });
  } catch (error: any) {
    logger.error(
      {
        error: {
          message: error.message,
          stack: error.stack,
          name: error.name,
        },
      },
      'Failed to check and renew watches'
    );

    return c.json(
      {
        success: false,
        error: error.message,
      },
      500
    );
  }
});

/**
 * Route to setup/renew watch for specific integration(s)
 * POST /api/watch?integrationId=xxx  (setup watch for single integration)
 * POST /api/watch?tenantId=xxx       (setup watches for all Gmail integrations in tenant)
 *
 * Used for manual watch setup/renewal and automatic setup after OAuth
 */
app.post('/', async (c) => {
  const integrationId = c.req.query('integrationId');
  const tenantId = c.req.query('tenantId');

  if (!integrationId && !tenantId) {
    return c.json({ error: 'Either integrationId or tenantId query parameter is required' }, 400);
  }

  logger.info({ integrationId, tenantId }, 'Starting watch setup');

  try {
    const apiBaseUrl = getApiBaseUrl();
    const integrationClient = new IntegrationClient(apiBaseUrl, { internal: true });
    const runClient = new RunClient(apiBaseUrl, { internal: true });
    const emailClient = new EmailClient(apiBaseUrl, { internal: true });
    const gmailClientFactory = new GmailClientFactory(integrationClient);
    const gmailService = new GmailService(gmailClientFactory);
    const syncService = new SyncService(
      integrationClient,
      runClient,
      emailClient,
      gmailService,
      emailParser
    );

    // If integrationId is provided, setup watch for that specific integration
    if (integrationId) {
      // Get integration to extract tenantId
      const response = await fetch(
        `${apiBaseUrl}/api/internal/integrations/${integrationId}`,
        { headers: getInternalHeaders() }
      );

      if (!response.ok) {
        throw new Error(`Failed to fetch integration: ${response.statusText}`);
      }

      const data = await response.json() as { data: Integration };
      const integration = data.data;
      const { historyId, watchExpiresAt, watchSetAt } = await syncService.renewWatch(integration);

      const daysUntilExpiry = Math.ceil(
        (watchExpiresAt.getTime() - watchSetAt.getTime()) / (1000 * 60 * 60 * 24)
      );

      logger.info(
        {
          integrationId,
          tenantId: integration.tenantId,
          historyId,
          watchSetAt,
          watchExpiresAt,
          daysUntilExpiry,
        },
        'Watch setup successfully for integration'
      );

      return c.json({
        success: true,
        integrationId,
        tenantId: integration.tenantId,
        historyId,
        watchSetAt,
        watchExpiresAt,
        daysUntilExpiry,
      });
    }

    // If only tenantId is provided, setup watches for all Gmail integrations
    const response = await fetch(
      `${apiBaseUrl}/api/internal/integrations?tenantId=${tenantId}&source=gmail`,
      { headers: getInternalHeaders() }
    );

    if (!response.ok) {
      throw new Error(`Failed to fetch integrations: ${response.statusText}`);
    }

    const data = await response.json() as { integrations: Array<{ id: string; tenantId: string }> };
    const integrations = data.integrations || [];

    logger.info({ tenantId, count: integrations.length }, 'Setting up watches for all Gmail integrations');

    const results = [];
    let successCount = 0;
    let failCount = 0;

    for (const partialIntegration of integrations) {
      try {
        // Fetch full integration (renewWatch needs full Integration object)
        const integration = await integrationClient.getByTenantAndSource(partialIntegration.tenantId, 'gmail');
        if (!integration) {
          throw new Error(`Integration not found for tenant ${partialIntegration.tenantId}`);
        }

        const { historyId, watchExpiresAt, watchSetAt } = await syncService.renewWatch(integration);

        const daysUntilExpiry = Math.ceil(
          (watchExpiresAt.getTime() - watchSetAt.getTime()) / (1000 * 60 * 60 * 24)
        );

        results.push({
          integrationId: integration.id,
          status: 'success',
          historyId,
          watchSetAt,
          watchExpiresAt,
          daysUntilExpiry,
        });

        successCount++;

        logger.info(
          {
            integrationId: integration.id,
            tenantId,
            historyId,
            watchExpiresAt,
            daysUntilExpiry,
          },
          'Watch setup successfully'
        );
      } catch (error: any) {
        results.push({
          integrationId: partialIntegration.id,
          status: 'failed',
          error: error.message,
        });

        failCount++;

        logger.error(
          {
            integrationId: partialIntegration.id,
            tenantId: partialIntegration.tenantId,
            error: {
              message: error.message,
              stack: error.stack,
            },
          },
          'Failed to setup watch for integration'
        );
      }
    }

    return c.json({
      success: failCount === 0,
      tenantId,
      totalIntegrations: integrations.length,
      successCount,
      failCount,
      results,
    });
  } catch (error: any) {
    logger.error(
      {
        integrationId,
        tenantId,
        error: {
          message: error.message,
          stack: error.stack,
          name: error.name,
        },
      },
      'Failed to setup watch'
    );

    return c.json(
      {
        success: false,
        error: error.message,
      },
      500
    );
  }
});

/**
 * Stop watch for a specific tenant
 * DELETE /api/watch?tenantId=xxx
 *
 * Used when disconnecting an integration
 */
app.delete('/', async (c) => {
  const tenantId = c.req.query('tenantId');

  if (!tenantId) {
    return c.json({ error: 'tenantId query parameter is required' }, 400);
  }

  logger.info({ tenantId }, 'Stopping watch for integration');

  try {
    const integrationClient = new IntegrationClient(getApiBaseUrl(), { internal: true });
    const gmailClientFactory = new GmailClientFactory(integrationClient);
    const gmailService = new GmailService(gmailClientFactory);

    await gmailService.stopWatch(tenantId);

    logger.info({ tenantId }, 'Watch stopped successfully');

    return c.json({
      success: true,
      tenantId,
      message: 'Watch stopped successfully',
    });
  } catch (error: any) {
    logger.error(
      {
        tenantId,
        error: {
          message: error.message,
          stack: error.stack,
          name: error.name,
        },
      },
      'Failed to stop watch'
    );

    // Don't fail if watch stop fails - it might already be stopped
    return c.json({
      success: true,
      tenantId,
      message: 'Watch stop attempted (may have already been stopped)',
      warning: error.message,
    });
  }
});

export default app;
