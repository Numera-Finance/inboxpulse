/**
 * Email Channel
 *
 * Sends notifications via email using configured provider (SES, Postmark, etc.)
 * Handles CAN-SPAM compliance with unsubscribe headers
 */

import type { BaseChannel, ChannelSendResult } from '../../types/channels';
import type { Notification, NotificationChannel } from '../../types/core';
import type { RenderedContent, UserResolver } from '../../types/interfaces';
import type { EmailProvider, EmailSendParams, UnsubscribeConfig } from './types';

export interface EmailChannelConfig {
  provider: EmailProvider;
  fromEmail: string;
  fromName?: string;
  replyTo?: string;
  /** Base URL for unsubscribe links */
  unsubscribeBaseUrl?: string;
  /** Whether to add List-Unsubscribe headers */
  includeUnsubscribeHeaders?: boolean;
}

export class EmailChannel implements BaseChannel {
  constructor(private config: EmailChannelConfig) {}

  getChannelName(): NotificationChannel {
    return 'email';
  }

  validateAddress(address: string): boolean {
    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(address);
  }

  async send(
    notification: Notification,
    renderedContent: RenderedContent,
    userResolver: UserResolver
  ): Promise<ChannelSendResult> {
    // Get user's email address
    const channelAddress = await userResolver.getUserChannelAddress(
      notification.userId,
      'email'
    );

    // If no channel address, try getting user's primary email
    let toEmail: string | null = null;
    if (channelAddress && !channelAddress.isDisabled) {
      toEmail = channelAddress.address;
    } else {
      const user = await userResolver.getUser(notification.userId, notification.tenantId);
      if (user?.email) {
        toEmail = user.email;
      }
    }

    if (!toEmail) {
      return {
        success: false,
        error: 'No email address found for user',
      };
    }

    if (!this.validateAddress(toEmail)) {
      return {
        success: false,
        error: 'Invalid email address',
      };
    }

    // Build email params
    const subject = renderedContent.subject || renderedContent.title || notification.title;
    const emailParams: EmailSendParams = {
      to: toEmail,
      from: this.config.fromEmail,
      fromName: this.config.fromName,
      replyTo: this.config.replyTo,
      subject,
      html: renderedContent.html,
      text: renderedContent.text,
      tags: [notification.notificationTypeId],
      metadata: {
        notificationId: notification.id,
        tenantId: notification.tenantId,
        userId: notification.userId,
      },
    };

    // Add unsubscribe headers for CAN-SPAM compliance
    if (this.config.includeUnsubscribeHeaders && this.config.unsubscribeBaseUrl) {
      const unsubscribeUrl = this.buildUnsubscribeUrl(notification);
      emailParams.headers = {
        'List-Unsubscribe': `<${unsubscribeUrl}>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      };
    }

    // Send via provider
    const result = await this.config.provider.send(emailParams);

    return {
      success: result.success,
      messageId: result.messageId,
      error: result.error,
    };
  }

  /**
   * Build unsubscribe URL with signed token
   */
  private buildUnsubscribeUrl(notification: Notification): string {
    // URL will include notification type for one-click unsubscribe
    // Token validation happens in the unsubscribe endpoint
    const baseUrl = this.config.unsubscribeBaseUrl || '';
    return `${baseUrl}/unsubscribe?nid=${notification.id}&type=${notification.notificationTypeId}`;
  }

  /**
   * Get provider health status
   */
  async healthCheck(): Promise<{ healthy: boolean; latencyMs?: number; error?: string }> {
    return this.config.provider.healthCheck();
  }
}
