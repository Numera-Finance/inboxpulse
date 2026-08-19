import { Hono } from 'hono';
import { container } from 'tsyringe';
import { NotFoundError, Permission } from '@crm/shared';
import { ContactService } from './service';
import type { RequestHeader } from '@crm/shared';
import { assignContactCustomerRequestSchema, createContactRequestSchema } from '@crm/clients';
import { requirePermission } from '../middleware/require-permission';
import { handleApiRequest, handleApiRequestWithStatus, handleGetRequest, handleGetRequestWithParams, handleApiRequestWithParams } from '../utils/api-handler';
import { z } from 'zod';

export const contactRoutes = new Hono();

/**
 * POST /api/contacts - Create/upsert contact
 *
 * Tenant comes from `requestHeader.tenantId` (resolved by the session middleware),
 * never from the request body.
 */
contactRoutes.post('/', async (c) => {
  return handleApiRequestWithStatus(
    c,
    createContactRequestSchema,
    201,
    async (requestHeader: RequestHeader, data) => {
      const contactService = container.resolve(ContactService);
      return await contactService.upsertContact(requestHeader.tenantId, data);
    }
  );
});

/**
 * POST /api/contacts/assign-customer - Point an email address at a customer.
 *
 * Unlike a plain upsert this is retroactive: it re-links the sender's existing
 * emails and, where the domain is unowned or held by an auto-created
 * placeholder, moves the domain too so the assignment survives future emails.
 * Requires CUSTOMER_EDIT — it changes which customer emails are attributed to,
 * and therefore who can see them.
 *
 * Declared before `/:id` routes so the literal path is not swallowed by them.
 */
contactRoutes.post('/assign-customer', requirePermission(Permission.CUSTOMER_EDIT), async (c) => {
  return handleApiRequest(
    c,
    assignContactCustomerRequestSchema,
    async (requestHeader: RequestHeader, data) => {
      const contactService = container.resolve(ContactService);
      return await contactService.assignCustomer(requestHeader, data);
    }
  );
});

/**
 * GET /api/contacts - List all contacts for tenant (with access control)
 */
contactRoutes.get('/', async (c) => {
  return handleGetRequest(c, async (requestHeader: RequestHeader) => {
    const service = container.resolve(ContactService);
    return await service.getContactsByTenantScoped(requestHeader);
  });
});

/**
 * GET /api/contacts/customer/:customerId - Get contacts by customer (with access control)
 */
contactRoutes.get('/customer/:customerId', async (c) => {
  return handleGetRequestWithParams(
    c,
    z.object({ customerId: z.uuid() }),
    async (requestHeader: RequestHeader, params) => {
      const service = container.resolve(ContactService);
      return await service.getContactsByCustomerScoped(requestHeader, params.customerId);
    }
  );
});

/**
 * GET /api/contacts/email/:email - Get contact by email (with access control)
 */
contactRoutes.get('/email/:email', async (c) => {
  return handleGetRequestWithParams(
    c,
    z.object({ email: z.string() }),
    async (requestHeader: RequestHeader, params) => {
      const service = container.resolve(ContactService);
      const email = decodeURIComponent(params.email);
      const contact = await service.getContactByEmailScoped(requestHeader, email);
      if (!contact) {
        throw new NotFoundError('Contact', email);
      }
      return contact;
    }
  );
});

/**
 * GET /api/contacts/:id - Get contact by ID (with access control)
 */
contactRoutes.get('/:id', async (c) => {
  return handleGetRequestWithParams(
    c,
    z.object({ id: z.uuid() }),
    async (requestHeader: RequestHeader, params) => {
      const service = container.resolve(ContactService);
      const contact = await service.getContactByIdScoped(requestHeader, params.id);
      if (!contact) {
        throw new NotFoundError('Contact', params.id);
      }
      return contact;
    }
  );
});

const updateContactRequestSchema = createContactRequestSchema.partial();

/**
 * PATCH /api/contacts/:id - Update contact (with access control)
 */
contactRoutes.patch('/:id', async (c) => {
  return handleApiRequestWithParams(
    c,
    z.object({ id: z.uuid() }),
    updateContactRequestSchema,
    async (requestHeader: RequestHeader, params, data) => {
      const service = container.resolve(ContactService);
      const contact = await service.updateContactScoped(requestHeader, params.id, data);
      if (!contact) {
        throw new NotFoundError('Contact', params.id);
      }
      return contact;
    }
  );
});

