/**
 * Postmark Email Sender
 *
 * Implements ChannelSender interface for sending emails via Postmark.
 * Supports EMAIL_OVERRIDE for development/testing.
 */

import type { ChannelPayload, ChannelSender, SendResult } from '@crm/notifications';
import { logger } from '../utils/logger';
import { getEnv } from '../env';

// =============================================================================
// Postmark Email Sender
// =============================================================================

export class PostmarkEmailSender implements ChannelSender {
  private serverToken: string | undefined;
  /** Comma-separated override emails. When set, ALL emails are redirected to these addresses instead of the actual recipient. */
  private overrideEmails: string[];

  constructor() {
    const env = getEnv();
    this.serverToken = env.POSTMARK_API_TOKEN;
    this.overrideEmails = env.EMAIL_OVERRIDE
      .split(',')
      .map(e => e.trim())
      .filter(Boolean);

    if (!this.serverToken) {
      logger.warn('POSTMARK_API_TOKEN not set - emails will not be sent');
    }

    if (this.overrideEmails.length > 0) {
      logger.info({ overrideEmails: this.overrideEmails }, 'EMAIL_OVERRIDE is active - all emails will be redirected');
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

    // Determine recipient: if EMAIL_OVERRIDE is set, redirect ALL emails to override addresses
    const actualRecipient = payload.to;
    const effectiveRecipient = this.overrideEmails.length > 0
      ? this.overrideEmails.join(',')
      : actualRecipient;

    // Build subject (add prefix if redirecting so we know who it was originally for)
    let subject = payload.subject;
    if (this.overrideEmails.length > 0) {
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
          From: payload.from || `${getEnv().FROM_NAME} <${getEnv().FROM_EMAIL}>`,
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
          originalRecipient: this.overrideEmails.length > 0 ? actualRecipient : undefined,
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
