import { z } from 'zod';

/**
 * Integration source types
 */
export const integrationSourceSchema = z.enum(['gmail', 'outlook', 'slack', 'other']);
export type IntegrationSource = z.infer<typeof integrationSourceSchema>;

/**
 * Integration auth types
 */
export const integrationAuthTypeSchema = z.enum(['oauth', 'service_account', 'api_key']);
export type IntegrationAuthType = z.infer<typeof integrationAuthTypeSchema>;

/**
 * Integration keys (for create/update requests)
 */
export const integrationKeysSchema = z.record(z.string(), z.any());
export type IntegrationKeys = z.infer<typeof integrationKeysSchema>;

/**
 * Schema for user who created the integration
 */
export const integrationCreatedByUserSchema = z.object({
  firstName: z.string(),
  lastName: z.string(),
  email: z.string(),
  fullName: z.string(),
}).nullable().optional();

export type IntegrationCreatedByUser = z.infer<typeof integrationCreatedByUserSchema>;

/**
 * Zod schema for Integration response
 * Note: Sensitive fields (credentials, tokens) are not exposed in API responses
 */
export const integrationSchema = z.object({
  id: z.uuid(),
  tenantId: z.uuid(),
  source: integrationSourceSchema,
  authType: integrationAuthTypeSchema,
  isActive: z.boolean(),
  tokenExpiresAt: z.coerce.date().nullable().optional(),
  lastUsedAt: z.coerce.date().nullable().optional(),
  lastRunToken: z.string().nullable().optional(), // Gmail historyId, Outlook deltaToken, etc.
  lastRunAt: z.coerce.date().nullable().optional(),
  watchSetAt: z.coerce.date().nullable().optional(), // When Gmail watch was enabled
  watchExpiresAt: z.coerce.date().nullable().optional(), // When Gmail watch expires
  connectedEmail: z.string().nullable().optional(), // Email address connected (for display)
  createdByUser: integrationCreatedByUserSchema, // User who connected this integration
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

export type Integration = z.infer<typeof integrationSchema>;

/**
 * Zod schema for Integration credentials response (decrypted)
 * Internal use only - contains sensitive data
 */
export const integrationCredentialsSchema = integrationKeysSchema;
export type IntegrationCredentials = z.infer<typeof integrationCredentialsSchema>;

/**
 * Zod schema for updating run state (lastRunToken, lastRunAt)
 * Validates and coerces date strings to Date objects
 */
export const updateRunStateSchema = z.object({
  lastRunToken: z.string().optional(),
  lastRunAt: z.coerce.date().optional(),
});

export type UpdateRunState = z.infer<typeof updateRunStateSchema>;

/**
 * Zod schema for updating access token after refresh
 */
export const updateAccessTokenSchema = z.object({
  accessToken: z.string(),
  accessTokenExpiresAt: z.coerce.date(),
  refreshToken: z.string().optional(), // Optional, in case it changes
});

export type UpdateAccessToken = z.infer<typeof updateAccessTokenSchema>;

/**
 * Zod schema for updating watch expiry timestamps
 */
export const updateWatchExpirySchema = z.object({
  watchSetAt: z.coerce.date(),
  watchExpiresAt: z.coerce.date(),
});

export type UpdateWatchExpiry = z.infer<typeof updateWatchExpirySchema>;

/**
 * Zod schema for updating integration parameters
 * Used for settings like blacklist emails, etc.
 */
export const updateParametersRequestSchema = z.object({
  parameters: z.record(z.string(), z.any()),
});

export type UpdateParametersRequest = z.infer<typeof updateParametersRequestSchema>;
