import { Context, Next } from 'hono';
import { UnauthorizedError } from '@crm/shared';
import { container } from 'tsyringe';
import { eq } from 'drizzle-orm';
import type { Database } from '@crm/database';
import { BetterAuthUserService } from '../auth/better-auth-user-service';
import { users } from '../users/schema';
import { logger } from '../utils/logger';
import { getEnv } from '../env';

/**
 * Step 2: Resolve tenant from session
 *
 * Uses tenant_id from better_auth_user if already set (fast path).
 * Falls back to domain resolution only if tenant_id is not set (first login recovery).
 */
export async function tenantResolutionMiddleware(c: Context, next: Next) {
  const session = c.get('betterAuthSession');

  if (!session) {
    // ⚠️ SECURITY: Explicit production check to prevent accidental dev auth in production
    const allowDevAuth = getEnv().ALLOW_DEV_AUTH === 'true';


    // Production: Never allow dev auth
    throw new UnauthorizedError('Authentication required');
  }

  const email = session.user.email;
  const betterAuthUserId = session.user.id;
  const sessionTenantId = session.user.tenantId; // From customSession plugin

  if (!email) {
    throw new UnauthorizedError('Session missing email');
  }

  try {
    // Fast path: If tenant_id is already set in session, use it directly
    // This avoids re-resolving tenant from domain on every request
    if (sessionTenantId) {
      // Look up the user in users table by email
      const db = container.resolve<Database>('Database');
      const existingUser = await db
        .select()
        .from(users)
        .where(eq(users.email, email))
        .limit(1);

      if (existingUser[0]) {
        // Verify tenant matches (security check)
        if (existingUser[0].tenantId !== sessionTenantId) {
          logger.error(
            { email, userTenantId: existingUser[0].tenantId, sessionTenantId },
            'Tenant mismatch between user and session'
          );
          throw new UnauthorizedError('Account configuration error. Please contact support.');
        }

        c.set('tenantId', sessionTenantId);
        c.set('userId', existingUser[0].id);
        c.set('email', email);
        await next();
        return;
      }
      // User doesn't exist yet, fall through to linkBetterAuthUser
    }

    // Slow path: Resolve tenant from domain and link user
    // This only runs if tenant_id is not set or user doesn't exist
    const betterAuthUserService = container.resolve(BetterAuthUserService);
    const result = await betterAuthUserService.linkBetterAuthUser(
      betterAuthUserId,
      email,
      session.user.name || null,
      ''
    );

    c.set('tenantId', result.tenantId);
    c.set('userId', result.userId);
    c.set('email', email);
    await next();
  } catch (error: any) {
    logger.error(
      { betterAuthUserId, email, error: error.message },
      'Tenant resolution failed'
    );
    throw new UnauthorizedError(error.message || 'Authentication failed. Please contact support.');
  }
}
