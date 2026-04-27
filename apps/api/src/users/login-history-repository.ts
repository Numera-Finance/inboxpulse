import { and, eq, gte, lte, desc } from 'drizzle-orm';
import { injectable, inject } from 'tsyringe';
import type { Database } from '@crm/database';
import { loginHistory, users } from './schema';

export interface LoginHistoryRow {
  loggedInAt: Date;
  email: string;
  firstName: string;
  lastName: string;
  ipAddress: string | null;
  userAgent: string | null;
}

@injectable()
export class LoginHistoryRepository {
  constructor(@inject('Database') private db: Database) {}

  async findByTenantInRange(
    tenantId: string,
    startDate: Date,
    endDate: Date
  ): Promise<LoginHistoryRow[]> {
    return this.db
      .select({
        loggedInAt: loginHistory.loggedInAt,
        email: users.email,
        firstName: users.firstName,
        lastName: users.lastName,
        ipAddress: loginHistory.ipAddress,
        userAgent: loginHistory.userAgent,
      })
      .from(loginHistory)
      .innerJoin(users, eq(loginHistory.userId, users.id))
      .where(
        and(
          eq(loginHistory.tenantId, tenantId),
          gte(loginHistory.loggedInAt, startDate),
          lte(loginHistory.loggedInAt, endDate)
        )
      )
      .orderBy(desc(loginHistory.loggedInAt));
  }
}
