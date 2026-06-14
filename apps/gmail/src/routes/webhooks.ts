import { Hono } from 'hono';
import { verifyPubSubToken, decodePubSubMessage } from '../utils/pubsub';
import { IntegrationClient, RunClient, EmailClient } from '@crm/clients';
import { InvalidInputError, NotFoundError, UnauthorizedError } from '@crm/shared';
import { GmailClientFactory } from '../services/gmail-client-factory';
import { GmailService } from '../services/gmail';
import { EmailParserService } from '../services/email-parser';
import { SyncService } from '../services/sync';
import { logger } from '../utils/logger';
import { getEnv } from '../env';

const app = new Hono();

// API service base URL for clients (lazy to ensure env is loaded)
const getApiBaseUrl = (): string => getEnv().SERVICE_API_URL;

/**
 * Gmail Pub/Sub webhook endpoint
 */
app.post('/pubsub', async (c) => {
  // Verify Pub/Sub token
  const authHeader = c.req.header('Authorization');
  const isValid = await verifyPubSubToken(authHeader);
  if (!isValid) throw new UnauthorizedError('Unauthorized');

  const body = await c.req.json();
  const message = body.message;
  if (!message?.data) throw new InvalidInputError('Invalid message');

  // Decode base64 data
  const data = decodePubSubMessage(message.data);
  const { emailAddress, historyId } = data;
  if (!emailAddress || !historyId) throw new InvalidInputError('Missing required fields');

  logger.info({ emailAddress, historyId }, 'Received webhook for email');

  // Find integration by email address - returns full integration with ID
  const apiBaseUrl = getApiBaseUrl();
  const integrationClient = new IntegrationClient(apiBaseUrl, { internal: true });
  const integration = await integrationClient.findByEmail(emailAddress, 'gmail');
  if (!integration) throw new NotFoundError('Integration', emailAddress);

  logger.info({ integrationId: integration.id, tenantId: integration.tenantId }, 'Found integration');

  // Create sync run for tracking
  const runClient = new RunClient(apiBaseUrl, { internal: true });
  const run = await runClient.create({
    integrationId: integration.id,
    tenantId: integration.tenantId,
    runType: 'incremental',
    status: 'running',
  });

  logger.info({ integrationId: integration.id, runId: run.id }, 'Created sync run');

  // Trigger sync in background (don't await to keep webhook fast)
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

  // Background sync — errors here can't propagate to the request, so they're
  // logged and persisted to the run row directly.
  syncService.incrementalSync(integration, run.id).catch((error) => {
    logger.error({ integrationId: integration.id, runId: run.id, error }, 'Sync failed');
    runClient.update(run.id, {
      status: 'failed',
      errorMessage: error.message,
      completedAt: new Date(),
    }).catch(() => {});
  });

  return c.json({ success: true, runId: run.id });
});

export default app;
