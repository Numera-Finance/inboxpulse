import { Hono } from 'hono';
import { z } from 'zod';
import { container } from 'tsyringe';
import {
  handleGetRequest,
  handleApiRequest,
} from '../utils/api-handler';
import { DashboardService } from './service';
import type { RequestHeader } from '@crm/shared';

export const dashboardRoutes = new Hono();

// =============================================================================
// Request Schemas
// =============================================================================

const layoutItemSchema = z.object({
  i: z.string(),
  x: z.number(),
  y: z.number(),
  w: z.number(),
  h: z.number(),
  minW: z.number().optional(),
  minH: z.number().optional(),
  maxW: z.number().optional(),
  maxH: z.number().optional(),
  static: z.boolean().optional(),
});

const saveConfigSchema = z.object({
  config: z.record(z.string(), z.array(layoutItemSchema)),
});

// =============================================================================
// Routes
// =============================================================================

/**
 * GET /api/dashboards/config - Get current user's dashboard config
 */
dashboardRoutes.get('/config', async (c) => {
  return handleGetRequest(c, async (requestHeader: RequestHeader) => {
    const service = container.resolve(DashboardService);
    const config = await service.getConfig(requestHeader);
    return { config };
  });
});

/**
 * PUT /api/dashboards/config - Save current user's dashboard config
 */
dashboardRoutes.put('/config', async (c) => {
  return handleApiRequest(
    c,
    saveConfigSchema,
    async (requestHeader: RequestHeader, request) => {
      const service = container.resolve(DashboardService);
      await service.saveConfig(requestHeader, request.config);
      return { success: true };
    }
  );
});

/**
 * DELETE /api/dashboards/config - Reset current user's dashboard config to default
 */
dashboardRoutes.delete('/config', async (c) => {
  return handleGetRequest(c, async (requestHeader: RequestHeader) => {
    const service = container.resolve(DashboardService);
    const config = await service.resetConfig(requestHeader);
    return { config };
  });
});
