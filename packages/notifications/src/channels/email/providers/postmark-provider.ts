/**
 * Postmark Email Provider
 *
 * Uses Postmark API for sending transactional emails
 * https://postmarkapp.com/
 */

import type { EmailProvider, EmailSendParams, EmailSendResult } from '../types';

export interface PostmarkProviderConfig {
  serverToken: string;
  messageStream?: string; // Default: 'outbound'
}

interface PostmarkApiResponse {
  To: string;
  SubmittedAt: string;
  MessageID: string;
  ErrorCode: number;
  Message: string;
}

export class PostmarkProvider implements EmailProvider {
  readonly name = 'postmark';
  private readonly apiUrl = 'https://api.postmarkapp.com';

  constructor(private config: PostmarkProviderConfig) {}

  async send(params: EmailSendParams): Promise<EmailSendResult> {
    try {
      const toAddresses = Array.isArray(params.to) ? params.to.join(',') : params.to;
      const from = params.fromName
        ? `${params.fromName} <${params.from}>`
        : params.from;

      const body: Record<string, any> = {
        From: from,
        To: toAddresses,
        Subject: params.subject,
        MessageStream: this.config.messageStream || 'outbound',
      };

      if (params.html) {
        body.HtmlBody = params.html;
      }
      if (params.text) {
        body.TextBody = params.text;
      }
      if (params.replyTo) {
        body.ReplyTo = params.replyTo;
      }
      if (params.headers) {
        body.Headers = Object.entries(params.headers).map(([Name, Value]) => ({
          Name,
          Value,
        }));
      }
      if (params.tags && params.tags.length > 0) {
        body.Tag = params.tags[0]; // Postmark only supports one tag
      }
      if (params.metadata) {
        body.Metadata = params.metadata;
      }

      const response = await fetch(`${this.apiUrl}/email`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'X-Postmark-Server-Token': this.config.serverToken,
        },
        body: JSON.stringify(body),
      });

      const data = (await response.json()) as PostmarkApiResponse;

      if (!response.ok || data.ErrorCode !== 0) {
        return {
          success: false,
          error: data.Message,
          errorCode: String(data.ErrorCode),
          provider: this.name,
        };
      }

      return {
        success: true,
        messageId: data.MessageID,
        provider: this.name,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
        provider: this.name,
      };
    }
  }

  async validateConfig(): Promise<boolean> {
    if (!this.config.serverToken) {
      return false;
    }
    try {
      const health = await this.healthCheck();
      return health.healthy;
    } catch {
      return false;
    }
  }

  async healthCheck(): Promise<{ healthy: boolean; latencyMs?: number; error?: string }> {
    const start = Date.now();
    try {
      const response = await fetch(`${this.apiUrl}/server`, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          'X-Postmark-Server-Token': this.config.serverToken,
        },
      });

      if (!response.ok) {
        const data = await response.json() as { Message?: string };
        return {
          healthy: false,
          latencyMs: Date.now() - start,
          error: data.Message || `HTTP ${response.status}`,
        };
      }

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
