/**
 * Core notification service
 * Handles notification creation, fan-out, and delivery orchestration
 */

import { injectable, inject } from 'tsyringe';
import type { Database } from '@crm/database';
import type { RequestHeader } from '@crm/shared';
import { NotificationRepository } from '../repositories/notification-repository';
import { NotificationTypeRepository } from '../repositories/notification-type-repository';
import type { TemplateProvider, UserResolver } from '../types/interfaces';
import type { NotificationChannel, BatchInterval } from '../types';
import type { SendNotificationRequest } from '../schemas/requests';
import { calculateScheduledTime } from '../utils/batch-interval';
import { calculateEventKey, shouldDeduplicate } from '../utils/deduplication';

@injectable()
export class NotificationService {
  constructor(
    @inject('Database') private db: Database,
    @inject('NotificationRepository') private notificationRepo: NotificationRepository,
    @inject('NotificationTypeRepository') private typeRepo: NotificationTypeRepository,
    @inject('TemplateProvider') private templateProvider: TemplateProvider,
    @inject('UserResolver') private userResolver: UserResolver
  ) {}

  /**
   * Send notification - fan-out to all subscribers
   */
  async sendNotification(
    request: SendNotificationRequest,
    header: RequestHeader
  ): Promise<{ notificationIds: string[] }> {
    // Get notification type
    const notificationType = await this.typeRepo.findByName(request.notificationType, header);
    if (!notificationType || !notificationType.isActive) {
      throw new Error(`Notification type ${request.notificationType} not found or inactive`);
    }

    // Get subscribers
    const subscribers = request.userIds || await this.userResolver.getSubscribers(
      header.tenantId,
      notificationType.id
    );

    const notificationIds: string[] = [];

    // Fan-out: create notification for each subscriber
    for (const userId of subscribers) {
      // Check if user exists and is active
      const user = await this.userResolver.getUser(userId, header.tenantId);
      if (!user || !user.isActive) {
        continue;
      }

      // Get user preferences
      const preferences = await this.userResolver.getUserPreferences(userId, notificationType.id);
      
      // Skip if disabled
      if (preferences && !preferences.enabled) {
        continue;
      }

      // Determine channels
      const channels = preferences?.channels || notificationType.defaultChannels;
      
      // Create notification for each channel
      for (const channel of channels) {
        const notificationId = await this.createNotificationForChannel(
          userId,
          notificationType,
          channel,
          request,
          preferences,
          header
        );
        
        if (notificationId) {
          notificationIds.push(notificationId);
        }
      }
    }

    return { notificationIds };
  }

  private async createNotificationForChannel(
    userId: string,
    notificationType: any,
    channel: NotificationChannel,
    request: SendNotificationRequest,
    preferences: any,
    header: RequestHeader
  ): Promise<string | null> {
    // Check deduplication
    let eventKey: string | null = null;
    if (request.eventKey && notificationType.deduplicationConfig) {
      eventKey = calculateEventKey(
        request.data,
        notificationType.deduplicationConfig.eventKeyFields
      );
      
      const existing = await this.notificationRepo.findByEventKey(
        userId,
        notificationType.id,
        eventKey,
        header
      );
      
      if (existing) {
        const strategy = shouldDeduplicate(
          notificationType.deduplicationConfig,
          existing.eventKey || null,
          eventKey,
          existing.createdAt,
          notificationType.deduplicationConfig.updateWindowMinutes
        );
        
        if (strategy === 'ignore') {
          return null; // Skip creating notification
        }
        
        if (strategy === 'overwrite') {
          // Update existing notification
          await this.notificationRepo.update(existing.id, {
            eventVersion: (existing.eventVersion || 0) + 1,
            metadata: request.data,
          }, header);
          return existing.id;
        }
      }
    }

    // Determine scheduling
    const frequency = preferences?.frequency || notificationType.defaultFrequency;
    const batchInterval = preferences?.batchInterval || notificationType.defaultBatchInterval;
    
    let scheduledFor: Date | null = null;
    if (frequency === 'batched' && batchInterval) {
      const userTimezone = await this.userResolver.getUserTimezone(userId) || 'UTC';
      scheduledFor = calculateScheduledTime(batchInterval, userTimezone);
    }

    // Calculate expiry
    let expiresAt: Date | null = null;
    if (notificationType.defaultExpiresAfterHours) {
      expiresAt = new Date(Date.now() + notificationType.defaultExpiresAfterHours * 60 * 60 * 1000);
    }
    if (request.expiresAt) {
      expiresAt = request.expiresAt;
    }

    // Create notification record (content will be generated at send time)
    const notification = await this.notificationRepo.create({
      userId,
      notificationTypeId: notificationType.id,
      title: '', // Will be set during rendering
      body: '', // Will be set during rendering
      metadata: request.data,
      status: scheduledFor ? 'batched' : 'pending',
      priority: request.priority || notificationType.defaultPriority,
      scheduledFor,
      expiresAt,
      eventKey,
      idempotencyKey: request.idempotencyKey,
      channel,
      locale: request.locale || await this.userResolver.getUserLocale(userId),
    }, header);

    return notification.id;
  }
}
