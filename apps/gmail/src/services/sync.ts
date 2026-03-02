import { IntegrationClient, RunClient, EmailClient, Integration } from '@crm/clients';
import { GmailService } from './gmail';
import { EmailParserService } from './email-parser';
import { logger } from '../utils/logger';
import { getEnv } from '../env';

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
   * Uses two-phase fetch when blacklist is configured:
   * 1. Fetch headers only to check sender
   * 2. Fetch full content only for non-blacklisted messages
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

    // Fetch integration credentials to get blacklist entries (emails and domains)
    const credentials = await this.integrationClient.getCredentials(tenantId, 'gmail');
    const blacklistEntries: string[] = Array.isArray(credentials?.blacklistEmails) ? credentials.blacklistEmails : [];

    // Partition blacklist into email addresses and domains
    const emailBlacklist = new Set<string>();
    const domainBlacklist = new Set<string>();
    for (const entry of blacklistEntries) {
      const normalized = entry.toLowerCase();
      if (normalized.includes('@')) {
        emailBlacklist.add(normalized);
      } else {
        domainBlacklist.add(normalized);
      }
    }

    if (blacklistEntries.length > 0) {
      logger.info({ integrationId, emailBlacklistCount: emailBlacklist.size, domainBlacklistCount: domainBlacklist.size }, 'Applying blacklist filter');
    }

    let totalProcessed = 0;
    let totalInserted = 0;
    let totalSkipped = 0;
    let totalBlacklisted = 0;

    for (let i = 0; i < messageIds.length; i += CHUNK_SIZE) {
      const chunkMessageIds = messageIds.slice(i, i + CHUNK_SIZE);
      let filteredMessageIds = chunkMessageIds;
      let highestHistoryId: string | null = null;

      // Phase 1: If blacklist is configured, fetch headers first to filter
      if (emailBlacklist.size > 0 || domainBlacklist.size > 0) {
        const headers = await this.gmailService.batchGetMessageHeaders(tenantId, chunkMessageIds);

        // Filter out blacklisted senders and track highest historyId
        filteredMessageIds = [];
        for (const header of headers) {
          // Track highest historyId for checkpointing (even for blacklisted messages)
          if (header.historyId) {
            const historyIdNum = parseInt(header.historyId, 10);
            const currentHighest = highestHistoryId ? parseInt(highestHistoryId, 10) : 0;
            if (historyIdNum > currentHighest) {
              highestHistoryId = header.historyId;
            }
          }

          // Check if sender is blacklisted (by email or domain)
          if (header.from) {
            const fromEmail = this.extractEmailFromHeader(header.from);
            if (fromEmail) {
              const normalizedFrom = fromEmail.toLowerCase();
              // Check email blacklist
              if (emailBlacklist.has(normalizedFrom)) {
                totalBlacklisted++;
                logger.debug({ integrationId, from: normalizedFrom }, 'Skipping blacklisted sender (email)');
                continue;
              }
              // Check domain blacklist
              const domain = this.extractDomainFromEmail(normalizedFrom);
              if (domain && domainBlacklist.has(domain)) {
                totalBlacklisted++;
                logger.debug({ integrationId, from: normalizedFrom, domain }, 'Skipping blacklisted sender (domain)');
                continue;
              }
            }
          }

          filteredMessageIds.push(header.id);
        }

        if (filteredMessageIds.length < chunkMessageIds.length) {
          logger.info(
            { integrationId, original: chunkMessageIds.length, filtered: filteredMessageIds.length, blacklisted: chunkMessageIds.length - filteredMessageIds.length },
            'Filtered blacklisted messages before fetching content'
          );
        }
      }

      // Phase 2: Fetch full content only for non-blacklisted messages
      if (filteredMessageIds.length === 0) {
        // All messages were blacklisted, still checkpoint
        if (highestHistoryId) {
          await this.integrationClient.updateRunState(integrationId, {
            lastRunToken: highestHistoryId,
            lastRunAt: new Date(),
          });
        }
        totalProcessed += chunkMessageIds.length;
        continue;
      }

      const messages = await this.gmailService.batchGetMessages(tenantId, filteredMessageIds);

      if (messages.length === 0) continue;

      // Sort by historyId to ensure checkpoint is the highest historyId in this chunk
      messages.sort((a, b) => {
        const historyA = parseInt(a.historyId || '0', 10);
        const historyB = parseInt(b.historyId || '0', 10);
        return historyA - historyB;
      });

      // Parse and save to DB
      const emailCollections = this.emailParser.parseMessages(messages, 'gmail');
      const result = await this.emailClient.bulkInsertWithThreads(
        tenantId,
        integrationId,
        emailCollections,
        runId
      );

      totalProcessed += chunkMessageIds.length; // Count original chunk size
      totalInserted += result.insertedCount || 0;
      totalSkipped += result.skippedCount || 0;

      // Checkpoint with highest historyId (from headers or messages)
      const lastMessage = messages[messages.length - 1];
      const checkpointHistoryId = highestHistoryId && parseInt(highestHistoryId, 10) > parseInt(lastMessage.historyId || '0', 10)
        ? highestHistoryId
        : lastMessage.historyId;

      if (checkpointHistoryId) {
        await this.integrationClient.updateRunState(integrationId, {
          lastRunToken: checkpointHistoryId,
          lastRunAt: new Date(),
        });
      }

      await this.runClient.update(runId, {
        itemsProcessed: totalProcessed,
        itemsInserted: totalInserted,
        itemsSkipped: totalSkipped,
      });
    }

    if (totalBlacklisted > 0) {
      logger.info({ integrationId, totalBlacklisted }, 'Total messages skipped due to blacklist');
    }

    return { processed: totalProcessed, inserted: totalInserted, skipped: totalSkipped };
  }

  /**
   * Extract email address from a From header value
   * Handles formats like "Name <email@example.com>" or just "email@example.com"
   */
  private extractEmailFromHeader(fromHeader: string): string | null {
    // Try to match email in angle brackets: "Name <email@example.com>"
    const bracketMatch = fromHeader.match(/<([^>]+)>/);
    if (bracketMatch) {
      return bracketMatch[1].trim();
    }

    // Otherwise, assume the whole thing is an email
    const trimmed = fromHeader.trim();
    if (trimmed.includes('@')) {
      return trimmed;
    }

    return null;
  }

  /**
   * Extract domain from an email address (part after @)
   */
  private extractDomainFromEmail(email: string): string | null {
    const atIndex = email.lastIndexOf('@');
    if (atIndex === -1) return null;
    return email.substring(atIndex + 1).toLowerCase();
  }

  /**
   * Renew watch for a specific integration
   */
  async renewWatch(integration: Integration): Promise<{ historyId: string; watchExpiresAt: Date; watchSetAt: Date }> {
    const topicName = getEnv().GMAIL_PUBSUB_TOPIC;

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

    const topicName = getEnv().GMAIL_PUBSUB_TOPIC;

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
