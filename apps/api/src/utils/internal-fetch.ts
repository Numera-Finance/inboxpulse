/**
 * Internal fetch utility for service-to-service calls
 *
 * Automatically includes:
 * - x-internal-api-key header for app-level auth
 * - GCP OIDC identity token for Cloud Run auth (in production)
 *
 * Uses SERVICE_API_KEY env var and x-internal-api-key header from @crm/shared.
 */

import { google } from 'googleapis';
import { logger } from './logger';
import { getServiceAuthHeaders } from '@crm/shared';

const auth = new google.auth.GoogleAuth();

/**
 * Get a GCP OIDC identity token for the target URL.
 * Returns null in local dev (where metadata server is unavailable).
 */
async function getIdToken(targetUrl: string): Promise<string | null> {
  try {
    const client = await auth.getIdTokenClient(targetUrl);
    const requestHeaders = await client.getRequestHeaders();
    return requestHeaders.get('Authorization') ?? null;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logger.debug({ targetUrl, error: message }, 'Could not get ID token - likely local dev');
    return null;
  }
}

/**
 * Make an internal service call with API key + Cloud Run OIDC authentication
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

  // Add service auth headers (x-internal-api-key)
  for (const [key, value] of Object.entries(serviceHeaders)) {
    headers.set(key, value);
  }

  // Add GCP OIDC identity token for Cloud Run authentication
  const idToken = await getIdToken(url);
  if (idToken) {
    headers.set('Authorization', idToken);
  }

  return fetch(url, {
    ...options,
    headers,
  });
}
