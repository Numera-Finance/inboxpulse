import { injectable, inject } from 'tsyringe';
import type { Database } from '@crm/database';
import type { RequestHeader } from '@crm/shared';
import { dashboards, type NewDashboard, type DashboardLayoutConfig } from './schema';
import { eq, and } from 'drizzle-orm';

@injectable()
export class DashboardRepository {
  constructor(@inject('Database') private db: Database) {}

  /**
   * Get dashboard config for a user
   */
  async findByUser(
    tenantId: string,
    userId: string
  ): Promise<DashboardLayoutConfig | null> {
    const result = await this.db
      .select({ config: dashboards.config })
      .from(dashboards)
      .where(
        and(
          eq(dashboards.tenantId, tenantId),
          eq(dashboards.userId, userId)
        )
      )
      .limit(1);

    return (result[0]?.config as DashboardLayoutConfig) || null;
  }

  /**
   * Upsert dashboard config for a user
   */
  async upsert(
    tenantId: string,
    userId: string,
    config: DashboardLayoutConfig
  ): Promise<void> {
    await this.db
      .insert(dashboards)
      .values({
        tenantId,
        userId,
        config,
      })
      .onConflictDoUpdate({
        target: [dashboards.tenantId, dashboards.userId],
        set: {
          config,
          updatedAt: new Date(),
        },
      });
  }

  /**
   * Delete dashboard config for a user (reset to default)
   */
  async delete(tenantId: string, userId: string): Promise<void> {
    await this.db
      .delete(dashboards)
      .where(
        and(
          eq(dashboards.tenantId, tenantId),
          eq(dashboards.userId, userId)
        )
      );
  }
}
