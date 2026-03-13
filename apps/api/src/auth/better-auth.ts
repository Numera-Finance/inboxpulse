import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { customSession } from 'better-auth/plugins';
import { arrayContains, eq, sql } from 'drizzle-orm';
import { container } from 'tsyringe';
import type { Database } from '@crm/database';
import {
  betterAuthUser,
  betterAuthSession,
  betterAuthAccount,
  betterAuthVerification,
} from './better-auth-schema';
import { tenants } from '../tenants/schema';
import { users } from '../users/schema';
import { BetterAuthUserService } from './better-auth-user-service';
import { logger } from '../utils/logger';
import { getEnv } from '../env';

// Lazy getter for database instance from DI container
// This allows better-auth to be imported before container is initialized
function getDb(): Database {
  try {
    return container.resolve<Database>('Database');
  } catch (error) {
    throw new Error('Database not initialized. Make sure setupContainer() is called before using better-auth.');
  }
}

// Lazy initialization - auth instance is created when first accessed
let authInstance: ReturnType<typeof betterAuth> | null = null;

function getAuth() {
  if (!authInstance) {
    const db = getDb();
    authInstance = betterAuth({
      database: drizzleAdapter(db, {
        provider: 'pg', // PostgreSQL provider
        schema: {
          user: betterAuthUser,
          session: betterAuthSession,
          account: betterAuthAccount,
          verification: betterAuthVerification,
        },
      }),
      user: {
        // Additional fields for TypeScript type inference only
        // Actual runtime data comes from customSession plugin
        additionalFields: {
          tenantId: {
            type: 'string',
            required: false,
          },
        },
      },
      emailAndPassword: {
        enabled: false, // Google SSO only
      },
      socialProviders: {
        // Only enable Google if credentials are provided
        ...(getEnv().GOOGLE_CLIENT_ID && getEnv().GOOGLE_CLIENT_SECRET
          ? {
              google: {
                clientId: getEnv().GOOGLE_CLIENT_ID,
                clientSecret: getEnv().GOOGLE_CLIENT_SECRET,
                // Scopes are optional - better-auth uses defaults if not specified
                // scope: [
                //   'openid',
                //   'https://www.googleapis.com/auth/userinfo.email',
                //   'https://www.googleapis.com/auth/userinfo.profile',
                // ],
              },
            }
          : {}),
      },
      session: {
        expiresIn: 30 * 60, // 30 minutes (matches current system)
        updateAge: 5 * 60,  // Update every 5 minutes (sliding window, matches current)
        cookieCache: {
          enabled: false, // Disabled to ensure tenant_id is read from DB after updates
        },
      },
      baseURL: getEnv().BETTER_AUTH_URL, // API runs on 4001
      basePath: '/api/auth', // Better-auth will handle routes under this path
      trustedOrigins: [
        getEnv().WEB_URL, // Web app runs on 4000
        getEnv().SERVICE_API_URL, // API runs on 4001
      ].filter(Boolean),
      secret: getEnv().BETTER_AUTH_SECRET || getEnv().SESSION_SECRET || 'dev-secret-change-in-production-minimum-32-characters',
      advanced: {
        // Enable cross-origin cookies for separate API/Web domains
        useSecureCookies: getEnv().NODE_ENV === 'production',
        defaultCookieAttributes: {
          sameSite: 'none' as const, // Required for cross-origin
          secure: true, // Required when sameSite is 'none'
          httpOnly: true,
          path: '/',
        },
      },
      plugins: [
        // customSession plugin to include tenantId in getSession response
        // Also ensures user is linked to our users table (handles edge cases where create hook didn't complete)
        // This is required because additionalFields.returned only affects types, not runtime
        // See: https://github.com/better-auth/better-auth/issues/3888
        customSession(async ({ user, session }) => {
          // Fetch the user's tenantId from the database
          const dbUser = await db
            .select({ tenantId: betterAuthUser.tenantId })
            .from(betterAuthUser)
            .where(eq(betterAuthUser.id, user.id))
            .limit(1);

          let tenantId = dbUser[0]?.tenantId || null;

          // If tenantId is not set, try to link the user now
          // This handles the case where the create hook didn't complete
          if (!tenantId && user.email) {
            try {
              const betterAuthUserService = container.resolve(BetterAuthUserService);
              const result = await betterAuthUserService.linkBetterAuthUser(
                user.id,
                user.email,
                user.name || null,
                '' // No account ID available here
              );
              tenantId = result.tenantId;
              logger.info(
                { betterAuthUserId: user.id, email: user.email, tenantId },
                'Linked user during session access (recovery from incomplete signup)'
              );
            } catch (error: any) {
              logger.error(
                { error: error.message, betterAuthUserId: user.id, email: user.email },
                'Failed to link user during session access'
              );
            }
          }

          return {
            user: {
              ...user,
              tenantId,
            },
            session,
          };
        }),
      ],
      databaseHooks: {
        session: {
          create: {
            // Update lastLoginAt when a new session is created (user logs in)
            after: async (session: any) => {
              try {
                // Get the user's email from better-auth user table
                const betterAuthUserRecord = await db
                  .select({ email: betterAuthUser.email })
                  .from(betterAuthUser)
                  .where(eq(betterAuthUser.id, session.userId))
                  .limit(1);

                if (betterAuthUserRecord[0]?.email) {
                  // Update lastLoginAt in our users table
                  await db
                    .update(users)
                    .set({ lastLoginAt: sql`CURRENT_TIMESTAMP` })
                    .where(eq(users.email, betterAuthUserRecord[0].email));

                  logger.info(
                    { email: betterAuthUserRecord[0].email, sessionId: session.id },
                    'Updated lastLoginAt for user'
                  );
                }
              } catch (error: any) {
                // Log but don't fail session creation
                logger.error(
                  { error: error.message, sessionUserId: session.userId },
                  'Failed to update lastLoginAt'
                );
              }
            },
          },
        },
        user: {
          create: {
            // Validate domain BEFORE user creation - reject if no matching tenant
            before: async (user: any) => {
              const email = user.email;
              if (!email) {
                throw new Error('Email is required for authentication');
              }

              const emailDomain = email.split('@')[1]?.toLowerCase();
              if (!emailDomain) {
                throw new Error('Invalid email format');
              }

              // Check if any tenant has this domain
              const matchingTenant = await db
                .select()
                .from(tenants)
                .where(arrayContains(tenants.domains, [emailDomain]))
                .limit(1);

              if (!matchingTenant[0]) {
                logger.error(
                  { email, emailDomain },
                  'SSO login rejected - no tenant found with matching domain'
                );
                throw new Error(
                  `Your organization (${emailDomain}) is not registered in this system. ` +
                  `Please contact support if you believe this is an error.`
                );
              }

              logger.info(
                { email, emailDomain, tenantId: matchingTenant[0].id },
                'Domain validated for SSO - tenant found'
              );
            },
            // After user created, link to our users table and set tenantId
            after: async (user: any, context: any) => {
              const account = context?.account;

              if (user.email && getEnv().GOOGLE_CLIENT_ID) {
                try {
                  const betterAuthUserService = container.resolve(BetterAuthUserService);

                  await betterAuthUserService.linkBetterAuthUser(
                    user.id,
                    user.email,
                    user.name || null,
                    account?.accountId || ''
                  );

                  logger.info(
                    { betterAuthUserId: user.id, email: user.email },
                    'Created and linked user after SSO'
                  );
                } catch (error: any) {
                  logger.error(
                    { error: error.message, betterAuthUserId: user.id, email: user.email },
                    'Failed to link user after SSO'
                  );
                  // This error should bubble up - linking is critical
                  throw error;
                }
              }
            },
          },
        },
      },
    });
  }
  return authInstance;
}

// Export auth getter (lazy initialization)
export const auth = new Proxy({} as ReturnType<typeof betterAuth>, {
  get(_target, prop) {
    const authInstance = getAuth();
    const value = authInstance[prop as keyof ReturnType<typeof betterAuth>];
    
    // Debug: Log when handler is accessed
    if (prop === 'handler') {
      console.log('[Better-Auth Proxy] handler accessed, type:', typeof value);
    }
    
    return value;
  },
});
