import type { Context, Next } from 'hono';
import type { RequestHeader } from '../types';
import { ALL_PERMISSIONS } from '../types/rbac';

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
        { success: false, error: 'Service authentication not configured' },
        500
      );
    }

    if (!apiKey) {
      return c.json(
        { success: false, error: 'Missing internal API key' },
        401
      );
    }

    if (apiKey !== expectedKey) {
      return c.json(
        { success: false, error: 'Invalid internal API key' },
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
        { success: false, error: 'Service authentication not configured' },
        500
      );
    }

    if (!apiKey) {
      return c.json(
        { success: false, error: 'Missing internal API key' },
        401
      );
    }

    if (apiKey !== expectedKey) {
      return c.json(
        { success: false, error: 'Invalid internal API key' },
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
