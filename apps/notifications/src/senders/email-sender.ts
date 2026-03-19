/**
 * SES Email Sender
 *
 * Implements ChannelSender interface for sending emails via Amazon SES.
 * Supports EMAIL_OVERRIDE for development/testing.
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
  /** Comma-separated override emails. When set, ALL emails are redirected to these addresses instead of the actual recipient. */
  private overrideEmails: string[];

  constructor() {
    const env = getEnv();
    this.overrideEmails = env.EMAIL_OVERRIDE
      .split(',')
      .map(e => e.trim())
      .filter(Boolean);

    if (!env.AWS_ACCESS_KEY_ID || !env.AWS_SECRET_ACCESS_KEY) {
      logger.warn('AWS SES credentials not set - emails will not be sent');
    }

    if (this.overrideEmails.length > 0) {
      logger.info({ overrideEmails: this.overrideEmails }, 'EMAIL_OVERRIDE is active - all emails will be redirected');
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

    // Determine recipients: if EMAIL_OVERRIDE is set, send a separate email to each override address
    const actualRecipient = payload.to;
    const recipients = this.overrideEmails.length > 0
      ? this.overrideEmails
      : [actualRecipient];

    // Build subject (add prefix if redirecting so we know who it was originally for)
    let subject = payload.subject;
    if (this.overrideEmails.length > 0) {
      subject = `[To: ${actualRecipient}] ${subject}`;
    }

    const errors: string[] = [];
    const messageIds: string[] = [];
    const from = payload.from || `${env.FROM_NAME} <${env.FROM_EMAIL}>`;

    for (const recipient of recipients) {
      try {
        const { SendEmailCommand } = await import('@aws-sdk/client-ses');
        const client = await this.getClient() as { send: (cmd: unknown) => Promise<{ MessageId?: string }> };

        const command = new SendEmailCommand({
          Source: from,
          Destination: {
            ToAddresses: [recipient],
          },
          Message: {
            Subject: { Data: subject, Charset: 'UTF-8' },
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
            originalRecipient: this.overrideEmails.length > 0 ? actualRecipient : undefined,
          },
          'Email sent via SES'
        );

        if (response.MessageId) {
          messageIds.push(response.MessageId);
        }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : JSON.stringify(error);
        logger.error({ error: message, errorDetail: error, recipient }, 'Failed to send email via SES');
        errors.push(`${recipient}: ${message}`);
      }
    }

    if (messageIds.length === 0) {
      return {
        sent: false,
        skipped: false,
        error: errors.join('; '),
      };
    }

    return {
      sent: true,
      skipped: false,
      messageId: messageIds.join(','),
    };
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
