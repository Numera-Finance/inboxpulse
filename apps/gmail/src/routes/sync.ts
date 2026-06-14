import { Hono } from 'hono';
import { IntegrationClient, RunClient, EmailClient } from '@crm/clients';
import { NotFoundError } from '@crm/shared';
import { SyncService } from '../services/sync';
import { GmailClientFactory } from '../services/gmail-client-factory';
import { GmailService } from '../services/gmail';
import { EmailParserService } from '../services/email-parser';
import { logger } from '../utils/logger';
import { getEnv } from '../env';

const app = new Hono();

// API service base URL for clients (lazy to ensure env is loaded)
const getApiBaseUrl = (): string => getEnv().SERVICE_API_URL;

/**
 * Trigger incremental sync
 */
app.post('/:tenantId', async (c) => {
  const tenantId = c.req.param('tenantId');

  logger.info({ tenantId }, 'Triggering incremental sync');

  const apiBaseUrl = getApiBaseUrl();
  const integrationClient = new IntegrationClient(apiBaseUrl, { internal: true });
  const runClient = new RunClient(apiBaseUrl, { internal: true });
  const gmailClientFactory = new GmailClientFactory(integrationClient);
  const gmailService = new GmailService(gmailClientFactory);
  const emailParser = new EmailParserService();
  const emailClient = new EmailClient(apiBaseUrl, { internal: true });
  const syncService = new SyncService(
    integrationClient,
    runClient,
    emailClient,
    gmailService,
    emailParser
  );

  const integration = await integrationClient.getByTenantAndSource(tenantId, 'gmail');
  if (!integration) throw new NotFoundError('Gmail integration', tenantId);

  const run = await runClient.create({
    integrationId: integration.id,
    tenantId,
    runType: 'incremental',
    status: 'running',
  });

  // Start sync in background — errors here can't propagate to the request, so
  // they're logged and persisted to the run row directly.
  syncService.incrementalSync(integration, run.id).catch((error) => {
    logger.error({ tenantId, runId: run.id, error }, 'Incremental sync failed');
    runClient.update(run.id, {
      status: 'failed',
      errorMessage: error.message,
      errorStack: error.stack,
      completedAt: new Date(),
    }).catch((updateError) => {
      logger.error({ runId: run.id, error: updateError }, 'Failed to update run status');
    });
  });

  return c.json({ message: 'Incremental sync started', tenantId, runId: run.id });
});

/**
 * Trigger initial sync (last 30 days)
 */
app.post('/:tenantId/initial', async (c) => {
  const tenantId = c.req.param('tenantId');

  logger.info({ tenantId }, 'Triggering initial sync');

  const apiBaseUrl = getApiBaseUrl();
  const integrationClient = new IntegrationClient(apiBaseUrl, { internal: true });
  const runClient = new RunClient(apiBaseUrl, { internal: true });
  const gmailClientFactory = new GmailClientFactory(integrationClient);
  const gmailService = new GmailService(gmailClientFactory);
  const emailParser = new EmailParserService();
  const emailClient = new EmailClient(apiBaseUrl, { internal: true });
  const syncService = new SyncService(
    integrationClient,
    runClient,
    emailClient,
    gmailService,
    emailParser
  );

  const integration = await integrationClient.getByTenantAndSource(tenantId, 'gmail');
  if (!integration) throw new NotFoundError('Gmail integration', tenantId);

  const run = await runClient.create({
    integrationId: integration.id,
    tenantId,
    runType: 'initial',
    status: 'running',
  });

  // Start sync in background — errors here can't propagate to the request, so
  // they're logged and persisted to the run row directly.
  syncService.initialSync(integration, run.id).catch((error) => {
    logger.error({ tenantId, runId: run.id, error }, 'Initial sync failed');
    runClient.update(run.id, {
      status: 'failed',
      errorMessage: error.message,
      errorStack: error.stack,
      completedAt: new Date(),
    }).catch((updateError) => {
      logger.error({ runId: run.id, error: updateError }, 'Failed to update run status');
    });
  });

  return c.json({ message: 'Initial sync started', tenantId, runId: run.id });
});

/**
 * Trigger historical sync
 */
app.post('/:tenantId/historical', async (c) => {
  const tenantId = c.req.param('tenantId');
  const body = await c.req.json();

  const startDate = body.startDate || getDate30DaysAgo();
  const endDate = body.endDate || new Date().toISOString();

  logger.info({ tenantId, startDate, endDate }, 'Triggering historical sync');

  // Historical sync would need a separate method in SyncService
  // For now, just return not implemented
  return c.json({ error: 'Historical sync not implemented without Inngest' }, 501);
});

/**
 * Get sync status/history for tenant
 */
app.get('/:tenantId/status', async (c) => {
  const tenantId = c.req.param('tenantId');

  const apiBaseUrl = getApiBaseUrl();
  const integrationClient = new IntegrationClient(apiBaseUrl, { internal: true });
  const runClient = new RunClient(apiBaseUrl, { internal: true });

  const [runs, integration] = await Promise.all([
    runClient.findByTenant(tenantId, 10),
    integrationClient.getByTenantAndSource(tenantId, 'gmail'),
  ]);

  return c.json({
    integration: {
      id: integration?.id,
      lastRunAt: integration?.lastRunAt,
      lastRunToken: integration?.lastRunToken,
    },
    recentRuns: runs,
  });
});

/**
 * Get specific run details
 */
app.get('/:tenantId/runs/:runId', async (c) => {
  const runId = c.req.param('runId');

  const runClient = new RunClient(getApiBaseUrl(), { internal: true });
  const run = await runClient.getById(runId);

  if (!run) throw new NotFoundError('Run', runId);

  return c.json({ run });
});


function getDate30DaysAgo(): string {
  const date = new Date();
  date.setDate(date.getDate() - 30);
  return date.toISOString();
}

export default app;
