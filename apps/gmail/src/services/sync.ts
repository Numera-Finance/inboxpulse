import { IntegrationClient, RunClient, EmailClient, Integration } from '@crm/clients';
import { GmailService } from './gmail';
import { EmailParserService } from './email-parser';
import { logger } from '../utils/logger';

export class SyncService {
  constructor(
    private integrationClient: IntegrationClient,
    private runClient: RunClient,
    private emailClient: EmailClient,
    private gmailService: GmailService,
    private emailParser: EmailParserService
  ) { }

  /**
   * Perform incremental sync using History API
   * Takes the full integration object to use the correct ID for updates
   */
  async incrementalSync(integration: Integration, runId: string): Promise<void> {
    const { id: integrationId, tenantId } = integration;
    logger.info({ integrationId, runId }, 'Starting incremental sync');

    // Check if watch needs renewal before syncing
    await this.ensureWatchIsActive(integration);

    if (!integration.lastRunToken) {
      logger.warn({ integrationId }, 'No history ID found, performing initial sync');
      await this.initialSync(integration, runId);
      return;
    }

    const { history, historyId: newHistoryId } = await this.gmailService.fetchHistory(
      tenantId,
      integration.lastRunToken,
      ['messageAdded']
    );

    if (!history || history.length === 0) {
      logger.info({ integrationId }, 'No new emails in history');
      await this.runClient.update(runId, {
        status: 'completed',
        completedAt: new Date(),
        itemsProcessed: 0,
      });
      return;
    }

    // Extract message IDs from history
    const messageIds: string[] = [];
    for (const historyItem of history) {
      if (historyItem.messagesAdded) {
        for (const added of historyItem.messagesAdded) {
          if (added.message?.id) {
            messageIds.push(added.message.id);
          }
        }
      }
    }

    logger.info({ integrationId, messageCount: messageIds.length }, 'Fetching messages from history');

    // Fetch and process messages
    await this.processMessageIds(integration, runId, messageIds);

    // Update history ID on integration
    await this.integrationClient.updateRunState(integrationId, {
      lastRunToken: newHistoryId,
      lastRunAt: new Date(),
    });
  }

  /**
   * Perform initial sync (last 30 days)
   */
  async initialSync(integration: Integration, runId: string): Promise<void> {
    const { id: integrationId, tenantId } = integration;
    logger.info({ integrationId, runId }, 'Starting initial sync');

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const query = `after:${Math.floor(thirtyDaysAgo.getTime() / 1000)}`;

    let totalProcessed = 0;
    let totalInserted = 0;
    let totalSkipped = 0;
    let pageToken: string | undefined;

    do {
      const { messages, nextPageToken } = await this.gmailService.listMessages(tenantId, {
        query,
        maxResults: 100,
        pageToken,
      });

      if (messages.length === 0) break;

      const messageIds = messages.map((m) => m.id!).filter(Boolean);
      const result = await this.processMessageIds(integration, runId, messageIds);

      totalProcessed += result.processed;
      totalInserted += result.inserted;
      totalSkipped += result.skipped;
      pageToken = nextPageToken;

      await this.runClient.update(runId, {
        itemsProcessed: totalProcessed,
        itemsInserted: totalInserted,
        itemsSkipped: totalSkipped,
      });
    } while (pageToken);

    // Get current history ID for future incremental syncs
    const historyId = await this.gmailService.getCurrentHistoryId(tenantId);

    await this.integrationClient.updateRunState(integrationId, {
      lastRunToken: historyId,
      lastRunAt: new Date(),
    });

    await this.runClient.update(runId, {
      status: 'completed',
      completedAt: new Date(),
      endToken: historyId,
    });
  }

  /**
   * Process message IDs in chunks with checkpointing
   */
  private async processMessageIds(
    integration: Integration,
    runId: string,
    messageIds: string[]
  ): Promise<{ processed: number; inserted: number; skipped: number }> {
    const { id: integrationId, tenantId } = integration;
    const CHUNK_SIZE = 50;

    if (messageIds.length === 0) {
      return { processed: 0, inserted: 0, skipped: 0 };
    }

    // Fetch integration credentials to get blacklist emails
    const credentials = await this.integrationClient.getCredentials(tenantId, 'gmail');
    const blacklistEmails: string[] = credentials?.blacklistEmails || [];

    if (blacklistEmails.length > 0) {
      logger.info({ integrationId, blacklistCount: blacklistEmails.length }, 'Applying email blacklist filter');
    }

    let totalProcessed = 0;
    let totalInserted = 0;
    let totalSkipped = 0;

    for (let i = 0; i < messageIds.length; i += CHUNK_SIZE) {
      const chunkMessageIds = messageIds.slice(i, i + CHUNK_SIZE);

      // Fetch this chunk of messages from Gmail
      const messages = await this.gmailService.batchGetMessages(tenantId, chunkMessageIds);

      if (messages.length === 0) continue;

      // Sort by historyId to ensure checkpoint is the highest historyId in this chunk
      messages.sort((a, b) => {
        const historyA = parseInt(a.historyId || '0', 10);
        const historyB = parseInt(b.historyId || '0', 10);
        return historyA - historyB;
      });

      // Parse and save to DB (with blacklist filtering)
      const emailCollections = this.emailParser.parseMessages(messages, 'gmail', { blacklistEmails });
      const result = await this.emailClient.bulkInsertWithThreads(
        tenantId,
        integrationId,
        emailCollections,
        runId
      );

      totalProcessed += messages.length;
      totalInserted += result.insertedCount || 0;
      totalSkipped += result.skippedCount || 0;

      // Checkpoint with last message's historyId
      const lastMessage = messages[messages.length - 1];
      if (lastMessage.historyId) {
        await this.integrationClient.updateRunState(integrationId, {
          lastRunToken: lastMessage.historyId,
          lastRunAt: new Date(),
        });
      }

      await this.runClient.update(runId, {
        itemsProcessed: totalProcessed,
        itemsInserted: totalInserted,
        itemsSkipped: totalSkipped,
      });
    }

    return { processed: totalProcessed, inserted: totalInserted, skipped: totalSkipped };
  }

  /**
   * Renew watch for a specific integration
   */
  async renewWatch(integration: Integration): Promise<{ historyId: string; watchExpiresAt: Date; watchSetAt: Date }> {
    const topicName = process.env.GMAIL_PUBSUB_TOPIC;
    if (!topicName) {
      throw new Error('GMAIL_PUBSUB_TOPIC not configured');
    }

    const { historyId, expiration } = await this.gmailService.setupWatch(integration.tenantId, topicName);

    const expirationMs = parseInt(expiration, 10);
    const watchExpiresAt = new Date(expirationMs);
    const watchSetAt = new Date();

    await this.integrationClient.updateWatchExpiry(integration.id, {
      watchSetAt,
      watchExpiresAt,
    });

    return { historyId, watchExpiresAt, watchSetAt };
  }

  /**
   * Ensure Gmail watch is active (renew if expired or about to expire)
   */
  private async ensureWatchIsActive(integration: Integration): Promise<void> {
    const needsRenewal = await this.integrationClient.needsWatchRenewal(integration);

    if (!needsRenewal) {
      logger.info({ integrationId: integration.id }, 'Watch is still active');
      return;
    }

    logger.info({ integrationId: integration.id }, 'Watch expired, renewing');

    const topicName = process.env.GMAIL_PUBSUB_TOPIC;
    if (!topicName) {
      logger.warn({ integrationId: integration.id }, 'GMAIL_PUBSUB_TOPIC not set');
      return;
    }

    try {
      const { historyId, expiration } = await this.gmailService.setupWatch(integration.tenantId, topicName);

      const expirationMs = parseInt(expiration, 10);
      const watchExpiresAt = new Date(expirationMs);
      const watchSetAt = new Date();

      await this.integrationClient.updateWatchExpiry(integration.id, {
        watchSetAt,
        watchExpiresAt,
      });

      logger.info({ integrationId: integration.id, historyId, watchExpiresAt }, 'Watch renewed');
    } catch (error: any) {
      logger.error({ integrationId: integration.id, error: error.message }, 'Failed to renew watch');
    }
  }
}
