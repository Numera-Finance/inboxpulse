/**
 * Batch Repository
 * Handles notification batch operations
 */

import { eq, and, lte } from 'drizzle-orm';
import type { Database } from '@crm/database';
import type { RequestHeader } from '@crm/shared';
import type { PgTableWithColumns } from 'drizzle-orm/pg-core';

export class BatchRepository {
  constructor(
    private db: Database,
    private batches: PgTableWithColumns<any>
  ) {}

  async findById(id: string, header: RequestHeader) {
    const result = await this.db
      .select()
      .from(this.batches)
      .where(
        and(
          eq(this.batches.id, id),
          eq(this.batches.tenantId, header.tenantId)
        )
      )
      .limit(1);

    return result[0] || null;
  }

  async findPendingBatches(beforeDate: Date) {
    return this.db
      .select()
      .from(this.batches)
      .where(
        and(
          eq(this.batches.status, 'pending'),
          lte(this.batches.scheduledFor, beforeDate)
        )
      )
      .orderBy(this.batches.scheduledFor);
  }

  async create(data: any, header: RequestHeader) {
    const result = await this.db
      .insert(this.batches)
      .values({
        ...data,
        tenantId: header.tenantId,
      })
      .returning();

    return result[0];
  }

  async update(id: string, data: Partial<any>, header: RequestHeader) {
    const result = await this.db
      .update(this.batches)
      .set({
        ...data,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(this.batches.id, id),
          eq(this.batches.tenantId, header.tenantId)
        )
      )
      .returning();

    return result[0] || null;
  }
}
