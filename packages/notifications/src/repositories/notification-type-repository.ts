/**
 * Repository for notification types
 */

import { eq, and, type Database, type PgTableWithColumns } from '@crm/database';
import type { RequestHeader } from '@crm/shared';
import { BaseNotificationRepository } from './base-repository';
import type { NotificationType } from '../types/core';

export class NotificationTypeRepository extends BaseNotificationRepository {
  constructor(
    db: Database,
    private notificationTypes: PgTableWithColumns<any>
  ) {
    super(db);
  }

  async findById(id: string, header: RequestHeader): Promise<NotificationType | null> {
    const result = await this.db
      .select()
      .from(this.notificationTypes)
      .where(
        and(
          eq(this.notificationTypes.id, id),
          this.tenantFilter(this.notificationTypes.tenantId, header)
        )
      )
      .limit(1);

    return (result[0] as NotificationType) || null;
  }

  async findByName(name: string, header: RequestHeader): Promise<NotificationType | null> {
    const result = await this.db
      .select()
      .from(this.notificationTypes)
      .where(
        and(
          eq(this.notificationTypes.name, name),
          this.tenantFilter(this.notificationTypes.tenantId, header)
        )
      )
      .limit(1);

    return (result[0] as NotificationType) || null;
  }

  async findAll(header: RequestHeader, activeOnly: boolean = true): Promise<NotificationType[]> {
    const conditions = [this.tenantFilter(this.notificationTypes.tenantId, header)];

    if (activeOnly) {
      conditions.push(eq(this.notificationTypes.isActive, true));
    }

    const result = await this.db
      .select()
      .from(this.notificationTypes)
      .where(and(...conditions));

    return result as NotificationType[];
  }

  async create(data: Partial<NotificationType>, header: RequestHeader): Promise<NotificationType> {
    const result = await this.db
      .insert(this.notificationTypes)
      .values({
        ...data,
        tenantId: header.tenantId,
      })
      .returning();

    return result[0] as NotificationType;
  }

  async update(id: string, data: Partial<NotificationType>, header: RequestHeader): Promise<NotificationType | null> {
    const result = await this.db
      .update(this.notificationTypes)
      .set({
        ...data,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(this.notificationTypes.id, id),
          this.tenantFilter(this.notificationTypes.tenantId, header)
        )
      )
      .returning();

    return (result[0] as NotificationType) || null;
  }
}
