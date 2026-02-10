import { Hono } from 'hono';
import { verifyPubSubToken, decodePubSubMessage } from '../utils/pubsub';
import { IntegrationClient, RunClient, EmailClient } from '@crm/clients';
import { GmailClientFactory } from '../services/gmail-client-factory';
import { GmailService } from '../services/gmail';
import { EmailParserService } from '../services/email-parser';
import { SyncService } from '../services/sync';
import { logger } from '../utils/logger';

const app = new Hono();

// API service base URL for clients
const apiBaseUrl = process.env.SERVICE_API_URL;

/**
 * Gmail Pub/Sub webhook endpoint
 */
app.post('/pubsub', async (c) => {
  // Verify Pub/Sub token
  const authHeader = c.req.header('Authorization');
  const isValid = await verifyPubSubToken(authHeader);

  if (!isValid) {
    logger.warn('Unauthorized webhook request');
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const body = await c.req.json();
  const message = body.message;

  if (!message?.data) {
    logger.warn('Invalid webhook message format');
    return c.json({ error: 'Invalid message' }, 400);
  }

  try {
    // Decode base64 data
    const data = decodePubSubMessage(message.data);

    // Extract email address and historyId
    const { emailAddress, historyId } = data;

    if (!emailAddress || !historyId) {
      logger.warn({ data }, 'Missing emailAddress or historyId in webhook');
      return c.json({ error: 'Missing required fields' }, 400);
    }

    logger.info({ emailAddress, historyId }, 'Received webhook for email');

    // Find integration by email address - returns full integration with ID
    const integrationClient = new IntegrationClient(apiBaseUrl, { internal: true });
    const integration = await integrationClient.findByEmail(emailAddress, 'gmail');

    if (!integration) {
      logger.warn({ emailAddress }, 'No integration found for email address');
      return c.json({ error: 'Integration not found' }, 404);
    }

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

    // Pass the full integration object to sync service
    syncService.incrementalSync(integration, run.id).catch((error) => {
      logger.error({
        integrationId: integration.id,
        runId: run.id,
        error: {
          message: error.message,
          stack: error.stack,
          name: error.name,
        },
      }, 'Sync failed');

      runClient.update(run.id, {
        status: 'failed',
        errorMessage: error.message,
        completedAt: new Date(),
      }).catch(() => {});
    });

    return c.json({ success: true, runId: run.id });
  } catch (error: any) {
    logger.error({
      error: {
        message: error.message,
        name: error.name,
        status: error.status,
        stack: error.stack,
      },
    }, 'Webhook processing failed');
    return c.json({ error: error.message || 'Internal server error' }, error.status || 500);
  }
});

export default app;
