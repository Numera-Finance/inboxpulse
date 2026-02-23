import { createHmac, timingSafeEqual } from 'crypto';
import { UnauthorizedError } from '@crm/shared';
import { getEnv } from '../env';

// Lazy getter for SESSION_SECRET to allow dotenv to load first
function getSessionSecret(): string {
  const secret = getEnv().SESSION_SECRET;
  if (!secret) {
    throw new Error('SESSION_SECRET environment variable is required');
  }
  return secret;
}

function getSessionDurationMs(): number {
  return getEnv().SESSION_DURATION_MS;
}

export interface SessionPayload {
  userId: string;
  tenantId: string;
  email?: string;
  expiresAt: number; // Unix timestamp in ms
}

// 100 years in milliseconds (for indefinite tokens)
const INDEFINITE_DURATION_MS = 100 * 365 * 24 * 60 * 60 * 1000;

/**
 * Create a signed session token
 */
export function createSessionToken(payload: {
  userId: string;
  tenantId: string;
  email?: string;
  indefinite?: boolean;
}): string {
  const duration = payload.indefinite ? INDEFINITE_DURATION_MS : getSessionDurationMs();
  const sessionPayload: SessionPayload = {
    userId: payload.userId,
    tenantId: payload.tenantId,
    email: payload.email,
    expiresAt: Date.now() + duration,
  };

  const data = Buffer.from(JSON.stringify(sessionPayload)).toString('base64url');
  const signature = sign(data);

  return `${data}.${signature}`;
}

/**
 * Verify and decode a session token
 * Returns the payload if valid, throws UnauthorizedError if invalid
 */
export function verifySessionToken(token: string): SessionPayload {
  const parts = token.split('.');
  if (parts.length !== 2) {
    throw new UnauthorizedError('Invalid session token format');
  }

  const [data, signature] = parts;

  // Verify signature
  const expectedSignature = sign(data);
  if (!timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))) {
    throw new UnauthorizedError('Invalid session token signature');
  }

  // Decode payload
  let payload: SessionPayload;
  try {
    payload = JSON.parse(Buffer.from(data, 'base64url').toString());
  } catch {
    throw new UnauthorizedError('Invalid session token payload');
  }

  // Check expiration
  if (payload.expiresAt < Date.now()) {
    throw new UnauthorizedError('Session has expired');
  }

  // Validate required fields
  if (!payload.userId || !payload.tenantId) {
    throw new UnauthorizedError('Session missing required fields');
  }

  return payload;
}

/**
 * Create a refreshed session token (extends expiration)
 */
export function refreshSessionToken(payload: SessionPayload): string {
  return createSessionToken({
    userId: payload.userId,
    tenantId: payload.tenantId,
    email: payload.email,
  });
}

/**
 * Check if session is close to expiring (less than 5 minutes left)
 */
export function shouldRefreshSession(payload: SessionPayload): boolean {
  const fiveMinutes = 5 * 60 * 1000;
  return payload.expiresAt - Date.now() < fiveMinutes;
}

/**
 * Get session duration in seconds (for cookie maxAge)
 */
export function getSessionDurationSeconds(): number {
  return getSessionDurationMs() / 1000;
}

/**
 * HMAC-SHA256 signature
 */
function sign(data: string): string {
  return createHmac('sha256', getSessionSecret()).update(data).digest('base64url');
}
