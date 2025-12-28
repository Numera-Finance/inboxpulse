/**
 * Amazon SES Email Provider
 *
 * Uses AWS SDK v3 for sending emails via SES
 */

import type { EmailProvider, EmailSendParams, EmailSendResult } from '../types';

export interface SesProviderConfig {
  region: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  // If not provided, uses default credential chain (IAM role, env vars, etc.)
}

export class SesProvider implements EmailProvider {
  readonly name = 'ses';
  private client: any; // SESClient from @aws-sdk/client-ses
  private initialized = false;

  constructor(private config: SesProviderConfig) {}

  private async getClient() {
    if (!this.initialized) {
      // Dynamic import to avoid requiring aws-sdk if not used
      const { SESClient } = await import('@aws-sdk/client-ses');

      const clientConfig: any = {
        region: this.config.region,
      };

      if (this.config.accessKeyId && this.config.secretAccessKey) {
        clientConfig.credentials = {
          accessKeyId: this.config.accessKeyId,
          secretAccessKey: this.config.secretAccessKey,
        };
      }

      this.client = new SESClient(clientConfig);
      this.initialized = true;
    }
    return this.client;
  }

  async send(params: EmailSendParams): Promise<EmailSendResult> {
    try {
      const { SendEmailCommand } = await import('@aws-sdk/client-ses');
      const client = await this.getClient();

      const toAddresses = Array.isArray(params.to) ? params.to : [params.to];
      const source = params.fromName
        ? `${params.fromName} <${params.from}>`
        : params.from;

      const command = new SendEmailCommand({
        Source: source,
        Destination: {
          ToAddresses: toAddresses,
        },
        Message: {
          Subject: {
            Data: params.subject,
            Charset: 'UTF-8',
          },
          Body: {
            ...(params.html && {
              Html: {
                Data: params.html,
                Charset: 'UTF-8',
              },
            }),
            ...(params.text && {
              Text: {
                Data: params.text,
                Charset: 'UTF-8',
              },
            }),
          },
        },
        ...(params.replyTo && {
          ReplyToAddresses: [params.replyTo],
        }),
        ...(params.tags && params.tags.length > 0 && {
          Tags: params.tags.map((tag, index) => ({
            Name: `tag_${index}`,
            Value: tag,
          })),
        }),
      });

      const response = await client.send(command);

      return {
        success: true,
        messageId: response.MessageId,
        provider: this.name,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
        errorCode: error.Code || error.name,
        provider: this.name,
      };
    }
  }

  async validateConfig(): Promise<boolean> {
    try {
      await this.getClient();
      return true;
    } catch {
      return false;
    }
  }

  async healthCheck(): Promise<{ healthy: boolean; latencyMs?: number; error?: string }> {
    const start = Date.now();
    try {
      // Just verify we can create the client
      await this.getClient();
      return {
        healthy: true,
        latencyMs: Date.now() - start,
      };
    } catch (error: any) {
      return {
        healthy: false,
        latencyMs: Date.now() - start,
        error: error.message,
      };
    }
  }
}
