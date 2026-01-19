import { AuthBaseClient } from '../base-client';
import type { ApiResponse } from '@crm/shared';
import type {
  Holiday,
  CreateHolidayRequest,
  UpdateHolidayRequest,
  BulkCreateHolidaysRequest,
  BulkCreateHolidaysResponse,
} from './types';

/**
 * Client for holiday-related API operations
 */
export class HolidayClient extends AuthBaseClient {
  /**
   * Get all holidays for the tenant
   * @param timezone - Optional timezone filter
   */
  async getHolidays(timezone?: string, signal?: AbortSignal): Promise<Holiday[]> {
    const url = timezone
      ? `/api/holidays?timezone=${encodeURIComponent(timezone)}`
      : '/api/holidays';
    const response = await this.get<ApiResponse<Holiday[]>>(url, signal);
    return response?.data || [];
  }

  /**
   * Get distinct timezones configured for the tenant
   */
  async getTimezones(signal?: AbortSignal): Promise<string[]> {
    const response = await this.get<ApiResponse<{ timezones: string[] }>>(
      '/api/holidays/timezones',
      signal
    );
    return response?.data?.timezones || [];
  }

  /**
   * Get holiday by ID
   */
  async getById(id: string, signal?: AbortSignal): Promise<Holiday | null> {
    const response = await this.get<ApiResponse<Holiday>>(`/api/holidays/${id}`, signal);
    return response?.data || null;
  }

  /**
   * Create a new holiday
   */
  async create(data: CreateHolidayRequest, signal?: AbortSignal): Promise<Holiday> {
    const response = await this.post<ApiResponse<Holiday>>('/api/holidays', data, signal);
    if (!response?.data) {
      throw new Error('Invalid API response: missing data');
    }
    return response.data;
  }

  /**
   * Bulk create holidays for a timezone
   */
  async bulkCreate(
    data: BulkCreateHolidaysRequest,
    signal?: AbortSignal
  ): Promise<BulkCreateHolidaysResponse> {
    const response = await this.post<ApiResponse<BulkCreateHolidaysResponse>>(
      '/api/holidays/bulk',
      data,
      signal
    );
    if (!response?.data) {
      throw new Error('Invalid API response: missing data');
    }
    return response.data;
  }

  /**
   * Update a holiday
   */
  async update(
    id: string,
    data: UpdateHolidayRequest,
    signal?: AbortSignal
  ): Promise<Holiday> {
    const response = await this.patch<ApiResponse<Holiday>>(
      `/api/holidays/${id}`,
      data,
      signal
    );
    if (!response?.data) {
      throw new Error('Invalid API response: missing data');
    }
    return response.data;
  }

  /**
   * Delete a holiday
   */
  async deleteHoliday(id: string, signal?: AbortSignal): Promise<void> {
    await super.delete<ApiResponse<{ success: boolean }>>(`/api/holidays/${id}`, signal);
  }

  /**
   * Delete all holidays for a timezone
   */
  async deleteByTimezone(timezone: string, signal?: AbortSignal): Promise<number> {
    const response = await super.delete<ApiResponse<{ success: boolean; deleted: number }>>(
      `/api/holidays/timezone/${encodeURIComponent(timezone)}`,
      signal
    );
    return response?.data?.deleted || 0;
  }
}
