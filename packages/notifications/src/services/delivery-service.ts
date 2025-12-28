/**
 * Delivery Service
 *
 * Orchestrates sending notifications through appropriate channels
 * Handles rendering, channel selection, and delivery tracking
 */

import { injectable, inject } from 'tsyringe';
import type { Database } from '@crm/database';
import type { RequestHeader } from '@crm/shared';
import type { TemplateProvider, UserResolver, RenderedContent } from '../types/interfaces';
import type { Notification, NotificationChannel, NotificationType, DeliveryAttempt } from '../types/core';
import type { BaseChannel } from '../types/channels';
import { NotificationRepository } from '../repositories/notification-repository';
import { NotificationTypeRepository } from '../repositories/notification-type-repository';
import { ChannelRegistry } from '../channels/channel-registry';

export interface DeliveryResult {
  notificationId: string;
  channel: NotificationChannel;
  success: boolean;
  messageId?: string;
  error?: string;
  duration: number;
}

export interface BatchDeliveryResult {
  total: number;
  successful: number;
  failed: number;
  results: DeliveryResult[];
}

@injectable()
export class DeliveryService {
  constructor(
    @inject('Database') private db: Database,
    @inject('NotificationRepository') private notificationRepo: NotificationRepository,
    @inject('NotificationTypeRepository') private typeRepo: NotificationTypeRepository,
    @inject('TemplateProvider') private templateProvider: TemplateProvider,
    @inject('UserResolver') private userResolver: UserResolver,
    @inject('ChannelRegistry') private channelRegistry: ChannelRegistry
  ) {}

  /**
   * Deliver a single notification
   */
  async deliverNotification(
    notification: Notification,
    header: RequestHeader
  ): Promise<DeliveryResult> {
    const startTime = Date.now();
    const channel = notification.channel;

    if (!channel) {
      return {
        notificationId: notification.id,
        channel: 'email', // default
        success: false,
        error: 'No channel specified for notification',
        duration: Date.now() - startTime,
      };
    }

    // Check if notification is expired
    if (notification.expiresAt && new Date(notification.expiresAt) < new Date()) {
      await this.notificationRepo.update(
        notification.id,
        { status: 'expired' },
        header
      );
      return {
        notificationId: notification.id,
        channel,
        success: false,
        error: 'Notification expired',
        duration: Date.now() - startTime,
      };
    }

    // Get channel adapter
    const channelAdapter = this.channelRegistry.get(channel);
    if (!channelAdapter) {
      return {
        notificationId: notification.id,
        channel,
        success: false,
        error: `Channel ${channel} not registered`,
        duration: Date.now() - startTime,
      };
    }

    // Get notification type for template config
    const notificationType = await this.typeRepo.findById(
      notification.notificationTypeId,
      header
    ) as NotificationType | null;

    // Render template
    const renderedContent = await this.renderNotification(
      notification,
      notificationType,
      channel
    );

    if (!renderedContent) {
      return {
        notificationId: notification.id,
        channel,
        success: false,
        error: 'Failed to render notification content',
        duration: Date.now() - startTime,
      };
    }

    // Send via channel
    const result = await channelAdapter.send(
      notification,
      renderedContent,
      this.userResolver
    );

    // Record delivery attempt
    const attempt: DeliveryAttempt = {
      channel,
      attemptedAt: new Date(),
      status: result.success ? 'sent' : 'failed',
      error: result.error,
    };

    const existingAttempts = notification.deliveryAttempts || [];
    const updatedAttempts = [...existingAttempts, attempt];

    // Update notification status
    if (result.success) {
      await this.notificationRepo.update(
        notification.id,
        {
          status: 'sent',
          sentAt: new Date(),
          deliveryAttempts: updatedAttempts,
        },
        header
      );
    } else {
      // Keep as pending for retry, or mark as failed if max retries exceeded
      const maxRetries = 3;
      const failedAttempts = updatedAttempts.filter(a => a.status === 'failed').length;

      await this.notificationRepo.update(
        notification.id,
        {
          status: failedAttempts >= maxRetries ? 'failed' : 'pending',
          deliveryAttempts: updatedAttempts,
        },
        header
      );
    }

    return {
      notificationId: notification.id,
      channel,
      success: result.success,
      messageId: result.messageId,
      error: result.error,
      duration: Date.now() - startTime,
    };
  }

  /**
   * Deliver multiple notifications (for batch processing)
   */
  async deliverBatch(
    notifications: Notification[],
    header: RequestHeader
  ): Promise<BatchDeliveryResult> {
    const results: DeliveryResult[] = [];

    // Process in parallel with concurrency limit
    const concurrencyLimit = 10;
    for (let i = 0; i < notifications.length; i += concurrencyLimit) {
      const batch = notifications.slice(i, i + concurrencyLimit);
      const batchResults = await Promise.all(
        batch.map(n => this.deliverNotification(n, header))
      );
      results.push(...batchResults);
    }

    const successful = results.filter(r => r.success).length;

    return {
      total: notifications.length,
      successful,
      failed: notifications.length - successful,
      results,
    };
  }

  /**
   * Render notification content using template provider
   */
  private async renderNotification(
    notification: Notification,
    notificationType: NotificationType | null,
    channel: NotificationChannel
  ): Promise<RenderedContent | null> {
    try {
      // Get template
      const template = await this.templateProvider.getTemplate(
        notification.notificationTypeId,
        channel,
        notification.locale || undefined
      );

      if (!template) {
        // Use fallback template or generate simple content
        const fallback = await this.templateProvider.getFallbackTemplate(channel);
        if (!fallback) {
          // Generate basic content from notification fields
          return {
            subject: notification.title,
            title: notification.title,
            text: notification.body,
            html: `<html><body><h1>${notification.title}</h1><p>${notification.body}</p></body></html>`,
          };
        }
      }

      // Create data access checker for security validation
      const dataAccessChecker = this.userResolver.createDataAccessChecker(
        notification.userId,
        notification.tenantId
      );

      // Render template with notification data
      const renderResult = await this.templateProvider.renderTemplate(
        template!,
        {
          ...notification.metadata,
          title: notification.title,
          body: notification.body,
          notificationId: notification.id,
        },
        {
          locale: notification.locale || undefined,
          userId: notification.userId,
          tenantId: notification.tenantId,
          dataAccessChecker,
        }
      );

      if (!renderResult.hasContent) {
        // Return basic content on render failure
        return {
          subject: notification.title,
          title: notification.title,
          text: notification.body,
        };
      }

      return renderResult.content || null;
    } catch (error) {
      // Return basic content on error
      return {
        subject: notification.title,
        title: notification.title,
        text: notification.body,
      };
    }
  }

  /**
   * Get pending notifications ready for delivery
   */
  async getPendingNotifications(limit: number = 100): Promise<Notification[]> {
    const now = new Date();
    const results = await this.notificationRepo.findPendingForSending(now);
    return results as Notification[];
  }
}
