import { injectable, inject } from 'tsyringe';
import type { Database } from '@crm/database';
import { integrations, type IntegrationSource, type IntegrationParameters } from './schema';
import { users } from '../users/schema';
import { eq, and, or, isNull, lt, sql, type SQL } from 'drizzle-orm';
import { logger } from '../utils/logger';

export interface IntegrationKeys {
  // Email being monitored/synced (for tenant lookup)
  email?: string;

  // OAuth credentials
  accessToken?: string;
  refreshToken?: string;

  // OAuth client credentials (non-token)
  clientId?: string;
  clientSecret?: string;

  // Service Account credentials
  serviceAccountEmail?: string;
  serviceAccountKey?: any;
  impersonatedUserEmail?: string;

  // API Key
  apiKey?: string;

  // Additional metadata
  scopes?: string[];
  [key: string]: any;
}

/**
 * Convert key-value array to object
 * Handles both legacy string values and native JSON values
 */
function parametersToObject(params: IntegrationParameters | Record<string, any>): Record<string, any> {
  // If it's already an object (legacy format), return as-is
  if (!Array.isArray(params)) {
    return params as Record<string, any>;
  }

  // Convert array format to object
  return params.reduce((acc: Record<string, any>, { key, value }: { key: string; value: any }) => {
    // Handle legacy string values that look like JSON arrays/objects
    if (typeof value === 'string' && value && (value.startsWith('[') || value.startsWith('{'))) {
      try {
        acc[key] = JSON.parse(value);
      } catch {
        acc[key] = value;
      }
    } else {
      acc[key] = value;
    }
    return acc;
  }, {} as Record<string, any>);
}

/**
 * Convert object to key-value array
 * Values are stored as native JSON (arrays, objects, strings, etc.)
 */
function objectToParameters(obj: Record<string, any>): IntegrationParameters {
  return Object.entries(obj).map(([key, value]: [string, any]) => ({
    key,
    value, // Store native JSON value directly
  }));
}

export interface CreateIntegrationInput {
  tenantId: string;
  source: IntegrationSource;
  authType: 'oauth' | 'service_account' | 'api_key';
  keys: IntegrationKeys;
  createdBy?: string;
  tokenExpiresAt?: Date;
}

export interface UpdateKeysInput {
  keys: Partial<IntegrationKeys>;
  updatedBy?: string;
}

@injectable()
export class IntegrationRepository {
  constructor(@inject('Database') private db: Database) { }

  /**
   * Create a new integration
   */
  async create(input: CreateIntegrationInput) {
    // Separate token from other parameters
    const { refreshToken, accessToken, ...params } = input.keys;

    // Convert params object to key-value array for JSONB storage
    const parametersArray = objectToParameters(params);

    const result = await this.db
      .insert(integrations)
      .values({
        tenantId: input.tenantId,
        source: input.source,
        authType: input.authType,
        parameters: parametersArray,
        token: refreshToken,
        tokenExpiresAt: input.tokenExpiresAt,
        createdBy: input.createdBy,
        isActive: true,
      })
      .returning();

    return this.mapToIntegration(result[0]);
  }

  /**
   * Find integration by ID
   */
  async findById(integrationId: string) {
    const result = await this.db
      .select()
      .from(integrations)
      .where(eq(integrations.id, integrationId))
      .limit(1);

    return result.length > 0 ? result[0] : null;
  }

  /**
   * Get integration credentials
   */
  async getCredentials(tenantId: string, source: IntegrationSource): Promise<IntegrationKeys | null> {
    const result = await this.db
      .select()
      .from(integrations)
      .where(
        and(
          eq(integrations.tenantId, tenantId),
          eq(integrations.source, source),
          eq(integrations.isActive, true)
        )
      )
      .limit(1);

    if (!result.length) {
      return null;
    }

    const integration = result[0];

    // Update last used timestamp (fire and forget)
    this.updateLastUsed(integration.id).catch((err) =>
      logger.error({ error: err, integrationId: integration.id }, 'Failed to update lastUsedAt')
    );

    // Convert parameters array to object
    const params = parametersToObject(integration.parameters as IntegrationParameters);

    return {
      ...params,
      refreshToken: integration.refreshToken || integration.token || undefined, // Prefer new field, fallback to legacy
      accessToken: integration.accessToken || undefined,
      accessTokenExpiresAt: integration.accessTokenExpiresAt || undefined,
    };
  }

  /**
   * Get integration with metadata (including token expiration)
   */
  async getIntegration(tenantId: string, source: IntegrationSource) {
    const result = await this.db
      .select({
        integration: integrations,
        creatorFirstName: users.firstName,
        creatorLastName: users.lastName,
        creatorEmail: users.email,
      })
      .from(integrations)
      .leftJoin(users, eq(integrations.createdBy, users.id))
      .where(
        and(
          eq(integrations.tenantId, tenantId),
          eq(integrations.source, source),
          eq(integrations.isActive, true)
        )
      )
      .limit(1);

    if (!result.length) {
      return null;
    }

    const row = result[0];
    const params = parametersToObject(row.integration.parameters as IntegrationParameters);
    const connectedEmail = params.email || params.impersonatedUserEmail || params.userEmail;

    return {
      ...(await this.mapToIntegration(row.integration)),
      connectedEmail,
      createdByUser: row.creatorFirstName ? {
        firstName: row.creatorFirstName,
        lastName: row.creatorLastName,
        email: row.creatorEmail,
        fullName: `${row.creatorFirstName} ${row.creatorLastName}`,
      } : null,
    };
  }

  /**
   * Update integration keys
   */
  async updateKeys(tenantId: string, source: IntegrationSource, input: UpdateKeysInput) {
    // Get current keys
    const current = await this.getCredentials(tenantId, source);

    if (!current) {
      throw new Error(`Integration not found for tenant ${tenantId} and source ${source}`);
    }

    // Merge with new keys
    const updatedKeys = { ...current, ...input.keys };

    // Separate token from other parameters
    const { refreshToken, accessToken, ...params } = updatedKeys;

    // Convert params to key-value array
    const parametersArray = objectToParameters(params);

    const result = await this.db
      .update(integrations)
      .set({
        parameters: parametersArray,
        token: refreshToken,
        updatedBy: input.updatedBy,
        updatedAt: new Date(),
      })
      .where(and(eq(integrations.tenantId, tenantId), eq(integrations.source, source)))
      .returning();

    return this.mapToIntegration(result[0]);
  }

  /**
   * Update OAuth token expiration
   */
  async updateTokenExpiration(tenantId: string, source: IntegrationSource, expiresAt: Date) {
    await this.db
      .update(integrations)
      .set({
        tokenExpiresAt: expiresAt,
        updatedAt: new Date(),
      })
      .where(and(eq(integrations.tenantId, tenantId), eq(integrations.source, source)));
  }

  /**
   * Update OAuth refresh token
   */
  async updateRefreshToken(tenantId: string, source: IntegrationSource, refreshToken: string) {
    await this.db
      .update(integrations)
      .set({
        token: refreshToken,
        updatedAt: new Date(),
      })
      .where(and(eq(integrations.tenantId, tenantId), eq(integrations.source, source)));
  }

  /**
   * Update run state (lastRunToken, lastRunAt) by integration ID
   */
  async updateRunState(
    integrationId: string,
    state: {
      lastRunToken?: string;
      lastRunAt?: Date;
    }
  ) {
    await this.db
      .update(integrations)
      .set({
        ...state,
        updatedAt: new Date(),
      })
      .where(eq(integrations.id, integrationId));
  }

  /**
   * Update access token after refresh by integration ID
   */
  async updateAccessToken(
    integrationId: string,
    data: {
      accessToken: string;
      accessTokenExpiresAt: Date;
      refreshToken?: string;
    }
  ) {
    const updateData: any = {
      accessToken: data.accessToken,
      accessTokenExpiresAt: data.accessTokenExpiresAt,
      tokenExpiresAt: data.accessTokenExpiresAt, // legacy field
      updatedAt: new Date(),
    };

    if (data.refreshToken) {
      updateData.refreshToken = data.refreshToken;
      updateData.token = data.refreshToken; // legacy field
    }

    // Concurrent Gmail webhooks can each refresh the OAuth token near expiry and
    // race to write this same row. When only the access token changed, skip the
    // write if another refresher already stored a token that expires at or after
    // ours — this avoids redundant row-lock contention on the hot integration
    // row. Always write unconditionally when a refresh token is present so a
    // rotated refresh token is never dropped by the guard.
    const where = data.refreshToken
      ? eq(integrations.id, integrationId)
      : and(
          eq(integrations.id, integrationId),
          or(
            isNull(integrations.accessTokenExpiresAt),
            lt(integrations.accessTokenExpiresAt, data.accessTokenExpiresAt)
          )
        );

    await this.db
      .update(integrations)
      .set(updateData)
      .where(where);
  }

  /**
   * Update watch expiry timestamps by integration ID
   */
  async updateWatchExpiry(
    integrationId: string,
    data: {
      watchSetAt: Date;
      watchExpiresAt: Date;
    }
  ) {
    await this.db
      .update(integrations)
      .set({
        watchSetAt: data.watchSetAt,
        watchExpiresAt: data.watchExpiresAt,
        updatedAt: new Date(),
      })
      .where(eq(integrations.id, integrationId));
  }

  /**
   * Deactivate integration
   */
  async deactivate(tenantId: string, source: IntegrationSource, updatedBy?: string) {
    await this.db
      .update(integrations)
      .set({
        isActive: false,
        updatedBy,
        updatedAt: new Date(),
      })
      .where(and(eq(integrations.tenantId, tenantId), eq(integrations.source, source)));
  }

  /**
   * Check if integration exists and is active
   */
  async exists(tenantId: string, source: IntegrationSource): Promise<boolean> {
    const result = await this.db
      .select({ id: integrations.id })
      .from(integrations)
      .where(
        and(
          eq(integrations.tenantId, tenantId),
          eq(integrations.source, source),
          eq(integrations.isActive, true)
        )
      )
      .limit(1);

    return result.length > 0;
  }

  /**
   * SQL predicate matching integrations whose `parameters` JSONB array contains
   * the given email under any of the provided email-bearing keys.
   *
   * Uses JSONB containment (`@>`) so Postgres performs the match — index-backed by
   * idx_integrations_parameters_gin — instead of loading every row to filter in JS.
   * The email is bound as a query parameter (never string-interpolated), so a value
   * arriving from an external Gmail webhook cannot be used to inject SQL.
   */
  private emailMatchesParameters(
    email: string,
    keys: readonly string[] = ['email', 'impersonatedUserEmail', 'userEmail']
  ): SQL {
    // A falsy email (or empty keys) must match nothing. Without this guard,
    // JSON.stringify drops an undefined value so the predicate degrades to
    // `parameters @> '[{"key":"email"}]'`, which matches ANY row that merely has
    // an email key — returning a wrong (possibly cross-tenant) integration.
    if (!email || keys.length === 0) {
      return sql`false`;
    }

    return or(
      ...keys.map(
        (key) => sql`${integrations.parameters} @> ${JSON.stringify([{ key, value: email }])}::jsonb`
      )
    )!;
  }

  /**
   * Find integration ID by email address (for internal use)
   */
  async findIdByEmail(tenantId: string, source: IntegrationSource, email: string): Promise<string | null> {
    const result = await this.db
      .select({ id: integrations.id })
      .from(integrations)
      .where(
        and(
          eq(integrations.tenantId, tenantId),
          eq(integrations.source, source),
          eq(integrations.isActive, true),
          this.emailMatchesParameters(email, ['email', 'impersonatedUserEmail'])
        )
      )
      // Deterministic pick when more than one row matches.
      .orderBy(integrations.createdAt, integrations.id)
      .limit(1);

    return result.length > 0 ? result[0].id : null;
  }

  /**
   * Update integration keys by email
   */
  async updateKeysByEmail(
    tenantId: string,
    source: IntegrationSource,
    email: string,
    input: UpdateKeysInput
  ) {
    const integrationId = await this.findIdByEmail(tenantId, source, email);

    if (!integrationId) {
      throw new Error(`Integration not found for tenant ${tenantId}, source ${source}, and email ${email}`);
    }

    // Get current keys
    const current = await this.getCredentials(tenantId, source);

    if (!current) {
      throw new Error(`Integration not found for tenant ${tenantId} and source ${source}`);
    }

    // Merge with new keys
    const updatedKeys = { ...current, ...input.keys };

    // Separate token from other parameters
    const { refreshToken, accessToken, ...params } = updatedKeys;

    // Convert params to key-value array
    const parametersArray = objectToParameters(params);

    const result = await this.db
      .update(integrations)
      .set({
        parameters: parametersArray,
        token: refreshToken,
        updatedBy: input.updatedBy,
        updatedAt: new Date(),
      })
      .where(eq(integrations.id, integrationId))
      .returning();

    return this.mapToIntegration(result[0]);
  }

  /**
   * Find integrations that need watch renewal (expiring within specified days)
   */
  async findIntegrationsNeedingWatchRenewal(
    source: IntegrationSource,
    daysBeforeExpiry: number = 2,
    tenantId?: string
  ) {
    const now = new Date();
    const thresholdDate = new Date(now.getTime() + daysBeforeExpiry * 24 * 60 * 60 * 1000);

    const conditions = [
      eq(integrations.source, source),
      eq(integrations.isActive, true),
      // Watch expires within threshold OR no watch set
      or(
        isNull(integrations.watchExpiresAt),
        lt(integrations.watchExpiresAt, thresholdDate)
      )!,
    ];
    if (tenantId) {
      conditions.push(eq(integrations.tenantId, tenantId));
    }

    const result = await this.db
      .select()
      .from(integrations)
      .where(and(...conditions));

    // mapToIntegration is async, so we need to await all mappings
    return Promise.all(result.map((integration) => this.mapToIntegration(integration)));
  }

  /**
   * List all integrations for a tenant with creator info
   */
  async listByTenant(tenantId: string) {
    const result = await this.db
      .select({
        integration: integrations,
        creatorFirstName: users.firstName,
        creatorLastName: users.lastName,
        creatorEmail: users.email,
      })
      .from(integrations)
      .leftJoin(users, eq(integrations.createdBy, users.id))
      .where(eq(integrations.tenantId, tenantId));

    return result.map((row) => {
      // Extract connected email from parameters
      const params = parametersToObject(row.integration.parameters as IntegrationParameters);
      const connectedEmail = params.email || params.impersonatedUserEmail || params.userEmail;

      return {
        ...row.integration,
        // Don't expose encrypted keys in list view
        keys: undefined,
        // Add connected email for display
        connectedEmail,
        // Add creator info
        createdByUser: row.creatorFirstName ? {
          firstName: row.creatorFirstName,
          lastName: row.creatorLastName,
          email: row.creatorEmail,
          fullName: `${row.creatorFirstName} ${row.creatorLastName}`,
        } : null,
      };
    });
  }

  /**
   * Find integration by email address (for webhook lookup)
   * Returns the full integration so we have the ID for subsequent updates
   */
  async findByEmail(email: string, source: IntegrationSource = 'gmail', tenantId?: string) {
    const conditions: SQL[] = [
      eq(integrations.source, source),
      eq(integrations.isActive, true),
      this.emailMatchesParameters(email),
    ];
    if (tenantId) {
      conditions.push(eq(integrations.tenantId, tenantId));
    }

    const result = await this.db
      .select()
      .from(integrations)
      .where(and(...conditions))
      // No tenantId is passed on the webhook path, so multiple tenants could in
      // principle share a mailbox; order deterministically instead of letting the
      // planner pick an arbitrary row.
      .orderBy(integrations.createdAt, integrations.id)
      .limit(1);

    return result.length > 0 ? this.mapToIntegration(result[0]) : null;
  }

  private async updateLastUsed(integrationId: string) {
    // Debounce: only bump the timestamp if it's stale (>10 min). This runs on
    // every getCredentials call across all Gmail webhooks, and they all target
    // the same integration row — an unconditional UPDATE serializes them on a
    // single row lock and was a primary source of lock-wait contention.
    // last_used_at is telemetry only (nothing reads it for logic), so ~10 min
    // staleness is fine and this guard skips virtually all of those writes.
    await this.db
      .update(integrations)
      .set({ lastUsedAt: new Date() })
      .where(
        and(
          eq(integrations.id, integrationId),
          or(
            isNull(integrations.lastUsedAt),
            lt(integrations.lastUsedAt, sql`now() - interval '10 minutes'`)
          )
        )
      );
  }

  /**
   * Update integration parameters by integration ID (merge with existing)
   * Used for settings like blacklist emails, etc.
   */
  async updateParameters(
    integrationId: string,
    newParams: Record<string, any>
  ) {
    // Get current integration
    const current = await this.findById(integrationId);
    if (!current) {
      throw new Error(`Integration not found: ${integrationId}`);
    }

    // Convert current parameters to object
    const currentParams = parametersToObject(current.parameters as IntegrationParameters);

    // Merge new params (shallow merge)
    const mergedParams = { ...currentParams, ...newParams };

    // Convert back to array format
    const parametersArray = objectToParameters(mergedParams);

    const result = await this.db
      .update(integrations)
      .set({
        parameters: parametersArray,
        updatedAt: new Date(),
      })
      .where(eq(integrations.id, integrationId))
      .returning();

    return this.mapToIntegration(result[0]);
  }

  private async mapToIntegration(row: any) {
    // Convert parameters array to object
    const params = parametersToObject(row.parameters as IntegrationParameters);

    return {
      ...row,
      keys: {
        ...params,
        refreshToken: row.token || undefined,
      },
    };
  }
}
