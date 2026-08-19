import { Hono } from 'hono';
import { container } from 'tsyringe';
import { z } from 'zod';
import type { RequestHeader } from '@crm/shared';
import { Permission } from '@crm/shared';
import { requirePermission } from '../middleware/require-permission';
import {
  handleApiRequest,
  handleGetRequest,
  handleGetRequestWithParams,
} from '../utils/api-handler';
import { ManagerService } from './service';
import type { DashboardFilters } from './repository';
import type { Context } from 'hono';

/**
 * The AI Analysis list's filter set. Every field is optional — the UI sends
 * whichever controls the reader has touched. Values are validated rather than
 * interpolated: `signal`, `churnLevel`, `status` and the sort keys are compared
 * against closed sets inside the repository.
 */
const analyzedSearchSchema = z.object({
  search: z.string().optional(),
  signal: z.string().optional(),
  churnLevel: z.string().optional(),
  status: z.string().optional(),
  assignedToId: z.string().optional(),
  customerId: z.uuid().optional(),
  teamMemberId: z.uuid().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  sortBy: z.string().optional(),
  sortOrder: z.string().optional(),
  groupByThread: z.boolean().optional(),
  limit: z.number().int().min(1).max(200).optional(),
  offset: z.number().int().min(0).optional(),
});

/** Open (0) or Done (1) — the only two states the toggle produces. */
const taskStatusSchema = z.object({
  status: z.union([z.literal(0), z.literal(1)]),
});

/** Customers list filters. `sortBy`/`sortOrder` map to closed sets downstream. */
const customerSearchSchema = z.object({
  search: z.string().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  customerId: z.uuid().optional(),
  teamMemberId: z.uuid().optional(),
  sortBy: z.string().optional(),
  sortOrder: z.string().optional(),
  limit: z.number().int().min(1).max(200).optional(),
  offset: z.number().int().min(0).optional(),
});

/** Users list filters. `status` is 'active' (default) or 'inactive'. */
const userSearchSchema = z.object({
  search: z.string().optional(),
  status: z.string().optional(),
  sortBy: z.string().optional(),
  sortOrder: z.string().optional(),
  limit: z.number().int().min(1).max(200).optional(),
  offset: z.number().int().min(0).optional(),
});

/** Adding a team member, or re-roling one already on the team. */
const teamMemberSchema = z.object({
  userId: z.uuid(),
  roleId: z.uuid().nullable().optional(),
});

/**
 * The user edit drawer's patch. Every field optional — only what was submitted
 * gets written. `rowStatus` is the Active/Inactive/Archived tri-state.
 */
const userPatchSchema = z.object({
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  roleId: z.uuid().nullable().optional(),
  timezone: z.string().optional(),
  canLogin: z.boolean().optional(),
  rowStatus: z.union([z.literal(0), z.literal(1), z.literal(2)]).optional(),
  managerIds: z.array(z.uuid()).optional(),
  customerAssignments: z
    .array(
      z.object({
        customerId: z.uuid(),
        roleId: z.uuid().nullable().optional(),
      })
    )
    .optional(),
});

/**
 * Manager dashboard analytics, mounted at /api/manager.
 *
 * These endpoints used to live in the standalone `crm-manager` Cloud Run
 * service, reachable only through a local `gcloud run services proxy` that every
 * operator had to keep running. Serving them from crm-api puts them behind the
 * same better-auth session, tenant resolution and per-user customer scoping as
 * the rest of the product, and removes the proxy from the picture entirely.
 *
 * Mounted under its own /api/manager prefix rather than at the paths the ported
 * UI originally used (/api/dashboard/*, /api/customers/search, …): several of
 * those would collide with crm-api's existing customer and user routes, which
 * mean different things. The extension's transport prepends the prefix, so the
 * ported section modules did not have to change.
 *
 * Authorization is session + per-user customer scoping, deliberately without a
 * `requirePermission(Permission.ADMIN)` gate. crm-manager had no role check of
 * its own — entitlement was a Cloud Run IAM binding — so requiring ADMIN here
 * would silently take the dashboard away from whoever has it today. Add it as a
 * one-line `managerRoutes.use('*', requirePermission(Permission.ADMIN))` if the
 * dashboard should become admin-only; that is a policy decision, not a port.
 */
export const managerRoutes = new Hono();

/** Read the dashboard's top-bar filters off the query string. */
function filtersFrom(c: Context): DashboardFilters {
  return {
    dateFrom: c.req.query('dateFrom') || undefined,
    dateTo: c.req.query('dateTo') || undefined,
    customerId: c.req.query('customerId') || undefined,
    teamMemberId: c.req.query('teamMemberId') || undefined,
  };
}

function limitFrom(c: Context, fallback: number): number {
  const raw = parseInt(c.req.query('limit') ?? '', 10);
  return Number.isFinite(raw) ? raw : fallback;
}

/** GET /api/manager/dashboard/summary — the four headline tiles. */
managerRoutes.get('/dashboard/summary', async (c) => {
  const filters = filtersFrom(c);
  return handleGetRequest(c, async (requestHeader: RequestHeader) => {
    return await container.resolve(ManagerService).getSummary(requestHeader, filters);
  });
});

/** GET /api/manager/dashboard/sentiment-distribution — donut chart. */
managerRoutes.get('/dashboard/sentiment-distribution', async (c) => {
  const filters = filtersFrom(c);
  return handleGetRequest(c, async (requestHeader: RequestHeader) => {
    return await container.resolve(ManagerService).getSentimentDistribution(requestHeader, filters);
  });
});

/**
 * GET /api/manager/dashboard/sentiment-trend — trailing 6 months.
 * Ignores the date filter by design; see the repository method.
 */
managerRoutes.get('/dashboard/sentiment-trend', async (c) => {
  return handleGetRequest(c, async (requestHeader: RequestHeader) => {
    return await container.resolve(ManagerService).getSentimentTrend(requestHeader);
  });
});

/** GET /api/manager/dashboard/volume-trend — emails per day in range. */
managerRoutes.get('/dashboard/volume-trend', async (c) => {
  const filters = filtersFrom(c);
  return handleGetRequest(c, async (requestHeader: RequestHeader) => {
    return await container.resolve(ManagerService).getVolumeTrend(requestHeader, filters);
  });
});

/** GET /api/manager/dashboard/tat-metrics — business-day TAT buckets per customer. */
managerRoutes.get('/dashboard/tat-metrics', async (c) => {
  const filters = filtersFrom(c);
  return handleGetRequest(c, async (requestHeader: RequestHeader) => {
    return await container.resolve(ManagerService).getTatMetrics(requestHeader, filters);
  });
});

/** GET /api/manager/dashboard/recent-escalations — newest negative-sentiment emails. */
managerRoutes.get('/dashboard/recent-escalations', async (c) => {
  const filters = filtersFrom(c);
  const limit = limitFrom(c, 8);
  return handleGetRequest(c, async (requestHeader: RequestHeader) => {
    return await container.resolve(ManagerService).getRecentEscalations(requestHeader, filters, limit);
  });
});

/**
 * GET /api/manager/dashboard/important-escalations — threads whose latest
 * customer email is still an open negative escalation, longest chain first.
 * Defaults to 4 because the tile is a four-row bar list.
 */
managerRoutes.get('/dashboard/important-escalations', async (c) => {
  const filters = filtersFrom(c);
  const limit = limitFrom(c, 4);
  return handleGetRequest(c, async (requestHeader: RequestHeader) => {
    return await container
      .resolve(ManagerService)
      .getImportantEscalations(requestHeader, filters, limit);
  });
});

/**
 * GET /api/manager/dashboard/most-escalated-customers — customers with >10
 * analyzed emails, ranked by the share of them that is negative.
 * Defaults to 4 to match the tile.
 */
managerRoutes.get('/dashboard/most-escalated-customers', async (c) => {
  const filters = filtersFrom(c);
  const limit = limitFrom(c, 4);
  return handleGetRequest(c, async (requestHeader: RequestHeader) => {
    return await container
      .resolve(ManagerService)
      .getMostEscalatedCustomers(requestHeader, filters, limit);
  });
});

/** GET /api/manager/dashboard/churn-levels — counts by risk level. */
managerRoutes.get('/dashboard/churn-levels', async (c) => {
  const filters = filtersFrom(c);
  return handleGetRequest(c, async (requestHeader: RequestHeader) => {
    return await container.resolve(ManagerService).getChurnLevels(requestHeader, filters);
  });
});

/** GET /api/manager/dashboard/team-responsiveness — per-member reply performance. */
managerRoutes.get('/dashboard/team-responsiveness', async (c) => {
  const filters = filtersFrom(c);
  return handleGetRequest(c, async (requestHeader: RequestHeader) => {
    return await container.resolve(ManagerService).getTeamResponsiveness(requestHeader, filters);
  });
});

/** GET /api/manager/dashboard/resolution-time — average time to first team reply. */
managerRoutes.get('/dashboard/resolution-time', async (c) => {
  const filters = filtersFrom(c);
  return handleGetRequest(c, async (requestHeader: RequestHeader) => {
    return await container.resolve(ManagerService).getAvgResolutionTime(requestHeader, filters);
  });
});

/**
 * POST /api/manager/emails/analyzed/search — the AI Analysis list.
 *
 * Registered before the /emails/analyzed/:emailId GET below; they differ in
 * method as well as path, so the order is for readability only.
 */
managerRoutes.post('/emails/analyzed/search', async (c) => {
  return handleApiRequest(c, analyzedSearchSchema, async (requestHeader, body) => {
    return await container.resolve(ManagerService).searchAnalyzedEmails(requestHeader, body);
  });
});

/**
 * GET /api/manager/emails/analyzed/stats — AI Analysis headline counts.
 *
 * MUST stay above /emails/analyzed/:emailId. Hono matches in registration
 * order, so the parameterised route would otherwise swallow the literal
 * "stats" segment and reject it as a malformed uuid.
 */
managerRoutes.get('/emails/analyzed/stats', async (c) => {
  const days = parseInt(c.req.query('days') ?? '30', 10);
  return handleGetRequest(c, async (requestHeader: RequestHeader) => {
    return await container
      .resolve(ManagerService)
      .getAnalyzedStats(requestHeader, Number.isFinite(days) ? days : 30);
  });
});

/** GET /api/manager/emails/analyzed/:emailId — one email with its task overlay. */
managerRoutes.get('/emails/analyzed/:emailId', async (c) => {
  return handleGetRequestWithParams(
    c,
    z.object({ emailId: z.uuid() }),
    async (requestHeader: RequestHeader, params) => {
      return await container.resolve(ManagerService).getAnalyzedEmailById(requestHeader, params.emailId);
    }
  );
});

/** GET /api/manager/emails/threads/:threadId — every message in a conversation. */
managerRoutes.get('/emails/threads/:threadId', async (c) => {
  return handleGetRequestWithParams(
    c,
    z.object({ threadId: z.uuid() }),
    async (requestHeader: RequestHeader, params) => {
      const messages = await container
        .resolve(ManagerService)
        .getThreadEmails(requestHeader, params.threadId);
      return { messages };
    }
  );
});

/** PATCH /api/manager/tasks/:taskId — toggle a task between Open and Done. */
managerRoutes.patch('/tasks/:taskId', async (c) => {
  const taskId = c.req.param('taskId');
  const parsedId = z.uuid().safeParse(taskId);
  if (!parsedId.success) {
    return c.json(
      { success: false, error: { code: 'INVALID_ID', message: 'Invalid task id', statusCode: 400 } },
      400
    );
  }
  return handleApiRequest(c, taskStatusSchema, async (requestHeader, body) => {
    return await container
      .resolve(ManagerService)
      .updateTaskStatus(requestHeader, parsedId.data, body.status);
  });
});

/** GET /api/manager/roles — system roles for the Users drawer dropdown. */
managerRoutes.get('/roles', async (c) => {
  return handleGetRequest(c, async (requestHeader: RequestHeader) => {
    return await container.resolve(ManagerService).getRoles(requestHeader);
  });
});

// ---------------------------------------------------------------------------
// Customers section
//
// Reads are session-scoped and further narrowed to the caller's accessible
// customers. Writes are ADMIN-only: crm-manager had no role check at all, so
// anyone who could reach the proxy could reassign a customer's team. Serving
// the same endpoint from crm-api makes it reachable by every signed-in user,
// which is exactly why the gate goes on now rather than later.
// ---------------------------------------------------------------------------

/** Path ids are uuids; reject anything else before it reaches a query. */
function uuidParam(c: Context, name: string): string | null {
  const parsed = z.uuid().safeParse(c.req.param(name));
  return parsed.success ? parsed.data : null;
}

function invalidId(c: Context) {
  return c.json(
    { success: false, error: { code: 'INVALID_ID', message: 'Invalid id', statusCode: 400 } },
    400
  );
}

/** POST /api/manager/customers/search — the Customers list, paged. */
managerRoutes.post('/customers/search', async (c) => {
  return handleApiRequest(c, customerSearchSchema, async (requestHeader, body) => {
    return await container.resolve(ManagerService).getCustomersList(requestHeader, body);
  });
});

/** GET /api/manager/customers/:customerId — detail header for the drawer. */
managerRoutes.get('/customers/:customerId', async (c) => {
  const customerId = uuidParam(c, 'customerId');
  if (!customerId) return invalidId(c);
  return handleGetRequest(c, async (requestHeader: RequestHeader) => {
    return await container.resolve(ManagerService).getCustomerById(requestHeader, customerId);
  });
});

/** GET /api/manager/customers/:customerId/contacts — Contacts tab. */
managerRoutes.get('/customers/:customerId/contacts', async (c) => {
  const customerId = uuidParam(c, 'customerId');
  if (!customerId) return invalidId(c);
  return handleGetRequest(c, async (requestHeader: RequestHeader) => {
    return await container.resolve(ManagerService).getCustomerContacts(requestHeader, customerId);
  });
});

/** GET /api/manager/customers/:customerId/team — Team tab. */
managerRoutes.get('/customers/:customerId/team', async (c) => {
  const customerId = uuidParam(c, 'customerId');
  if (!customerId) return invalidId(c);
  return handleGetRequest(c, async (requestHeader: RequestHeader) => {
    return await container.resolve(ManagerService).getCustomerTeam(requestHeader, customerId);
  });
});

/**
 * POST /api/manager/customers/:customerId/team — add a member, or change the
 * role of one already on the team. Returns the resulting team.
 */
managerRoutes.post(
  '/customers/:customerId/team',
  requirePermission(Permission.ADMIN),
  async (c) => {
    const customerId = uuidParam(c, 'customerId');
    if (!customerId) return invalidId(c);
    return handleApiRequest(c, teamMemberSchema, async (requestHeader, body) => {
      return await container
        .resolve(ManagerService)
        .addCustomerTeamMember(requestHeader, customerId, body.userId, body.roleId ?? null);
    });
  }
);

/** GET /api/manager/team-roles — per-customer role vocabulary (not `roles`). */
managerRoutes.get('/team-roles', async (c) => {
  return handleGetRequest(c, async () => {
    return container.resolve(ManagerService).getTeamRoles();
  });
});

// ---------------------------------------------------------------------------
// Users section
// ---------------------------------------------------------------------------

/** POST /api/manager/users/search — the Users list, paged. */
managerRoutes.post('/users/search', async (c) => {
  return handleApiRequest(c, userSearchSchema, async (requestHeader, body) => {
    return await container.resolve(ManagerService).getUsersList(requestHeader, body);
  });
});

/** GET /api/manager/users/:userId — detail for the edit drawer. */
managerRoutes.get('/users/:userId', async (c) => {
  const userId = uuidParam(c, 'userId');
  if (!userId) return invalidId(c);
  return handleGetRequest(c, async (requestHeader: RequestHeader) => {
    return await container.resolve(ManagerService).getUserById(requestHeader, userId);
  });
});

/** PATCH /api/manager/users/:userId — save the edit drawer. */
managerRoutes.patch('/users/:userId', requirePermission(Permission.ADMIN), async (c) => {
  const userId = uuidParam(c, 'userId');
  if (!userId) return invalidId(c);
  return handleApiRequest(c, userPatchSchema, async (requestHeader, body) => {
    return await container.resolve(ManagerService).updateUser(requestHeader, userId, body);
  });
});

