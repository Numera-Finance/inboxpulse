import { Hono } from 'hono';
import { container } from 'tsyringe';
import { NotFoundError, searchRequestSchema, Permission, ValidationError } from '@crm/shared';
import { CustomerService } from './service';
import type { ApiResponse, RequestHeader } from '@crm/shared';
import { createCustomerRequestSchema, type CreateCustomerRequest } from '@crm/clients';
import { requirePermission } from '../middleware/require-permission';
import { handleApiRequest, handleGetRequest, handleGetRequestWithParams, handleApiRequestWithParams } from '../utils/api-handler';
import { getRequestHeader } from '../utils/request-header';
import { z } from 'zod';
import type { CustomerImportResult } from './import-export';

// Schema for updating customer fields
const updateCustomerSchema = z.object({
  name: z.string().optional(),
  website: z.string().url().optional().nullable(),
  industry: z.string().max(100).optional().nullable(),
  labels: z.array(z.string()).optional(),
  metadata: z.record(z.string(), z.any()).optional().nullable(),
});

export const customerRoutes = new Hono();

/**
 * POST /api/customers/search - Search customers (with access control)
 */
customerRoutes.post('/search', async (c) => {
  return handleApiRequest(
    c,
    searchRequestSchema,
    async (requestHeader: RequestHeader, searchRequest) => {
      const service = container.resolve(CustomerService);
      return await service.search(requestHeader, searchRequest);
    }
  );
});

/**
 * POST /api/customers - Create/upsert customer
 * Requires CUSTOMER_ADD permission
 */
customerRoutes.post('/', requirePermission(Permission.CUSTOMER_ADD), async (c) => {
  const body = await c.req.json();
  const validated: CreateCustomerRequest = createCustomerRequestSchema.parse(body);

  const customerService = container.resolve(CustomerService);
  const customer = await customerService.upsertCustomer(validated);

  return c.json<ApiResponse<typeof customer>>(
    {
      success: true,
      data: customer,
    },
    201
  );
});

/**
 * GET /api/customers - List all customers for tenant (with access control)
 */
customerRoutes.get('/', async (c) => {
  return handleGetRequest(c, async (requestHeader: RequestHeader) => {
    const service = container.resolve(CustomerService);
    return await service.getCustomersByTenantScoped(requestHeader);
  });
});

/**
 * GET /api/customers/domain/:domain - Get customer by domain (with access control)
 */
customerRoutes.get('/domain/:domain', async (c) => {
  return handleGetRequestWithParams(
    c,
    z.object({ domain: z.string() }),
    async (requestHeader: RequestHeader, params) => {
      const service = container.resolve(CustomerService);
      const domain = decodeURIComponent(params.domain);
      const customer = await service.getCustomerByDomainScoped(requestHeader, domain);
      if (!customer) {
        throw new NotFoundError('Customer', domain);
      }
      return customer;
    }
  );
});

/**
 * POST /api/customers/import - Import customers from Excel/CSV file
 * Requires CUSTOMER_ADD permission
 *
 * Accepts multipart form data with 'file' field containing Excel or CSV file
 * Returns import results including counts and any errors/warnings
 */
customerRoutes.post('/import', requirePermission(Permission.CUSTOMER_ADD), async (c) => {
  const requestHeader = getRequestHeader(c);
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

  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  const service = container.resolve(CustomerService);
  const result = await service.importCustomers(requestHeader.tenantId, buffer);

  return c.json<ApiResponse<CustomerImportResult>>({
    success: true,
    data: result,
  });
});

/**
 * GET /api/customers/export - Export all customers to Excel file
 * Returns Excel file as download
 */
customerRoutes.get('/export', async (c) => {
  const requestHeader = getRequestHeader(c);
  const service = container.resolve(CustomerService);

  const buffer = await service.exportCustomers(requestHeader.tenantId);

  c.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  c.header('Content-Disposition', 'attachment; filename="customers.xlsx"');

  // Convert Node.js Buffer to Uint8Array for Hono
  return c.body(new Uint8Array(buffer));
});

/**
 * GET /api/customers/import/template - Download import template
 * Returns Excel template file with example data
 */
customerRoutes.get('/import/template', async (c) => {
  const service = container.resolve(CustomerService);
  const buffer = await service.getImportTemplate();

  c.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  c.header('Content-Disposition', 'attachment; filename="customer-import-template.xlsx"');

  // Convert Node.js Buffer to Uint8Array for Hono
  return c.body(new Uint8Array(buffer));
});

/**
 * GET /api/customers/:id - Get customer by ID (with access control)
 */
customerRoutes.get('/:id', async (c) => {
  return handleGetRequestWithParams(
    c,
    z.object({ id: z.uuid() }),
    async (requestHeader: RequestHeader, params) => {
      const service = container.resolve(CustomerService);
      const customer = await service.getCustomerByIdScoped(requestHeader, params.id);
      if (!customer) {
        throw new NotFoundError('Customer', params.id);
      }
      return customer;
    }
  );
});

/**
 * PATCH /api/customers/:id - Update customer fields (with access control)
 * Requires CUSTOMER_EDIT permission
 */
customerRoutes.patch('/:id', requirePermission(Permission.CUSTOMER_EDIT), async (c) => {
  return handleApiRequestWithParams(
    c,
    z.object({ id: z.uuid() }),
    updateCustomerSchema,
    async (requestHeader: RequestHeader, params, updateData) => {
      const service = container.resolve(CustomerService);

      // Verify customer exists and user has access
      const existing = await service.getCustomerByIdScoped(requestHeader, params.id);
      if (!existing) {
        throw new NotFoundError('Customer', params.id);
      }

      // Update the customer
      const updated = await service.updateCustomer(params.id, updateData);
      if (!updated) {
        throw new NotFoundError('Customer', params.id);
      }

      // Return updated customer with domains
      const customer = await service.getCustomerByIdScoped(requestHeader, params.id);
      return customer;
    }
  );
});
