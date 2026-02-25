import { injectable, inject } from 'tsyringe';
import type { Database } from '@crm/database';
import { runs, type NewRun, type UpdateRun } from './schema';
import { eq, and, desc } from 'drizzle-orm';

@injectable()
export class RunRepository {
  constructor(@inject('Database') private db: Database) {}

  async create(data: NewRun) {
    const result = await this.db.insert(runs).values(data).returning();
    return result[0];
  }

  async update(id: string, data: UpdateRun) {
    const result = await this.db.update(runs).set(data).where(eq(runs.id, id)).returning();
    return result[0];
  }

  async findById(id: string) {
    const result = await this.db.select().from(runs).where(eq(runs.id, id)).limit(1);
    return result[0] || null;
  }

  async findByTenant(tenantId: string, options?: { limit?: number }) {
    const limit = options?.limit || 10;

    return this.db
      .select()
      .from(runs)
      .where(eq(runs.tenantId, tenantId))
      .orderBy(desc(runs.startedAt))
      .limit(limit);
  }

  async findByIntegration(integrationId: string, options?: { limit?: number }, tenantId?: string) {
    const limit = options?.limit || 10;

    const conditions = [eq(runs.integrationId, integrationId)];
    if (tenantId) {
      conditions.push(eq(runs.tenantId, tenantId));
    }

    return this.db
      .select()
      .from(runs)
      .where(and(...conditions))
      .orderBy(desc(runs.startedAt))
      .limit(limit);
  }

  async findRunningByIntegration(integrationId: string, tenantId?: string) {
    const conditions = [eq(runs.integrationId, integrationId), eq(runs.status, 'running')];
    if (tenantId) {
      conditions.push(eq(runs.tenantId, tenantId));
    }

    return this.db
      .select()
      .from(runs)
      .where(and(...conditions))
      .orderBy(desc(runs.startedAt));
  }

  async findRunningByTenant(tenantId: string) {
    return this.db
      .select()
      .from(runs)
      .where(and(eq(runs.tenantId, tenantId), eq(runs.status, 'running')))
      .orderBy(desc(runs.startedAt));
  }
}
