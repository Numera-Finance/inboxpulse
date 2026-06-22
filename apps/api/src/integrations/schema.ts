import { pgTable, text, timestamp, uuid, boolean, pgEnum, jsonb } from 'drizzle-orm/pg-core';
import { v7 as uuidv7 } from 'uuid';
import { z } from 'zod';

export const integrationSourceEnum = pgEnum('integration_source', [
  'gmail',
  'outlook',
  'slack',
  'other',
]);

export const integrationAuthTypeEnum = pgEnum('integration_auth_type', [
  'oauth',
  'service_account',
  'api_key',
]);

export const integrationParametersSchema = z.array(
  z.object({
    key: z.string(),
    value: z.any(), // Can be string, array, object, number, boolean
  })
);

export type IntegrationParameters = z.infer<typeof integrationParametersSchema>;

export const integrations = pgTable('integrations', {
  id: uuid('id').primaryKey().$defaultFn(() => uuidv7()),
  tenantId: uuid('tenant_id').notNull(),

  source: integrationSourceEnum('source').notNull(),
  authType: integrationAuthTypeEnum('auth_type').notNull(),

  // Static configuration (email, client_id, client_secret, etc.)
  // GIN index for JSONB containment lookups (WHERE parameters @> '[{"key":"email",...}]'),
  // used by IntegrationRepository.findByEmail / findIdByEmail.
  // Note: Drizzle doesn't support GIN indexes directly, add via SQL migration (012).
  parameters: jsonb('parameters').$type<IntegrationParameters>().notNull(),

  // OAuth tokens (if auth_type = 'oauth')
  accessToken: text('access_token'), // Short-lived access token (1 hour for Gmail)
  refreshToken: text('refresh_token'), // Long-lived refresh token (use to get new access tokens)
  accessTokenExpiresAt: timestamp('access_token_expires_at'), // When access token expires

  // Legacy field for backward compatibility - now stores refresh_token
  token: text('token'),
  // Legacy field for backward compatibility - now stores access_token expiration
  tokenExpiresAt: timestamp('token_expires_at'),

  // Gmail Watch tracking (for push notifications)
  watchSetAt: timestamp('watch_set_at'), // When Gmail watch was enabled
  watchExpiresAt: timestamp('watch_expires_at'), // When Gmail watch expires (7 days)

  // Run state (integration-specific)
  lastRunToken: text('last_run_token'), // Gmail historyId, Outlook deltaToken, etc.
  lastRunAt: timestamp('last_run_at'),

  // Metadata
  isActive: boolean('is_active').default(true).notNull(),
  lastUsedAt: timestamp('last_used_at'),

  // Audit fields
  createdBy: uuid('created_by'),
  updatedBy: uuid('updated_by'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export type Integration = typeof integrations.$inferSelect;
export type NewIntegration = typeof integrations.$inferInsert;
export type IntegrationSource = 'gmail' | 'outlook' | 'slack' | 'other';
