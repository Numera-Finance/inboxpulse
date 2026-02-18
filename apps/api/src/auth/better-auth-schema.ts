import {
  pgTable,
  text,
  timestamp,
  boolean,
  uuid,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { tenants } from '../tenants/schema';

/**
 * Better-Auth User Table
 * Stores authentication data (managed by better-auth)
 * Custom field: tenantId for fast tenant lookup in middleware
 */
export const betterAuthUser = pgTable(
  'better_auth_user',
  {
    id: text('id').primaryKey(),
    email: text('email').notNull(),
    emailVerified: boolean('email_verified').notNull().default(false),
    name: text('name'),
    image: text('image'),
    tenantId: uuid('tenant_id').references(() => tenants.id), // Custom field: Store tenantId for fast lookup
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('idx_better_auth_user_email').on(table.email),
    index('idx_better_auth_user_tenant_id').on(table.tenantId),
  ]
);

/**
 * Better-Auth Session Table
 * Stores active sessions (managed by better-auth)
 */
export const betterAuthSession = pgTable(
  'better_auth_session',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => betterAuthUser.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    token: text('token').notNull().unique(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('idx_better_auth_session_user_id').on(table.userId),
    uniqueIndex('idx_better_auth_session_token').on(table.token),
    index('idx_better_auth_session_expires_at').on(table.expiresAt),
  ]
);

/**
 * Better-Auth Account Table (Google OAuth)
 * Stores OAuth account information
 */
export const betterAuthAccount = pgTable(
  'better_auth_account',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => betterAuthUser.id, { onDelete: 'cascade' }),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull().default('google'),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
    scope: text('scope'),
    idToken: text('id_token'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('idx_better_auth_account_user_id').on(table.userId),
    uniqueIndex('idx_better_auth_account_provider').on(
      table.providerId,
      table.accountId
    ),
  ]
);

/**
 * Better-Auth Verification Table
 * Stores email verification tokens, password reset tokens, etc.
 */
export const betterAuthVerification = pgTable(
  'better_auth_verification',
  {
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('idx_better_auth_verification_identifier_value').on(
      table.identifier,
      table.value
    ),
    index('idx_better_auth_verification_expires_at').on(table.expiresAt),
  ]
);
