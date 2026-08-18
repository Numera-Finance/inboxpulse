import type { Context, Next } from 'hono';
import type { ApiResponse, RequestHeader } from '../types';
import { ErrorCode } from '../errors/types';
import { ALL_PERMISSIONS } from '../types/rbac';

/**
 * Refusals in the documented envelope.
 *
 * These three responses used to send `error` as a bare string, which type-checks
 * against nothing and parses as nothing: `ApiResponse.error` is a
 * `StructuredError`, so a caller reading `error.message` got `undefined` and a
 * caller reading `error.code` got `undefined` too. The add-on's own
 * `safeErrorDetail` reads exactly those fields, so a mis-keyed service call was
 * logged as "json body, no error object" — the reason for the refusal was
 * present in the response and thrown away by the client that needed it.
 *
 * Typed as `ApiResponse<never>` rather than assembled inline so the compiler
 * refuses the next bare string.
 */
const refuse = (code: ErrorCode, message: string, statusCode: number): ApiResponse<never> => ({
  success: false,
  error: { code, message, statusCode },
});

/**
 * Internal API key header name
 * Used for service-to-service authentication
 */
export const INTERNAL_API_KEY_HEADER = 'x-internal-api-key';

/**
 * Middleware for service-to-service authentication
 *
 * Used to protect internal API endpoints that are called by other services
 * (e.g., Notifications service calling API service, or API calling Notifications).
 *
 * Requires the `x-internal-api-key` header to match the INTERNAL_API_KEY env var.
 *
 * Usage:
 *   app.get('/internal/endpoint', requireServiceAuth(), async (c) => { ... })
 */
export function requireServiceAuth() {
  return async (c: Context, next: Next) => {
    const apiKey = c.req.header(INTERNAL_API_KEY_HEADER);
    const expectedKey = process.env.SERVICE_API_KEY;

    if (!expectedKey) {
      // If SERVICE_API_KEY is not configured, reject all requests
      // This prevents accidental exposure of internal endpoints
      return c.json(
        refuse(ErrorCode.INTERNAL_ERROR, 'Service authentication not configured', 500),
        500
      );
    }

    if (!apiKey) {
      return c.json(
        refuse(ErrorCode.UNAUTHORIZED, 'Missing internal API key', 401),
        401
      );
    }

    if (apiKey !== expectedKey) {
      return c.json(
        refuse(ErrorCode.UNAUTHORIZED, 'Invalid internal API key', 401),
        401
      );
    }

    await next();
  };
}

/**
 * Check if request has valid service auth (for inline checks)
 *
 * Usage in route handler:
 *   if (hasServiceAuth(c)) {
 *     // request is from an internal service
 *   }
 */
export function hasServiceAuth(c: Context): boolean {
  const apiKey = c.req.header(INTERNAL_API_KEY_HEADER);
  const expectedKey = process.env.SERVICE_API_KEY;

  if (!expectedKey || !apiKey) {
    return false;
  }

  return apiKey === expectedKey;
}

/**
 * Middleware for authenticating internal service-to-service calls on /api/internal/* routes.
 *
 * Validates x-internal-api-key header against SERVICE_API_KEY env var (simple string comparison).
 * When x-tenant-id and x-user-id headers are present, constructs a requestHeader with
 * ADMIN permissions so requirePermission() checks pass naturally for internal calls.
 *
 * Usage:
 *   app.use('/api/internal/*', requireInternalAuth())
 */
export function requireInternalAuth() {
  return async (c: Context, next: Next) => {
    const apiKey = c.req.header(INTERNAL_API_KEY_HEADER);
    const expectedKey = process.env.SERVICE_API_KEY;

    if (!expectedKey) {
      return c.json(
        refuse(ErrorCode.INTERNAL_ERROR, 'Service authentication not configured', 500),
        500
      );
    }

    if (!apiKey) {
      return c.json(
        refuse(ErrorCode.UNAUTHORIZED, 'Missing internal API key', 401),
        401
      );
    }

    if (apiKey !== expectedKey) {
      return c.json(
        refuse(ErrorCode.UNAUTHORIZED, 'Invalid internal API key', 401),
        401
      );
    }

    c.set('isInternalCall', true);

    // Construct requestHeader from tenant/user headers if provided
    const tenantId = c.req.header('x-tenant-id');
    const userId = c.req.header('x-user-id');

    if (tenantId) {
      const requestHeader: RequestHeader = {
        tenantId,
        userId: userId || 'internal-service',
        permissions: [...ALL_PERMISSIONS],
      };
      c.set('requestHeader', requestHeader);
    }

    await next();
  };
}

/**
 * Get headers for making service-to-service calls
 *
 * Usage:
 *   const response = await fetch(url, {
 *     headers: {
 *       ...getServiceAuthHeaders(),
 *       'x-tenant-id': tenantId,
 *     },
 *   });
 */
export function getServiceAuthHeaders(): Record<string, string> {
  const apiKey = process.env.SERVICE_API_KEY;

  if (!apiKey) {
    console.warn('SERVICE_API_KEY not configured for service-to-service calls');
    return {};
  }

  return {
    [INTERNAL_API_KEY_HEADER]: apiKey,
  };
}
