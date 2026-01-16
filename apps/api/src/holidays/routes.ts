import { Hono } from 'hono';
import { z } from 'zod';
import { container } from 'tsyringe';
import { NotFoundError, Permission } from '@crm/shared';
import { requirePermission } from '../middleware/require-permission';
import {
  handleApiRequestWithStatus,
  handleGetRequest,
  handleGetRequestWithParams,
  handleApiRequestWithParams,
} from '../utils/api-handler';
import { HolidayService } from './service';
import type { RequestHeader } from '@crm/shared';

export const holidayRoutes = new Hono();

// All holiday management requires ADMIN permission
holidayRoutes.use('*', requirePermission(Permission.ADMIN));

// =============================================================================
// Request Schemas
// =============================================================================

const createHolidaySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format'),
  timezone: z.string().min(1).max(100),
  name: z.string().min(1).max(255),
});

const updateHolidaySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format').optional(),
  timezone: z.string().min(1).max(100).optional(),
  name: z.string().min(1).max(255).optional(),
});

const bulkCreateHolidaysSchema = z.object({
  timezone: z.string().min(1).max(100),
  holidays: z.array(
    z.object({
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format'),
      name: z.string().min(1).max(255),
    })
  ).min(1),
});

// =============================================================================
// Routes
// =============================================================================

/**
 * GET /api/holidays - List all holidays for tenant
 * Query params:
 *   - timezone: string (optional) - filter by timezone
 */
holidayRoutes.get('/', async (c) => {
  return handleGetRequest(c, async (requestHeader: RequestHeader) => {
    const timezone = c.req.query('timezone');
    const service = container.resolve(HolidayService);

    if (timezone) {
      return await service.getHolidaysByTimezone(requestHeader.tenantId, timezone);
    }

    return await service.getHolidaysByTenant(requestHeader.tenantId);
  });
});

/**
 * GET /api/holidays/timezones - List distinct timezones configured for tenant
 */
holidayRoutes.get('/timezones', async (c) => {
  return handleGetRequest(c, async (requestHeader: RequestHeader) => {
    const service = container.resolve(HolidayService);
    const timezones = await service.getTimezones(requestHeader.tenantId);
    return { timezones };
  });
});

/**
 * GET /api/holidays/:id - Get holiday by ID
 */
holidayRoutes.get('/:id', async (c) => {
  return handleGetRequestWithParams(
    c,
    z.object({ id: z.string().uuid() }),
    async (requestHeader: RequestHeader, params) => {
      const service = container.resolve(HolidayService);
      const holiday = await service.getHolidayById(params.id);

      if (!holiday || holiday.tenantId !== requestHeader.tenantId) {
        throw new NotFoundError('Holiday', params.id);
      }

      return holiday;
    }
  );
});

/**
 * POST /api/holidays - Create new holiday
 */
holidayRoutes.post('/', async (c) => {
  return handleApiRequestWithStatus(
    c,
    createHolidaySchema,
    201,
    async (requestHeader: RequestHeader, request) => {
      const service = container.resolve(HolidayService);
      return await service.createHoliday(requestHeader.tenantId, {
        date: request.date,
        timezone: request.timezone,
        name: request.name,
      });
    }
  );
});

/**
 * POST /api/holidays/bulk - Bulk create holidays for a timezone
 */
holidayRoutes.post('/bulk', async (c) => {
  return handleApiRequestWithStatus(
    c,
    bulkCreateHolidaysSchema,
    201,
    async (requestHeader: RequestHeader, request) => {
      const service = container.resolve(HolidayService);
      return await service.bulkCreateHolidays(requestHeader.tenantId, {
        timezone: request.timezone,
        holidays: request.holidays,
      });
    }
  );
});

/**
 * PATCH /api/holidays/:id - Update holiday
 */
holidayRoutes.patch('/:id', async (c) => {
  return handleApiRequestWithParams(
    c,
    z.object({ id: z.string().uuid() }),
    updateHolidaySchema,
    async (requestHeader: RequestHeader, params, request) => {
      const service = container.resolve(HolidayService);
      const holiday = await service.updateHoliday(
        requestHeader.tenantId,
        params.id,
        {
          date: request.date,
          timezone: request.timezone,
          name: request.name,
        }
      );

      if (!holiday) {
        throw new NotFoundError('Holiday', params.id);
      }

      return holiday;
    }
  );
});

/**
 * DELETE /api/holidays/:id - Delete holiday
 */
holidayRoutes.delete('/:id', async (c) => {
  return handleGetRequestWithParams(
    c,
    z.object({ id: z.string().uuid() }),
    async (requestHeader: RequestHeader, params) => {
      const service = container.resolve(HolidayService);
      const deleted = await service.deleteHoliday(
        requestHeader.tenantId,
        params.id
      );

      if (!deleted) {
        throw new NotFoundError('Holiday', params.id);
      }

      return { success: true };
    }
  );
});

/**
 * DELETE /api/holidays/timezone/:timezone - Delete all holidays for a timezone
 */
holidayRoutes.delete('/timezone/:timezone', async (c) => {
  return handleGetRequestWithParams(
    c,
    z.object({ timezone: z.string().min(1) }),
    async (requestHeader: RequestHeader, params) => {
      const service = container.resolve(HolidayService);
      const count = await service.deleteHolidaysByTimezone(
        requestHeader.tenantId,
        params.timezone
      );

      return { success: true, deleted: count };
    }
  );
});
