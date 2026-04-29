/**
 * SES Email Sender
 *
 * Implements ChannelSender interface for sending emails via Amazon SES.
 * Honors EMAIL_BCC to silently BCC monitoring addresses on every send.
 */

import type { ChannelPayload, ChannelSender, SendResult } from '@crm/notifications';
import { logger } from '../utils/logger';
import { getEnv } from '../env';

// =============================================================================
// SES Email Sender
// =============================================================================

export class SesEmailSender implements ChannelSender {
  private client: unknown | null = null;
  private initialized = false;
  /** Comma-separated BCC list. Added to every outbound email so we can monitor delivery in production. */
  private bccEmails: string[];

  constructor() {
    const env = getEnv();
    this.bccEmails = env.EMAIL_BCC
      .split(',')
      .map(e => e.trim())
      .filter(Boolean);

    if (!env.AWS_ACCESS_KEY_ID || !env.AWS_SECRET_ACCESS_KEY) {
      logger.warn('AWS SES credentials not set - emails will not be sent');
    }

    if (this.bccEmails.length > 0) {
      logger.info({ bccEmails: this.bccEmails }, 'EMAIL_BCC is active - all emails will BCC these addresses');
    }
  }

  private async getClient() {
    if (!this.initialized) {
      const { SESClient } = await import('@aws-sdk/client-ses');
      const env = getEnv();

      this.client = new SESClient({
        region: env.AWS_REGION,
        ...(env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY && {
          credentials: {
            accessKeyId: env.AWS_ACCESS_KEY_ID,
            secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
          },
        }),
      });
      this.initialized = true;
    }
    return this.client;
  }

  async send(payload: ChannelPayload): Promise<SendResult> {
    // Only handle email channel
    if (payload.channel !== 'email') {
      return {
        sent: false,
        skipped: true,
        skipReason: `SesEmailSender only handles email, got: ${payload.channel}`,
      };
    }

    const env = getEnv();
    if (!env.AWS_ACCESS_KEY_ID || !env.AWS_SECRET_ACCESS_KEY) {
      return {
        sent: false,
        skipped: true,
        skipReason: 'AWS SES credentials not configured',
      };
    }

    const recipient = payload.to;
    const from = payload.from || `${env.FROM_NAME} <${env.FROM_EMAIL}>`;

    try {
      const { SendEmailCommand } = await import('@aws-sdk/client-ses');
      const client = await this.getClient() as { send: (cmd: unknown) => Promise<{ MessageId?: string }> };

      const command = new SendEmailCommand({
        Source: from,
        Destination: {
          ToAddresses: [recipient],
          ...(this.bccEmails.length > 0 && { BccAddresses: this.bccEmails }),
        },
        Message: {
          Subject: { Data: payload.subject, Charset: 'UTF-8' },
          Body: {
            ...(payload.html && {
              Html: { Data: payload.html, Charset: 'UTF-8' },
            }),
            ...(payload.text && {
              Text: { Data: payload.text, Charset: 'UTF-8' },
            }),
          },
        },
      });

      const response = await client.send(command);

      logger.info(
        {
          messageId: response.MessageId,
          recipient,
          bcc: this.bccEmails.length > 0 ? this.bccEmails : undefined,
        },
        'Email sent via SES'
      );

      return {
        sent: !!response.MessageId,
        skipped: false,
        messageId: response.MessageId,
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : JSON.stringify(error);
      logger.error({ error: message, errorDetail: error, recipient }, 'Failed to send email via SES');
      return {
        sent: false,
        skipped: false,
        error: `${recipient}: ${message}`,
      };
    }
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

let emailSenderInstance: SesEmailSender | null = null;

export function getEmailSender(): SesEmailSender {
  if (!emailSenderInstance) {
    emailSenderInstance = new SesEmailSender();
  }
  return emailSenderInstance;
}
