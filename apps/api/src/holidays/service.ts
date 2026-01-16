import { injectable, inject } from 'tsyringe';
import { HolidayRepository } from './repository';
import type { HolidayCalendar, NewHolidayCalendar } from './schema';
import { logger } from '../utils/logger';

export interface CreateHolidayRequest {
  date: string; // 'YYYY-MM-DD'
  timezone: string;
  name: string;
}

export interface UpdateHolidayRequest {
  date?: string;
  timezone?: string;
  name?: string;
}

export interface BulkCreateHolidayRequest {
  timezone: string;
  holidays: Array<{
    date: string;
    name: string;
  }>;
}

@injectable()
export class HolidayService {
  constructor(
    @inject(HolidayRepository) private holidayRepository: HolidayRepository
  ) {}

  /**
   * Get all holidays for a tenant
   */
  async getHolidaysByTenant(tenantId: string): Promise<HolidayCalendar[]> {
    return this.holidayRepository.findByTenantId(tenantId);
  }

  /**
   * Get holidays for a tenant filtered by timezone
   */
  async getHolidaysByTimezone(
    tenantId: string,
    timezone: string
  ): Promise<HolidayCalendar[]> {
    return this.holidayRepository.findByTenantAndTimezone(tenantId, timezone);
  }

  /**
   * Get holiday by ID
   */
  async getHolidayById(id: string): Promise<HolidayCalendar | undefined> {
    return this.holidayRepository.findById(id);
  }

  /**
   * Get distinct timezones configured for a tenant
   */
  async getTimezones(tenantId: string): Promise<string[]> {
    return this.holidayRepository.getTimezones(tenantId);
  }

  /**
   * Create a new holiday
   */
  async createHoliday(
    tenantId: string,
    request: CreateHolidayRequest
  ): Promise<HolidayCalendar> {
    // Check if holiday already exists on this date/timezone
    const existing = await this.holidayRepository.findByTenantAndDate(
      tenantId,
      request.date,
      request.timezone
    );
    if (existing) {
      throw new Error(
        `Holiday already exists on ${request.date} for timezone ${request.timezone}`
      );
    }

    const holiday = await this.holidayRepository.create({
      tenantId,
      date: request.date,
      timezone: request.timezone,
      name: request.name,
    });

    logger.info(
      {
        tenantId,
        holidayId: holiday.id,
        date: holiday.date,
        timezone: holiday.timezone,
      },
      'Created holiday'
    );

    return holiday;
  }

  /**
   * Bulk create holidays for a timezone
   */
  async bulkCreateHolidays(
    tenantId: string,
    request: BulkCreateHolidayRequest
  ): Promise<HolidayCalendar[]> {
    const holidaysToCreate: NewHolidayCalendar[] = request.holidays.map((h) => ({
      tenantId,
      date: h.date,
      timezone: request.timezone,
      name: h.name,
    }));

    const created = await this.holidayRepository.bulkCreate(holidaysToCreate);

    logger.info(
      {
        tenantId,
        timezone: request.timezone,
        requestedCount: request.holidays.length,
        createdCount: created.length,
      },
      'Bulk created holidays'
    );

    return created;
  }

  /**
   * Update a holiday
   */
  async updateHoliday(
    tenantId: string,
    holidayId: string,
    request: UpdateHolidayRequest
  ): Promise<HolidayCalendar | undefined> {
    const holiday = await this.holidayRepository.findById(holidayId);
    if (!holiday || holiday.tenantId !== tenantId) {
      return undefined;
    }

    // If changing date or timezone, check for conflicts
    if (request.date || request.timezone) {
      const checkDate = request.date || holiday.date;
      const checkTimezone = request.timezone || holiday.timezone;

      const existing = await this.holidayRepository.findByTenantAndDate(
        tenantId,
        checkDate,
        checkTimezone
      );
      if (existing && existing.id !== holidayId) {
        throw new Error(
          `Holiday already exists on ${checkDate} for timezone ${checkTimezone}`
        );
      }
    }

    const updated = await this.holidayRepository.update(holidayId, request);

    if (updated) {
      logger.info(
        { tenantId, holidayId, updates: Object.keys(request) },
        'Updated holiday'
      );
    }

    return updated;
  }

  /**
   * Delete a holiday
   */
  async deleteHoliday(tenantId: string, holidayId: string): Promise<boolean> {
    const holiday = await this.holidayRepository.findById(holidayId);
    if (!holiday || holiday.tenantId !== tenantId) {
      return false;
    }

    const deleted = await this.holidayRepository.delete(holidayId);

    if (deleted) {
      logger.info(
        { tenantId, holidayId, date: holiday.date, name: holiday.name },
        'Deleted holiday'
      );
    }

    return deleted;
  }

  /**
   * Delete all holidays for a timezone
   */
  async deleteHolidaysByTimezone(
    tenantId: string,
    timezone: string
  ): Promise<number> {
    return this.holidayRepository.deleteByTenantAndTimezone(tenantId, timezone);
  }

  /**
   * Get holiday dates for TAT calculation
   */
  async getHolidayDatesForTAT(
    tenantId: string,
    timezone: string,
    startDate: string,
    endDate: string
  ): Promise<string[]> {
    return this.holidayRepository.getHolidayDates(
      tenantId,
      timezone,
      startDate,
      endDate
    );
  }
}
