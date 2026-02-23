import { Hono } from 'hono';
import { z } from 'zod';
import { setCookie, deleteCookie } from 'hono/cookie';
import { container } from 'tsyringe';
import { UnauthorizedError, ValidationError } from '@crm/shared';
import { requestHeaderMiddleware } from '../middleware/requestHeader';
import { createSessionToken, getSessionDurationSeconds } from './session';
import { UserRepository } from '../users/repository';
import { getRequestHeader } from '../utils/request-header';
import { getEnv } from '../env';
import type { ApiResponse } from '@crm/shared';

export const authRoutes = new Hono();

// Cookie name for session
const SESSION_COOKIE = 'session';

/**
 * Login request schema
 */
const loginRequestSchema = z.object({
  email: z.email(),
  tenantId: z.uuid(),
});

/**
 * POST /api/auth/login - Login and get session
 *
 * For development/testing. In production, use Google SSO callback.
 * Sets httpOnly cookie for browser, returns token for API clients.
 */
authRoutes.post('/login', async (c) => {
  const body = await c.req.json();
  const request = loginRequestSchema.parse(body);

  const userRepository = container.resolve(UserRepository);
  const user = await userRepository.findByEmail(request.tenantId, request.email);

  if (!user) {
    throw new UnauthorizedError('User not found');
  }

  // Check if user is active
  if (user.rowStatus !== 0) {
    throw new UnauthorizedError('Account is inactive');
  }

  // Create session token
  const token = createSessionToken({
    userId: user.id,
    tenantId: user.tenantId,
    email: user.email,
  });

  // Set httpOnly cookie for browser
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: getEnv().NODE_ENV === 'production',
    sameSite: 'Lax',
    maxAge: getSessionDurationSeconds(),
    path: '/',
  });

  return c.json<ApiResponse<{
    token: string;
    user: {
      id: string;
      email: string;
      firstName: string;
      lastName: string;
      tenantId: string;
    };
  }>>({
    success: true,
    data: {
      token, // For Postman/API clients
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        tenantId: user.tenantId,
      },
    },
  });
});

/**
 * POST /api/auth/logout - Logout and clear session
 */
authRoutes.post('/logout', async (c) => {
  deleteCookie(c, SESSION_COOKIE, { path: '/' });

  return c.json<ApiResponse<{ success: boolean }>>({
    success: true,
    data: { success: true },
  });
});

/**
 * Test token request schema - userId and tenantId are required
 */
const testTokenRequestSchema = z.object({
  userId: z.uuid(),
  tenantId: z.uuid(),
  email: z.email().optional(),
});

/**
 * POST /api/auth/test-token - Generate an indefinite test session token
 *
 * For Postman testing. Generates indefinite tokens without requiring user lookup.
 * Requires X-API-Key header for security.
 *
 * Headers:
 *   X-API-Key: <TEST_TOKEN_API_KEY from environment>
 *
 * Body:
 *   userId: string (required)
 *   tenantId: string (required)
 *   email: string (optional)
 */
authRoutes.post('/test-token', async (c) => {
  // Verify API key is configured
  const testTokenApiKey = getEnv().TEST_TOKEN_API_KEY;
  if (!testTokenApiKey) {
    throw new ValidationError('TEST_TOKEN_API_KEY environment variable is not configured');
  }

  // Verify API key matches
  const apiKey = c.req.header('x-api-key');
  if (!apiKey || apiKey !== testTokenApiKey) {
    throw new UnauthorizedError('Invalid or missing X-API-Key');
  }

  const body = await c.req.json();
  const request = testTokenRequestSchema.parse(body);

  const email = request.email ?? 'test@example.com';

  // Create indefinite token (never expires)
  const token = createSessionToken({
    userId: request.userId,
    tenantId: request.tenantId,
    email,
    indefinite: true,
  });

  return c.json<ApiResponse<{
    token: string;
    payload: {
      userId: string;
      tenantId: string;
      email: string;
    };
  }>>({
    success: true,
    data: {
      token, // Use this in Postman Authorization header
      payload: {
        userId: request.userId,
        tenantId: request.tenantId,
        email,
      },
    },
  });
});

/**
 * GET /api/auth/me - Get current user info from session
 *
 * Requires authentication (session cookie or Authorization header)
 */
authRoutes.get('/me', requestHeaderMiddleware, async (c) => {
  const requestHeader = getRequestHeader(c);

  const userRepository = container.resolve(UserRepository);
  const user = await userRepository.findById(requestHeader.userId);

  if (!user) {
    throw new UnauthorizedError('User not found');
  }

  return c.json<ApiResponse<typeof user>>({
    success: true,
    data: user,
  });
});
