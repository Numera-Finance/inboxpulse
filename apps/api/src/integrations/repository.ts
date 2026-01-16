import { injectable, inject } from 'tsyringe';
import type { Database } from '@crm/database';
import { integrations, type IntegrationSource, type IntegrationParameters } from './schema';
import { users } from '../users/schema';
import { eq, and, or, isNull, lt, sql } from 'drizzle-orm';
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
 * Also handles legacy object format
 */
function parametersToObject(params: IntegrationParameters | Record<string, any>): Record<string, string> {
  // If it's already an object (legacy format), return as-is
  if (!Array.isArray(params)) {
    return params as Record<string, string>;
  }

  // Convert array format to object
  return params.reduce((acc: Record<string, string>, { key, value }: { key: string; value: string }) => {
    acc[key] = value;
    return acc;
  }, {} as Record<string, string>);
}

/**
 * Convert object to key-value array
 */
function objectToParameters(obj: Record<string, any>): IntegrationParameters {
  return Object.entries(obj).map(([key, value]: [string, any]) => ({
    key,
    value: String(value),
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

    await this.db
      .update(integrations)
      .set(updateData)
      .where(eq(integrations.id, integrationId));
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
          or(
            sql`${integrations.parameters}::jsonb @> ${sql.raw(`'[{"key": "email", "value": "${email}"}]'::jsonb`)}`,
            sql`${integrations.parameters}::jsonb @> ${sql.raw(`'[{"key": "impersonatedUserEmail", "value": "${email}"}]'::jsonb`)}`
          )
        )
      )
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
    daysBeforeExpiry: number = 2
  ) {
    const now = new Date();
    const thresholdDate = new Date(now.getTime() + daysBeforeExpiry * 24 * 60 * 60 * 1000);

    const result = await this.db
      .select()
      .from(integrations)
      .where(
        and(
          eq(integrations.source, source),
          eq(integrations.isActive, true),
          // Watch expires within threshold OR no watch set
          or(
            isNull(integrations.watchExpiresAt),
            lt(integrations.watchExpiresAt, thresholdDate)
          )
        )
      );

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
  async findByEmail(email: string, source: IntegrationSource = 'gmail') {
    const result = await this.db
      .select()
      .from(integrations)
      .where(and(eq(integrations.source, source), eq(integrations.isActive, true)));

    for (const row of result) {
      const params = parametersToObject(row.parameters as IntegrationParameters);
      if (
        params.impersonatedUserEmail === email ||
        params.email === email ||
        params.userEmail === email
      ) {
        return this.mapToIntegration(row);
      }
    }

    return null;
  }

  private async updateLastUsed(integrationId: string) {
    await this.db
      .update(integrations)
      .set({ lastUsedAt: new Date() })
      .where(eq(integrations.id, integrationId));
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
