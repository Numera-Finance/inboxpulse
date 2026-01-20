/**
 * Internal fetch utility for service-to-service calls
 *
 * Automatically includes the internal API key header for authenticated
 * calls to internal services (gmail, notifications, etc.)
 *
 * Uses SERVICE_API_KEY env var and x-internal-api-key header from @crm/shared.
 */

import { logger } from './logger';
import { getServiceAuthHeaders } from '@crm/shared';

/**
 * Make an internal service call with API key authentication
 */
export async function internalFetch(
  url: string,
  options: RequestInit = {}
): Promise<Response> {
  const serviceHeaders = getServiceAuthHeaders();

  if (Object.keys(serviceHeaders).length === 0) {
    logger.warn({ url }, 'SERVICE_API_KEY not set - internal service call may fail');
  }

  const headers = new Headers(options.headers);
  headers.set('Content-Type', 'application/json');

  // Add service auth headers
  for (const [key, value] of Object.entries(serviceHeaders)) {
    headers.set(key, value);
  }

  return fetch(url, {
    ...options,
    headers,
  });
}
