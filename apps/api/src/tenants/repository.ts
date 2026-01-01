import { injectable, inject } from 'tsyringe';
import { type RequestHeader } from '@crm/shared';
import type { Database } from '@crm/database';
import { tenants } from './schema';
import { eq } from 'drizzle-orm';

@injectable()
export class TenantRepository {
  constructor(@inject('Database') private db: Database) {}

  async findById(id: string) {
    const result = await this.db.select().from(tenants).where(eq(tenants.id, id)).limit(1);
    return result[0] || null;
  }

  async findAll() {
    return this.db.select().from(tenants);
  }

  async create(requestHeader: RequestHeader, data: { name: string}) {
    const now = new Date();
    const result = await this.db
      .insert(tenants)
      .values({
        ...data,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    return result[0];
  }
}
