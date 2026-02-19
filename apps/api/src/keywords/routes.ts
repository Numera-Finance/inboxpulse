import { Hono } from 'hono';
import { z } from 'zod';
import { container } from 'tsyringe';
import { Permission } from '@crm/shared';
import { requirePermission } from '../middleware/require-permission';
import { handleGetRequest, handleApiRequestWithParams } from '../utils/api-handler';
import { KeywordService } from './service';
import type { RequestHeader } from '@crm/shared';

export const keywordRoutes = new Hono();

keywordRoutes.use('*', requirePermission(Permission.ADMIN));

/**
 * GET /api/keywords — all keyword entries for current tenant
 */
keywordRoutes.get('/', async (c) => {
  return handleGetRequest(c, async (requestHeader: RequestHeader) => {
    const service = container.resolve(KeywordService);
    return await service.getAllForTenant(requestHeader.tenantId);
  });
});

/**
 * PUT /api/keywords/:category — upsert keywords for a category
 */
keywordRoutes.put('/:category', async (c) => {
  return handleApiRequestWithParams(
    c,
    z.object({ category: z.string().min(1) }),
    z.object({ keywords: z.string() }),
    async (requestHeader: RequestHeader, params, request) => {
      const service = container.resolve(KeywordService);
      await service.saveKeywords(requestHeader.tenantId, params.category, request.keywords);
      return { success: true };
    }
  );
});
