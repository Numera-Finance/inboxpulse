import { Hono } from 'hono';
import { container } from 'tsyringe';
import { Permission } from '@crm/shared';
import { requirePermission } from '../middleware/require-permission';
import { getRequestHeader } from '../utils/request-header';
import { LoginHistoryService } from './login-history-service';

export const loginHistoryRoutes = new Hono();

/**
 * GET /api/login-history/export
 * Returns a CSV of login events for the current tenant from the last 30 days.
 * Admin-only.
 */
loginHistoryRoutes.get('/export', requirePermission(Permission.ADMIN), async (c) => {
  const requestHeader = getRequestHeader(c);
  const service = container.resolve(LoginHistoryService);

  const csv = await service.exportLast30DaysCsv(requestHeader.tenantId);

  c.header('Content-Type', 'text/csv; charset=utf-8');
  c.header('Content-Disposition', 'attachment; filename="login-history.csv"');
  return c.body(csv);
});
