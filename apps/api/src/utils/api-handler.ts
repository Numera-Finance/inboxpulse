import { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { z } from 'zod';
import type { RequestHeader, ApiResponse } from '@crm/shared';
import { getRequestHeader } from './request-header';

/**
 * Standard API handler helper
 * Extracts RequestHeader, validates request, and returns standardized response
 * 
 * @example
 * ```typescript
 * app.post('/', async (c) => {
 *   return handleApiRequest(c, createCompanyRequestSchema, async (requestHeader, request) => {
 *     const service = container.resolve(CompanyService);
 *     return await service.create(requestHeader, request);
 *   });
 * });
 * ```
 */
export async function handleApiRequest<TRequest, TResponse>(
  c: Context,
  requestSchema: z.ZodSchema<TRequest>,
  handler: (requestHeader: RequestHeader, request: TRequest) => Promise<TResponse>
): Promise<Response> {
  // Extract RequestHeader
  const requestHeader = getRequestHeader(c);

  // Parse and validate request
  const body = await c.req.json();
  const validatedRequest = requestSchema.parse(body);

  // Execute handler
  const result = await handler(requestHeader, validatedRequest);

  // Return standardized response
  return c.json<ApiResponse<TResponse>>({
    success: true,
    data: result,
  });
}

/**
 * Standard API handler helper with custom status code
 */
export async function handleApiRequestWithStatus<TRequest, TResponse>(
  c: Context,
  requestSchema: z.ZodSchema<TRequest>,
  statusCode: ContentfulStatusCode,
  handler: (requestHeader: RequestHeader, request: TRequest) => Promise<TResponse>
): Promise<Response> {
  const requestHeader = getRequestHeader(c);
  const body = await c.req.json();
  const validatedRequest = requestSchema.parse(body);
  const result = await handler(requestHeader, validatedRequest);

  return c.json<ApiResponse<TResponse>>(
    {
      success: true,
      data: result,
    },
    statusCode
  );
}

/**
 * Standard GET handler helper (no request body)
 */
export async function handleGetRequest<TResponse>(
  c: Context,
  handler: (requestHeader: RequestHeader) => Promise<TResponse>
): Promise<Response> {
  const requestHeader = getRequestHeader(c);
  const result = await handler(requestHeader);
  
  return c.json<ApiResponse<TResponse>>({
    success: true,
    data: result,
  });
}

/**
 * Standard GET handler with path parameters
 */
export async function handleGetRequestWithParams<TParams, TResponse>(
  c: Context,
  paramsSchema: z.ZodSchema<TParams>,
  handler: (requestHeader: RequestHeader, params: TParams) => Promise<TResponse>
): Promise<Response> {
  const requestHeader = getRequestHeader(c);
  const params = paramsSchema.parse(c.req.param());
  const result = await handler(requestHeader, params);
  
  return c.json<ApiResponse<TResponse>>({
    success: true,
    data: result,
  });
}

/**
 * Standard PATCH/PUT handler with path parameters and request body
 */
export async function handleApiRequestWithParams<TParams, TRequest, TResponse>(
  c: Context,
  paramsSchema: z.ZodSchema<TParams>,
  requestSchema: z.ZodSchema<TRequest>,
  handler: (requestHeader: RequestHeader, params: TParams, request: TRequest) => Promise<TResponse>
): Promise<Response> {
  const requestHeader = getRequestHeader(c);
  const params = paramsSchema.parse(c.req.param());
  const body = await c.req.json();
  const validatedRequest = requestSchema.parse(body);
  const result = await handler(requestHeader, params, validatedRequest);
  
  return c.json<ApiResponse<TResponse>>({
    success: true,
    data: result,
  });
}
