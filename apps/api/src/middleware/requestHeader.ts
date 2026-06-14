import { Context, Next } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import { UnauthorizedError } from '@crm/shared';
import type { RequestHeader } from '@crm/shared';
import {
  verifySessionToken,
  refreshSessionToken,
  shouldRefreshSession,
  getSessionDurationSeconds,
} from '../auth/session';
import { getEnv } from '../env';

// Import middleware chain components
import { betterAuthSessionMiddleware } from './better-auth-session';
import { tenantResolutionMiddleware } from './tenant-resolution';
import { userContextMiddleware } from './user-context';

// Re-export middleware chain for backward compatibility
export { betterAuthSessionMiddleware } from './better-auth-session';
export { tenantResolutionMiddleware } from './tenant-resolution';
export { userContextMiddleware } from './user-context';

// Cookie name for session (legacy custom session system)
const SESSION_COOKIE = 'session';

/**
 * Legacy requestHeaderMiddleware - uses custom HMAC-signed sessions
 * ⚠️ This is kept for backward compatibility with dev/testing routes
 * 
 * For better-auth, use the middleware chain:
 * - betterAuthSessionMiddleware
 * - tenantResolutionMiddleware  
 * - userContextMiddleware
 */
export async function requestHeaderMiddleware(c: Context, next: Next) {
  // Try to get session token from cookie or Authorization header
  let token: string | undefined;

  // 1. Check Authorization header (for Postman/API clients)
  const authHeader = c.req.header('Authorization');
  if (authHeader?.startsWith('Bearer ')) {
    token = authHeader.substring(7);
  }

  // 2. Check cookie (for browser)
  if (!token) {
    token = getCookie(c, SESSION_COOKIE);
  }

  // 3. No token found
  if (!token) {
    throw new UnauthorizedError('Authentication required');
  }

  // Verify session token
  const session = verifySessionToken(token);

  // Create RequestHeader from session
  // Note: Legacy auth doesn't have role info, so permissions is empty
  // This is for backward compatibility during migration to better-auth
  const requestHeader: RequestHeader = {
    tenantId: session.tenantId,
    userId: session.userId,
    permissions: [], // Legacy auth doesn't have role permissions
  };
  c.set('requestHeader', requestHeader);
  c.set('session', session);

  // Auto-refresh session if close to expiring (sliding window)
  if (shouldRefreshSession(session)) {
    const newToken = refreshSessionToken(session);

    // Set refreshed cookie for browser
    setCookie(c, SESSION_COOKIE, newToken, {
      httpOnly: true,
      secure: getEnv().NODE_ENV === 'production',
      sameSite: 'Lax',
      maxAge: getSessionDurationSeconds(),
      path: '/',
    });

    // Set header for API clients to capture new token
    c.header('X-Session-Refreshed', newToken);
  }

  await next();
}

/**
 * Combined middleware chain for better-auth (recommended)
 * Chains: betterAuthSessionMiddleware → tenantResolutionMiddleware → userContextMiddleware
 *
 * For internal service-to-service calls, use /api/internal/* routes instead
 * (protected by requireInternalAuth middleware).
 */
export async function betterAuthRequestHeaderMiddleware(c: Context, next: Next) {
  await betterAuthSessionMiddleware(c, async () => {
    await tenantResolutionMiddleware(c, async () => {
      await userContextMiddleware(c, next);
    });
  });
}
