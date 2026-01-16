import { withRetry } from '@crm/shared';
import { gmail_v1 } from 'googleapis';
import { GmailClientFactory } from './gmail-client-factory';
import { logger } from '../utils/logger';

interface FetchEmailsOptions {
  maxResults?: number;
  pageToken?: string;
  query?: string;
  labelIds?: string[];
}

export class GmailService {
  constructor(private clientFactory: GmailClientFactory) {}

  /**
   * Sleep for a given number of milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Get Gmail API client for tenant
   */
  private async getClient(tenantId: string): Promise<gmail_v1.Gmail> {
    return this.clientFactory.getClient(tenantId);
  }

  /**
   * Fetch message list with pagination
   */
  async listMessages(
    tenantId: string,
    options: FetchEmailsOptions = {}
  ): Promise<{ messages: gmail_v1.Schema$Message[]; nextPageToken?: string }> {
    return withRetry(
      async () => {
        const gmail = await this.getClient(tenantId);

        const response = await gmail.users.messages.list({
          userId: 'me',
          maxResults: options.maxResults || 100,
          pageToken: options.pageToken,
          q: options.query,
          labelIds: options.labelIds,
        });

        return {
          messages: response.data.messages || [],
          nextPageToken: response.data.nextPageToken || undefined,
        };
      },
      {
        onRetry: async (attempt, error) => {
          const statusCode = error?.code || error?.response?.status;
          const errorMessage = error?.message || error?.response?.statusText || 'Unknown error';
          const backoffMs = Math.min(1000 * Math.pow(2, attempt), 32000);
          logger.warn(
            {
              method: 'users.messages.list',
              attempt: attempt + 1,
              statusCode,
              errorMessage,
              backoffMs,
            },
            'Rate limit hit, retrying'
          );
        },
      }
    );
  }

  /**
   * Get full message details
   */
  async getMessage(tenantId: string, messageId: string): Promise<gmail_v1.Schema$Message> {
    return withRetry(async () => {
      const gmail = await this.getClient(tenantId);

      const response = await gmail.users.messages.get({
        userId: 'me',
        id: messageId,
        format: 'full',
      });

      return response.data;
    });
  }

  /**
   * Batch get messages using Gmail's batch API for efficiency
   * Bundles multiple messages.get calls into a single HTTP request
   * Handles 404 (deleted/trashed/spam) by skipping those messages
   * Handles 401 by refreshing token and retrying the batch
   */
  async batchGetMessages(tenantId: string, messageIds: string[]): Promise<gmail_v1.Schema$Message[]> {
    if (messageIds.length === 0) {
      return [];
    }

    const BATCH_SIZE = 50; // Gmail recommends <= 50 requests per batch to avoid rate limiting
    const messages: gmail_v1.Schema$Message[] = [];
    let skippedCount = 0;

    logger.info(
      { tenantId, totalMessages: messageIds.length, batchSize: BATCH_SIZE },
      'Fetching messages using batch API'
    );

    // Process in batches of 100 (Gmail batch API limit)
    for (let i = 0; i < messageIds.length; i += BATCH_SIZE) {
      const batchMessageIds = messageIds.slice(i, i + BATCH_SIZE);
      const batchNumber = Math.floor(i / BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(messageIds.length / BATCH_SIZE);

      logger.info(
        { tenantId, batchNumber, totalBatches, batchSize: batchMessageIds.length },
        'Processing batch'
      );

      try {
        const batchResult = await withRetry(
          async () => this.executeBatchGet(tenantId, batchMessageIds),
          {
            shouldRetry: (error) => {
              const statusCode = error?.code || error?.response?.status;
              return statusCode === 429 || statusCode === 403 || statusCode === 401;
            },
            onRetry: async (attempt, error) => {
              const statusCode = error?.code || error?.response?.status;

              if (statusCode === 401) {
                logger.warn(
                  { tenantId, batchNumber, attempt: attempt + 1 },
                  'Token expired (401), refreshing before retry'
                );
                await this.clientFactory.ensureValidTokenAndRefresh(tenantId);
              } else {
                logger.warn(
                  { tenantId, batchNumber, attempt: attempt + 1, statusCode },
                  'Batch request failed, retrying'
                );
              }
            },
          }
        );

        messages.push(...batchResult.messages);
        skippedCount += batchResult.skipped;

        logger.info(
          { tenantId, batchNumber, totalBatches, fetched: batchResult.messages.length, skipped: batchResult.skipped },
          'Batch completed'
        );
      } catch (error: any) {
        logger.error(
          { tenantId, batchNumber, error: error.message, fetchedSoFar: messages.length },
          'Batch failed after retries, returning collected messages for checkpointing'
        );
        break;
      }

      // Small delay between batches to avoid rate limits
      if (i + BATCH_SIZE < messageIds.length) {
        await this.sleep(100);
      }
    }

    if (skippedCount > 0) {
      logger.info(
        { tenantId, skippedCount, fetchedCount: messages.length, totalRequested: messageIds.length },
        'Completed batch fetch with some messages skipped (deleted/trashed/spam)'
      );
    }

    return messages;
  }

  /**
   * Execute a batch request to get multiple messages in a single HTTP call
   * Uses googleapis-batcher to automatically batch concurrent requests
   */
  private async executeBatchGet(
    tenantId: string,
    messageIds: string[]
  ): Promise<{ messages: gmail_v1.Schema$Message[]; skipped: number }> {
    // Get batch-enabled client (automatically batches concurrent requests)
    const gmail = await this.clientFactory.getBatchClient(tenantId, 50);
    const messages: gmail_v1.Schema$Message[] = [];
    let skipped = 0;

    // Create concurrent requests - googleapis-batcher will automatically
    // bundle these into a single multipart/mixed HTTP request
    const requests = messageIds.map((id) =>
      gmail.users.messages.get({
        userId: 'me',
        id,
        format: 'full',
      })
    );

    // Promise.allSettled triggers the batch - library intercepts and batches them
    const results = await Promise.allSettled(requests);

    for (let i = 0; i < results.length; i++) {
      const result = results[i];

      if (result.status === 'fulfilled') {
        messages.push(result.value.data);
      } else {
        const error = result.reason;
        const statusCode = error?.code || error?.response?.status;

        if (statusCode === 404) {
          // Message was deleted/trashed/spam - skip it
          skipped++;
          logger.debug(
            { tenantId, messageId: messageIds[i] },
            'Message not found (deleted/trashed/spam)'
          );
        } else {
          // For other errors, log but continue processing the batch
          logger.warn(
            { tenantId, messageId: messageIds[i], statusCode, error: error.message },
            'Failed to fetch message in batch'
          );
          skipped++;
        }
      }
    }

    return { messages, skipped };
  }

  /**
   * Batch get message headers only (metadata format - no body content)
   * Used for filtering before fetching full content
   * Returns message ID and From header for blacklist filtering
   */
  async batchGetMessageHeaders(
    tenantId: string,
    messageIds: string[]
  ): Promise<Array<{ id: string; from: string | null; historyId: string | null }>> {
    if (messageIds.length === 0) {
      return [];
    }

    const BATCH_SIZE = 50;
    const headers: Array<{ id: string; from: string | null; historyId: string | null }> = [];

    logger.info(
      { tenantId, totalMessages: messageIds.length },
      'Fetching message headers for blacklist filtering'
    );

    for (let i = 0; i < messageIds.length; i += BATCH_SIZE) {
      const batchMessageIds = messageIds.slice(i, i + BATCH_SIZE);

      try {
        const batchResult = await withRetry(
          async () => this.executeBatchGetHeaders(tenantId, batchMessageIds),
          {
            shouldRetry: (error) => {
              const statusCode = error?.code || error?.response?.status;
              return statusCode === 429 || statusCode === 403 || statusCode === 401;
            },
            onRetry: async (attempt, error) => {
              const statusCode = error?.code || error?.response?.status;
              if (statusCode === 401) {
                await this.clientFactory.ensureValidTokenAndRefresh(tenantId);
              }
            },
          }
        );

        headers.push(...batchResult);
      } catch (error: any) {
        logger.error(
          { tenantId, error: error.message },
          'Failed to fetch message headers'
        );
        break;
      }

      if (i + BATCH_SIZE < messageIds.length) {
        await this.sleep(100);
      }
    }

    return headers;
  }

  /**
   * Execute batch request to get message headers (metadata only)
   */
  private async executeBatchGetHeaders(
    tenantId: string,
    messageIds: string[]
  ): Promise<Array<{ id: string; from: string | null; historyId: string | null }>> {
    const gmail = await this.clientFactory.getBatchClient(tenantId, 50);
    const headers: Array<{ id: string; from: string | null; historyId: string | null }> = [];

    // Request only metadata format with From header
    const requests = messageIds.map((id) =>
      gmail.users.messages.get({
        userId: 'me',
        id,
        format: 'metadata',
        metadataHeaders: ['From'],
      })
    );

    const results = await Promise.allSettled(requests);

    for (let i = 0; i < results.length; i++) {
      const result = results[i];

      if (result.status === 'fulfilled') {
        const message = result.value.data;
        const fromHeader = message.payload?.headers?.find(
          (h) => h.name?.toLowerCase() === 'from'
        );
        headers.push({
          id: message.id!,
          from: fromHeader?.value || null,
          historyId: message.historyId || null,
        });
      } else {
        // Skip messages that can't be fetched (deleted/trashed/etc)
        logger.debug(
          { tenantId, messageId: messageIds[i] },
          'Message header not found'
        );
      }
    }

    return headers;
  }

  /**
   * Fetch emails using History API (for incremental sync)
   */
  async fetchHistory(
    tenantId: string,
    startHistoryId: string,
    historyTypes?: string[]
  ): Promise<{ history: gmail_v1.Schema$History[]; historyId: string }> {
    return withRetry(async () => {
      const gmail = await this.getClient(tenantId);

      const response = await gmail.users.history.list({
        userId: 'me',
        startHistoryId,
        historyTypes: historyTypes || ['messageAdded'],
        maxResults: 500,
      });

      return {
        history: response.data.history || [],
        historyId: response.data.historyId || startHistoryId,
      };
    });
  }

  /**
   * Get current history ID (used to initialize watch)
   */
  async getCurrentHistoryId(tenantId: string): Promise<string> {
    return withRetry(async () => {
      const gmail = await this.getClient(tenantId);

      const response = await gmail.users.getProfile({
        userId: 'me',
      });

      if (!response.data.historyId) {
        throw new Error('Failed to get current history ID');
      }

      return response.data.historyId;
    });
  }

  /**
   * Set up Gmail push notifications
   */
  async setupWatch(
    tenantId: string,
    topicName: string
  ): Promise<{ historyId: string; expiration: string }> {
    return withRetry(async () => {
      const gmail = await this.getClient(tenantId);

      const response = await gmail.users.watch({
        userId: 'me',
        requestBody: {
          topicName,
          labelIds: ['INBOX'], // Only watch inbox, customize as needed
        },
      });

      return {
        historyId: response.data.historyId!,
        expiration: response.data.expiration!,
      };
    });
  }

  /**
   * Stop Gmail push notifications
   */
  async stopWatch(tenantId: string): Promise<void> {
    return withRetry(async () => {
      const gmail = await this.getClient(tenantId);

      await gmail.users.stop({
        userId: 'me',
      });
    });
  }

}
