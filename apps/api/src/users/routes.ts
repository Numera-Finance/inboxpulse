import { Hono } from 'hono';
import { z } from 'zod';
import { container } from 'tsyringe';
import { NotFoundError, ValidationError, Permission } from '@crm/shared';
import { requirePermission } from '../middleware/require-permission';
import { getRequestHeader } from '../utils/request-header';
import { handleApiRequest, handleApiRequestWithStatus, handleGetRequestWithParams, handleApiRequestWithParams } from '../utils/api-handler';
import { UserService } from './service';
import {
  createUserRequestSchema,
  updateUserRequestSchema,
  updateUserPreferencesSchema,
  addManagerRequestSchema,
  addCustomerRequestSchema,
  transferUserRequestSchema,
} from '@crm/clients';
import { searchRequestSchema } from '@crm/shared';
import type { RequestHeader, ApiResponse } from '@crm/shared';

export const userRoutes = new Hono();

/**
 * GET /api/users/me/permissions - Get current user's permissions
 * Returns the permissions array from the user's role
 */
userRoutes.get('/me/permissions', async (c) => {
  const requestHeader = getRequestHeader(c);
  return c.json<ApiResponse<{ permissions: number[] }>>({
    success: true,
    data: {
      permissions: requestHeader.permissions ?? [],
    },
  });
});

/**
 * GET /api/users/me/debug - Debug endpoint to check role and permissions
 * Returns detailed info about current user's role setup
 */
userRoutes.get('/me/debug', async (c) => {
  const requestHeader = getRequestHeader(c);
  const service = container.resolve(UserService);
  const user = await service.getById(requestHeader, requestHeader.userId);

  // Get role details if user has a role
  let roleDetails = null;
  if (user?.roleId) {
    const { RoleRepository } = await import('../roles/repository');
    const roleRepository = container.resolve(RoleRepository);
    const role = await roleRepository.findById(user.roleId);
    roleDetails = role ? {
      id: role.id,
      name: role.name,
      permissions: role.permissions,
      isSystem: role.isSystem,
    } : null;
  }

  return c.json<ApiResponse<{
    userId: string;
    email: string;
    roleId: string | null;
    roleDetails: typeof roleDetails;
    effectivePermissions: number[];
    isAdmin: boolean;
  }>>({
    success: true,
    data: {
      userId: requestHeader.userId,
      email: user?.email ?? 'unknown',
      roleId: user?.roleId ?? null,
      roleDetails,
      effectivePermissions: requestHeader.permissions ?? [],
      isAdmin: requestHeader.permissions?.includes(8) ?? false,
    },
  });
});

/**
 * PATCH /api/users/me/preferences - Update current user's preferences
 * Self-service endpoint - no special permissions required
 * NOTE: Must be defined BEFORE /me to avoid route conflicts
 */
userRoutes.patch('/me/preferences', async (c) => {
  return handleApiRequest(
    c,
    updateUserPreferencesSchema,
    async (requestHeader: RequestHeader, request) => {
      const service = container.resolve(UserService);
      const user = await service.update(requestHeader.userId, request);

      if (!user) {
        throw new NotFoundError('User', requestHeader.userId);
      }

      return user;
    }
  );
});

/**
 * GET /api/users/me - Get current user's profile
 */
userRoutes.get('/me', async (c) => {
  const requestHeader = getRequestHeader(c);
  const service = container.resolve(UserService);
  const user = await service.getById(requestHeader, requestHeader.userId);

  if (!user) {
    throw new NotFoundError('User', requestHeader.userId);
  }

  return c.json<ApiResponse<typeof user>>({
    success: true,
    data: user,
  });
});

/**
 * GET /api/users/export - Export users to CSV
 * Registered before /:id so Hono doesn't route "export" as a UUID id.
 * Uses Hono's c.header + c.body to mirror the customer export handler.
 */
userRoutes.get('/export', async (c) => {
  const requestHeader = getRequestHeader(c);
  const service = container.resolve(UserService);

  const csvContent = await service.exportUsers(requestHeader.tenantId);

  c.header('Content-Type', 'text/csv; charset=utf-8');
  c.header('Content-Disposition', 'attachment; filename="users.csv"');

  return c.body(csvContent);
});

/**
 * GET /api/users/:id - Get user by ID
 */
userRoutes.get('/:id', async (c) => {
  return handleGetRequestWithParams(
    c,
    z.object({ id: z.uuid() }),
    async (requestHeader: RequestHeader, params) => {
      const service = container.resolve(UserService);
      const user = await service.getById(requestHeader, params.id);

      if (!user) {
        throw new NotFoundError('User', params.id);
      }

      return user;
    }
  );
});

/**
 * GET /api/users/by-customer/:customerId - Get users assigned to a customer
 */
userRoutes.get('/by-customer/:customerId', async (c) => {
  return handleGetRequestWithParams(
    c,
    z.object({ customerId: z.uuid() }),
    async (requestHeader: RequestHeader, params) => {
      const service = container.resolve(UserService);
      return await service.getUsersByCustomer(params.customerId);
    }
  );
});

/**
 * POST /api/users/find - Search users
 */
userRoutes.post('/find', async (c) => {
  return handleApiRequest(
    c,
    searchRequestSchema,
    async (requestHeader: RequestHeader, searchRequest) => {
      const service = container.resolve(UserService);
      return await service.search(requestHeader, searchRequest);
    }
  );
});

/**
 * POST /api/users - Create user
 * Requires USER_ADD permission
 */
userRoutes.post('/', requirePermission(Permission.USER_ADD), async (c) => {
  return handleApiRequestWithStatus(
    c,
    createUserRequestSchema,
    201,
    async (requestHeader: RequestHeader, request) => {
      const service = container.resolve(UserService);
      const user = await service.create(requestHeader.tenantId, {
        firstName: request.firstName,
        lastName: request.lastName,
        email: request.email,
        timezone: request.timezone,
        rowStatus: 0, // Active by default
      });

      // Add managers if provided
      if (request.managerEmails && request.managerEmails.length > 0) {
        const managerIds: string[] = [];
        for (const email of request.managerEmails) {
          const manager = await service.getByEmail(requestHeader.tenantId, email);
          if (manager) {
            managerIds.push(manager.id);
          }
        }
        if (managerIds.length > 0) {
          await service.setManagers(requestHeader.tenantId, user.id, managerIds);
        }
      }

      // Add customer assignments if provided
      if (request.customerAssignments && request.customerAssignments.length > 0) {
        const assignments = request.customerAssignments.map(a => ({
          customerId: a.customerId,
          roleId: a.roleId,
        }));
        await service.setCustomerAssignments(
          requestHeader.tenantId,
          user.id,
          assignments
        );
      }

      return user;
    }
  );
});

/**
 * PATCH /api/users/:id - Update user
 * Requires USER_EDIT permission
 */
userRoutes.patch('/:id', requirePermission(Permission.USER_EDIT), async (c) => {
  return handleApiRequestWithParams(
    c,
    z.object({ id: z.uuid() }),
    updateUserRequestSchema,
    async (requestHeader: RequestHeader, params, request) => {
      const service = container.resolve(UserService);
      const user = await service.update(params.id, request);

      if (!user) {
        throw new NotFoundError('User', params.id);
      }

      // Verify tenant isolation
      if (user.tenantId !== requestHeader.tenantId) {
        throw new NotFoundError('User', params.id);
      }

      // Update managers if provided
      if (request.managerEmails) {
        const managerIds: string[] = [];
        for (const email of request.managerEmails) {
          const manager = await service.getByEmail(requestHeader.tenantId, email);
          if (manager) {
            managerIds.push(manager.id);
          }
        }
        await service.setManagers(requestHeader.tenantId, params.id, managerIds);
      }

      return user;
    }
  );
});

/**
 * PATCH /api/users/:id/activate - Mark user as active (rowStatus=0)
 * Requires USER_EDIT permission
 */
userRoutes.patch('/:id/activate', requirePermission(Permission.USER_EDIT), async (c) => {
  return handleGetRequestWithParams(
    c,
    z.object({ id: z.uuid() }),
    async (requestHeader: RequestHeader, params) => {
      const service = container.resolve(UserService);
      return await service.markActive(requestHeader.tenantId, params.id);
    }
  );
});

/**
 * PATCH /api/users/:id/deactivate - Mark user as inactive (rowStatus=1)
 * Requires USER_DEL permission (deactivating is a form of deletion)
 */
userRoutes.patch('/:id/deactivate', requirePermission(Permission.USER_DEL), async (c) => {
  return handleGetRequestWithParams(
    c,
    z.object({ id: z.uuid() }),
    async (requestHeader: RequestHeader, params) => {
      const service = container.resolve(UserService);
      return await service.markInactive(requestHeader.tenantId, params.id);
    }
  );
});

/**
 * POST /api/users/:id/managers - Add manager to user
 * Requires USER_EDIT permission
 */
userRoutes.post('/:id/managers', requirePermission(Permission.USER_EDIT), async (c) => {
  return handleApiRequestWithParams(
    c,
    z.object({ id: z.uuid() }),
    addManagerRequestSchema,
    async (requestHeader: RequestHeader, params, request) => {
      const service = container.resolve(UserService);

      // Find manager by email
      const manager = await service.getByEmail(requestHeader.tenantId, request.managerEmail);
      if (!manager) {
        throw new NotFoundError('Manager', request.managerEmail);
      }

      await service.addManager(requestHeader.tenantId, params.id, manager.id);
      return { success: true };
    }
  );
});

/**
 * DELETE /api/users/:id/managers/:managerId - Remove manager from user
 * Requires USER_EDIT permission
 */
userRoutes.delete('/:id/managers/:managerId', requirePermission(Permission.USER_EDIT), async (c) => {
  return handleGetRequestWithParams(
    c,
    z.object({
      id: z.uuid(),
      managerId: z.uuid(),
    }),
    async (requestHeader: RequestHeader, params) => {
      const service = container.resolve(UserService);
      await service.removeManager(requestHeader.tenantId, params.id, params.managerId);
      return { success: true };
    }
  );
});

/**
 * POST /api/users/:id/customers - Add customer to user
 * Requires USER_CUSTOMER_MANAGE permission
 */
userRoutes.post('/:id/customers', requirePermission(Permission.USER_CUSTOMER_MANAGE), async (c) => {
  return handleApiRequestWithParams(
    c,
    z.object({ id: z.uuid() }),
    addCustomerRequestSchema,
    async (requestHeader: RequestHeader, params, request) => {
      const service = container.resolve(UserService);
      const { CustomerService } = await import('../customers/service');
      const customerService = container.resolve(CustomerService);

      // Find customer by domain
      const customer = await customerService.getCustomerByDomain(
        requestHeader.tenantId,
        request.customerDomain
      );
      if (!customer) {
        throw new NotFoundError('Customer', request.customerDomain);
      }

      await service.addCustomerAssignment(
        requestHeader.tenantId,
        params.id,
        customer.id,
        request.roleId
      );
      return { success: true };
    }
  );
});

/**
 * DELETE /api/users/:id/customers/:customerId - Remove customer from user
 * Requires USER_CUSTOMER_MANAGE permission
 */
userRoutes.delete('/:id/customers/:customerId', requirePermission(Permission.USER_CUSTOMER_MANAGE), async (c) => {
  return handleGetRequestWithParams(
    c,
    z.object({
      id: z.uuid(),
      customerId: z.uuid(),
    }),
    async (requestHeader: RequestHeader, params) => {
      const service = container.resolve(UserService);
      await service.removeCustomerAssignment(
        requestHeader.tenantId,
        params.id,
        params.customerId
      );
      return { success: true };
    }
  );
});

/**
 * PUT /api/users/:id/customers - Set all customer assignments for a user (replaces existing)
 */
const setCustomerAssignmentsSchema = z.object({
  assignments: z.array(z.object({
    customerId: z.string().uuid(),
    roleId: z.string().uuid({ message: 'Role is required for customer assignment' }),
  })),
});

userRoutes.put('/:id/customers', requirePermission(Permission.USER_CUSTOMER_MANAGE), async (c) => {
  return handleApiRequestWithParams(
    c,
    z.object({ id: z.uuid() }),
    setCustomerAssignmentsSchema,
    async (requestHeader: RequestHeader, params, request) => {
      const service = container.resolve(UserService);
      await service.setCustomerAssignments(
        requestHeader.tenantId,
        params.id,
        request.assignments
      );
      return { success: true };
    }
  );
});

/**
 * POST /api/users/:id/transfer - Transfer user's responsibilities to another user
 * Requires USER_CUSTOMER_MANAGE permission
 */
userRoutes.post('/:id/transfer', requirePermission(Permission.USER_CUSTOMER_MANAGE), async (c) => {
  return handleApiRequestWithParams(
    c,
    z.object({ id: z.uuid() }),
    transferUserRequestSchema,
    async (requestHeader: RequestHeader, params, request) => {
      const service = container.resolve(UserService);
      return await service.transferToUser(requestHeader, params.id, request.targetUserId);
    }
  );
});

/**
 * POST /api/users/import - Import users from CSV or Excel
 * Requires USER_ADD permission
 */
userRoutes.post('/import', requirePermission(Permission.USER_ADD), async (c) => {
  const requestHeader = getRequestHeader(c);

  // Get file from multipart form data
  const formData = await c.req.formData();
  const file = formData.get('file') as File;

  if (!file) {
    throw new ValidationError('File is required');
  }

  // Validate file type - accept Excel and CSV formats
  const fileName = file.name.toLowerCase();
  const validExtensions = ['.xlsx', '.xls', '.csv'];
  if (!validExtensions.some(ext => fileName.endsWith(ext))) {
    throw new ValidationError('File must be an Excel (.xlsx, .xls) or CSV (.csv) file');
  }

  const service = container.resolve(UserService);
  const result = await service.importUsersFromFile(requestHeader.tenantId, file);

  return c.json<ApiResponse<typeof result>>({
    success: true,
    data: result,
  });
});

// ===========================================================================
// Notification-related endpoints (for service-to-service calls)
// ===========================================================================

/**
 * GET /api/users/:id/permissions - Get user's permissions
 * Used by notifications service for access control
 */
userRoutes.get('/:id/permissions', async (c) => {
  return handleGetRequestWithParams(
    c,
    z.object({ id: z.uuid() }),
    async (requestHeader: RequestHeader, params) => {
      const service = container.resolve(UserService);
      const permissions = await service.getUserPermissions(requestHeader.tenantId, params.id);
      return { permissions };
    }
  );
});

/**
 * GET /api/users/:id/customers/:customerId/access - Check if user has access to customer
 * Used by notifications service for data access validation
 */
userRoutes.get('/:id/customers/:customerId/access', async (c) => {
  return handleGetRequestWithParams(
    c,
    z.object({ id: z.uuid(), customerId: z.uuid() }),
    async (requestHeader: RequestHeader, params) => {
      const service = container.resolve(UserService);
      const hasAccess = await service.hasAccessToCustomer(params.id, params.customerId);
      return { hasAccess };
    }
  );
});

/**
 * GET /api/users/:id/has-customers - Check if user has any customer assignments
 * Used by notifications for subscription conditions
 */
userRoutes.get('/:id/has-customers', async (c) => {
  return handleGetRequestWithParams(
    c,
    z.object({ id: z.uuid() }),
    async (requestHeader: RequestHeader, params) => {
      const service = container.resolve(UserService);
      const hasCustomers = await service.hasAnyCustomers(params.id);
      return { hasCustomers };
    }
  );
});

/**
 * GET /api/users/:id/has-manager - Check if user has a manager
 * Used by notifications for subscription conditions
 */
userRoutes.get('/:id/has-manager', async (c) => {
  return handleGetRequestWithParams(
    c,
    z.object({ id: z.uuid() }),
    async (requestHeader: RequestHeader, params) => {
      const service = container.resolve(UserService);
      const hasManager = await service.hasManager(params.id);
      return { hasManager };
    }
  );
});
