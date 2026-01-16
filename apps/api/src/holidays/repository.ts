import { eq, and, between, asc } from 'drizzle-orm';
import { injectable, inject } from 'tsyringe';
import type { Database } from '@crm/database';
import { holidayCalendars, type HolidayCalendar, type NewHolidayCalendar } from './schema';
import { logger } from '../utils/logger';

@injectable()
export class HolidayRepository {
  constructor(@inject('Database') private db: Database) {}

  // ===========================================================================
  // Holiday CRUD
  // ===========================================================================

  async findById(id: string): Promise<HolidayCalendar | undefined> {
    const result = await this.db
      .select()
      .from(holidayCalendars)
      .where(eq(holidayCalendars.id, id));
    return result[0];
  }

  async findByTenantId(tenantId: string): Promise<HolidayCalendar[]> {
    return this.db
      .select()
      .from(holidayCalendars)
      .where(eq(holidayCalendars.tenantId, tenantId))
      .orderBy(asc(holidayCalendars.date));
  }

  async findByTenantAndTimezone(
    tenantId: string,
    timezone: string
  ): Promise<HolidayCalendar[]> {
    return this.db
      .select()
      .from(holidayCalendars)
      .where(
        and(
          eq(holidayCalendars.tenantId, tenantId),
          eq(holidayCalendars.timezone, timezone)
        )
      )
      .orderBy(asc(holidayCalendars.date));
  }

  async findByTenantTimezoneAndDateRange(
    tenantId: string,
    timezone: string,
    startDate: string,
    endDate: string
  ): Promise<HolidayCalendar[]> {
    return this.db
      .select()
      .from(holidayCalendars)
      .where(
        and(
          eq(holidayCalendars.tenantId, tenantId),
          eq(holidayCalendars.timezone, timezone),
          between(holidayCalendars.date, startDate, endDate)
        )
      )
      .orderBy(asc(holidayCalendars.date));
  }

  async findByTenantAndDate(
    tenantId: string,
    date: string,
    timezone: string
  ): Promise<HolidayCalendar | undefined> {
    const result = await this.db
      .select()
      .from(holidayCalendars)
      .where(
        and(
          eq(holidayCalendars.tenantId, tenantId),
          eq(holidayCalendars.date, date),
          eq(holidayCalendars.timezone, timezone)
        )
      );
    return result[0];
  }

  async create(data: NewHolidayCalendar): Promise<HolidayCalendar> {
    const result = await this.db
      .insert(holidayCalendars)
      .values(data)
      .returning();
    const holiday = result[0];

    logger.info(
      {
        holidayId: holiday.id,
        tenantId: data.tenantId,
        date: data.date,
        timezone: data.timezone,
        name: data.name,
      },
      'Created holiday'
    );

    return holiday;
  }

  async bulkCreate(data: NewHolidayCalendar[]): Promise<HolidayCalendar[]> {
    if (data.length === 0) return [];

    const result = await this.db
      .insert(holidayCalendars)
      .values(data)
      .onConflictDoNothing()
      .returning();

    logger.info(
      {
        tenantId: data[0].tenantId,
        count: result.length,
      },
      'Bulk created holidays'
    );

    return result;
  }

  async update(
    id: string,
    data: Partial<Omit<NewHolidayCalendar, 'id' | 'tenantId' | 'createdAt'>>
  ): Promise<HolidayCalendar | undefined> {
    const result = await this.db
      .update(holidayCalendars)
      .set({
        ...data,
        updatedAt: new Date(),
      })
      .where(eq(holidayCalendars.id, id))
      .returning();

    const holiday = result[0];
    if (holiday) {
      logger.info(
        { holidayId: id, updates: Object.keys(data) },
        'Updated holiday'
      );
    }

    return holiday;
  }

  async delete(id: string): Promise<boolean> {
    const result = await this.db
      .delete(holidayCalendars)
      .where(eq(holidayCalendars.id, id))
      .returning({ id: holidayCalendars.id });

    if (result.length > 0) {
      logger.info({ holidayId: id }, 'Deleted holiday');
      return true;
    }

    return false;
  }

  async deleteByTenantAndTimezone(
    tenantId: string,
    timezone: string
  ): Promise<number> {
    const result = await this.db
      .delete(holidayCalendars)
      .where(
        and(
          eq(holidayCalendars.tenantId, tenantId),
          eq(holidayCalendars.timezone, timezone)
        )
      )
      .returning({ id: holidayCalendars.id });

    if (result.length > 0) {
      logger.info(
        { tenantId, timezone, count: result.length },
        'Deleted holidays by timezone'
      );
    }

    return result.length;
  }

  // ===========================================================================
  // Utility Methods
  // ===========================================================================

  /**
   * Get distinct timezones configured for a tenant
   */
  async getTimezones(tenantId: string): Promise<string[]> {
    const result = await this.db
      .selectDistinct({ timezone: holidayCalendars.timezone })
      .from(holidayCalendars)
      .where(eq(holidayCalendars.tenantId, tenantId))
      .orderBy(asc(holidayCalendars.timezone));

    return result.map((r) => r.timezone);
  }

  /**
   * Get holiday dates as strings for TAT calculation
   */
  async getHolidayDates(
    tenantId: string,
    timezone: string,
    startDate: string,
    endDate: string
  ): Promise<string[]> {
    const holidays = await this.findByTenantTimezoneAndDateRange(
      tenantId,
      timezone,
      startDate,
      endDate
    );
    return holidays.map((h) => h.date);
  }
}
