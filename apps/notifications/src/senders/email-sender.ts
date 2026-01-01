/**
 * Postmark Email Sender
 *
 * Implements ChannelSender interface for sending emails via Postmark.
 * Supports EMAIL_OVERRIDE for development/testing.
 */

import type { ChannelPayload, ChannelSender, SendResult } from '@crm/notifications';
import { logger } from '../utils/logger';

// =============================================================================
// Configuration
// =============================================================================

const FROM_EMAIL = process.env.FROM_EMAIL || 'hello@9mo.ai';
const FROM_NAME = process.env.FROM_NAME || 'MSCFO Email Sentiment';

// =============================================================================
// Postmark Email Sender
// =============================================================================

export class PostmarkEmailSender implements ChannelSender {
  private serverToken: string | undefined;
  private emailOverride: string | undefined;

  constructor() {
    this.serverToken = process.env.POSTMARK_API_TOKEN;
    this.emailOverride = process.env.EMAIL_OVERRIDE;

    if (!this.serverToken) {
      logger.warn('POSTMARK_API_TOKEN not set - emails will not be sent');
    }

    if (this.emailOverride) {
      logger.info({ override: this.emailOverride }, 'EMAIL_OVERRIDE is set - all emails will be redirected');
    }
  }

  async send(payload: ChannelPayload): Promise<SendResult> {
    // Only handle email channel
    if (payload.channel !== 'email') {
      return {
        sent: false,
        skipped: true,
        skipReason: `PostmarkEmailSender only handles email, got: ${payload.channel}`,
      };
    }

    if (!this.serverToken) {
      return {
        sent: false,
        skipped: true,
        skipReason: 'POSTMARK_API_TOKEN not configured',
      };
    }

    // Determine recipient (override in dev, actual in production)
    const actualRecipient = payload.to;
    const effectiveRecipient = this.emailOverride || actualRecipient;

    // Build subject (add prefix if overriding)
    let subject = payload.subject;
    if (this.emailOverride && actualRecipient !== this.emailOverride) {
      subject = `[To: ${actualRecipient}] ${subject}`;
    }

    try {
      const response = await fetch('https://api.postmarkapp.com/email', {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'X-Postmark-Server-Token': this.serverToken,
        },
        body: JSON.stringify({
          From: payload.from || `${FROM_NAME} <${FROM_EMAIL}>`,
          To: effectiveRecipient,
          Subject: subject,
          HtmlBody: payload.html,
          TextBody: payload.text,
          MessageStream: 'outbound',
        }),
      });

      const data = (await response.json()) as {
        MessageID?: string;
        ErrorCode?: number;
        Message?: string;
      };

      if (!response.ok || (data.ErrorCode && data.ErrorCode !== 0)) {
        logger.error(
          { recipient: effectiveRecipient, error: data.Message },
          'Postmark send failed'
        );
        return {
          sent: false,
          skipped: false,
          error: data.Message || `HTTP ${response.status}`,
        };
      }

      logger.info(
        {
          messageId: data.MessageID,
          recipient: effectiveRecipient,
          originalRecipient: this.emailOverride ? actualRecipient : undefined,
        },
        'Email sent via Postmark'
      );

      return {
        sent: true,
        skipped: false,
        messageId: data.MessageID,
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error({ error: message }, 'Failed to send email via Postmark');
      return {
        sent: false,
        skipped: false,
        error: message,
      };
    }
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

let emailSenderInstance: PostmarkEmailSender | null = null;

export function getEmailSender(): PostmarkEmailSender {
  if (!emailSenderInstance) {
    emailSenderInstance = new PostmarkEmailSender();
  }
  return emailSenderInstance;
}
