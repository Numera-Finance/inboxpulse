import { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { z } from 'zod';
import type { RequestHeader, ApiResponse } from '@crm/shared';
import { getRequestHeader } from './request-header';

/**
 * Standard API handler helper
 */
export async function handleApiRequest<TRequest, TResponse>(
  c: Context,
  requestSchema: z.ZodSchema<TRequest>,
  handler: (requestHeader: RequestHeader, request: TRequest) => Promise<TResponse>
): Promise<Response> {
  const requestHeader = getRequestHeader(c);
  const body = await c.req.json();
  const validatedRequest = requestSchema.parse(body);
  const result = await handler(requestHeader, validatedRequest);

  return c.json<ApiResponse<TResponse>>({
    success: true,
    data: result,
  });
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
