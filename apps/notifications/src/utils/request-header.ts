import { Context } from 'hono';
import type { RequestHeader } from '@crm/shared';

/**
 * Extract RequestHeader from Hono context
 * Throws error if RequestHeader middleware not applied
 */
export function getRequestHeader(c: Context): RequestHeader {
  const requestHeader = c.get('requestHeader') as RequestHeader | undefined;

  if (!requestHeader) {
    throw new Error(
      'RequestHeader not found in context. Ensure requestHeaderMiddleware is applied.'
    );
  }

  return requestHeader;
}
