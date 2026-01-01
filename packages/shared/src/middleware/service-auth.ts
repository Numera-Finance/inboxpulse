import type { Context, Next } from 'hono';

/**
 * Middleware for service-to-service authentication
 *
 * Used to protect internal API endpoints that are called by other services
 * (e.g., Notifications service calling API service, or API calling Notifications).
 *
 * Requires the `x-service-api-key` header to match the SERVICE_API_KEY env var.
 *
 * Usage:
 *   app.get('/internal/endpoint', requireServiceAuth(), async (c) => { ... })
 */
export function requireServiceAuth() {
  return async (c: Context, next: Next) => {
    const serviceApiKey = c.req.header('x-service-api-key');
    const expectedKey = process.env.SERVICE_API_KEY;

    if (!expectedKey) {
      // If SERVICE_API_KEY is not configured, reject all requests
      // This prevents accidental exposure of internal endpoints
      return c.json(
        { success: false, error: 'Service authentication not configured' },
        500
      );
    }

    if (!serviceApiKey) {
      return c.json(
        { success: false, error: 'Missing service API key' },
        401
      );
    }

    if (serviceApiKey !== expectedKey) {
      return c.json(
        { success: false, error: 'Invalid service API key' },
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
  const serviceApiKey = c.req.header('x-service-api-key');
  const expectedKey = process.env.SERVICE_API_KEY;

  if (!expectedKey || !serviceApiKey) {
    return false;
  }

  return serviceApiKey === expectedKey;
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
  const serviceApiKey = process.env.SERVICE_API_KEY;

  if (!serviceApiKey) {
    console.warn('SERVICE_API_KEY not configured for service-to-service calls');
    return {};
  }

  return {
    'x-service-api-key': serviceApiKey,
  };
}
