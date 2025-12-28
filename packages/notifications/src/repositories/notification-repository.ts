/**
 * Repository for notifications
 */

import { eq, and, inArray, lte, isNull, desc, type Database, type PgTableWithColumns } from '@crm/database';
import type { RequestHeader } from '@crm/shared';
import { BaseNotificationRepository } from './base-repository';

export class NotificationRepository extends BaseNotificationRepository {
  constructor(
    db: Database,
    private notifications: PgTableWithColumns<any>
  ) {
    super(db);
  }

  async findById(id: string, header: RequestHeader) {
    const result = await this.db
      .select()
      .from(this.notifications)
      .where(
        and(
          eq(this.notifications.id, id),
          this.tenantFilter(this.notifications.tenantId, header)
        )
      )
      .limit(1);
    
    return result[0] || null;
  }

  async findByUser(userId: string, header: RequestHeader, options?: {
    status?: string[];
    limit?: number;
    offset?: number;
  }) {
    const conditions = [
      this.tenantFilter(this.notifications.tenantId, header),
      eq(this.notifications.userId, userId),
    ];
    
    if (options?.status) {
      conditions.push(inArray(this.notifications.status, options.status));
    }
    
    const baseQuery = this.db
      .select()
      .from(this.notifications)
      .where(and(...conditions))
      .orderBy(desc(this.notifications.createdAt));
    
    if (options?.limit && options?.offset) {
      return baseQuery.limit(options.limit).offset(options.offset);
    } else if (options?.limit) {
      return baseQuery.limit(options.limit);
    } else if (options?.offset) {
      return baseQuery.offset(options.offset);
    }
    
    return baseQuery;
  }

  async findPendingForSending(beforeDate: Date) {
    return this.db
      .select()
      .from(this.notifications)
      .where(
        and(
          inArray(this.notifications.status, ['pending', 'batched']),
          lte(this.notifications.scheduledFor, beforeDate),
          isNull(this.notifications.expiresAt)
        )
      )
      .orderBy(this.notifications.scheduledFor);
  }

  async findByEventKey(
    userId: string,
    notificationTypeId: string,
    eventKey: string,
    header: RequestHeader
  ) {
    const result = await this.db
      .select()
      .from(this.notifications)
      .where(
        and(
          eq(this.notifications.userId, userId),
          eq(this.notifications.notificationTypeId, notificationTypeId),
          eq(this.notifications.eventKey, eventKey),
          this.tenantFilter(this.notifications.tenantId, header)
        )
      )
      .limit(1);
    
    return result[0] || null;
  }

  async create(data: any, header: RequestHeader) {
    const result = await this.db
      .insert(this.notifications)
      .values({
        ...data,
        tenantId: header.tenantId,
      })
      .returning();
    
    return result[0];
  }

  async update(id: string, data: Partial<any>, header: RequestHeader) {
    const result = await this.db
      .update(this.notifications)
      .set({
        ...data,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(this.notifications.id, id),
          this.tenantFilter(this.notifications.tenantId, header)
        )
      )
      .returning();
    
    return result[0] || null;
  }

  async markAsRead(id: string, header: RequestHeader) {
    return this.update(id, { readAt: new Date(), status: 'read' }, header);
  }

  async markAsSent(id: string, sentAt: Date) {
    const result = await this.db
      .update(this.notifications)
      .set({
        status: 'sent',
        sentAt,
        updatedAt: new Date(),
      })
      .where(eq(this.notifications.id, id))
      .returning();
    
    return result[0] || null;
  }
}
