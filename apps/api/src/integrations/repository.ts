import { injectable, inject } from 'tsyringe';
import type { Database } from '@crm/database';
import {
  integrations,
  type Integration,
  type NewIntegration,
  type IntegrationSource,
  type IntegrationParameters,
} from './schema';
import { users } from '../users/schema';
import { eq, and, or, desc, isNull, lt, sql, type SQL } from 'drizzle-orm';
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
 * Parameter keys under which a mailbox address can be stored. `email` is what
 * OAuth writes, `impersonatedUserEmail` what service accounts use, and
 * `userEmail` a legacy spelling — `getIntegration` and `listByTenant` fall back
 * across all three when deriving connectedEmail, so identity lookups must cover
 * the same set or a mailbox stored under a later key resolves for Gmail webhooks
 * but not for reconnects, and forks its email_threads (ADR-006).
 */
const EMAIL_PARAMETER_KEYS = ['email', 'impersonatedUserEmail', 'userEmail'] as const;

/**
 * Lowercase the address under every mailbox-bearing key.
 *
 * Email addresses are case-insensitive, and the unique index from migration 015
 * lowercases before comparing. Storing mixed case would let one mailbox occupy
 * two rows, and — now that the index exists — turn the resulting missed lookup
 * into a constraint violation surfacing as a failed OAuth callback rather than a
 * silent duplicate.
 */
function normalizeEmailParameters(params: Record<string, any>): Record<string, any> {
  const normalized = { ...params };

  for (const key of EMAIL_PARAMETER_KEYS) {
    if (typeof normalized[key] === 'string') {
      normalized[key] = normalized[key].toLowerCase();
    }
  }

  return normalized;
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

export type IntegrationAuthType = 'oauth' | 'service_account' | 'api_key';

export interface CreateIntegrationInput {
  tenantId: string;
  source: IntegrationSource;
  authType: IntegrationAuthType;
  keys: IntegrationKeys;
  createdBy?: string;
  tokenExpiresAt?: Date;
}

export interface UpdateKeysInput {
  keys: Partial<IntegrationKeys>;
  updatedBy?: string;
}

/**
 * Identity of an integration resolved by mailbox, plus whether it is currently
 * connected. Callers need `isActive` to tell a routine credential refresh from a
 * reconnect of a previously disconnected mailbox.
 */
export interface IntegrationLookupResult {
  id: string;
  isActive: boolean;
}

/** An integration row with its `parameters` array flattened into a keys object. */
export type IntegrationWithKeys = Integration & { keys: IntegrationKeys };

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
    const parametersArray = objectToParameters(normalizeEmailParameters(params));

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
    keys: readonly string[] = EMAIL_PARAMETER_KEYS
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
   * Case-insensitive variant of the predicate above, matching the address under
   * any mailbox-bearing key.
   *
   * Containment (`@>`) compares JSONB values byte-exactly, so it cannot see that
   * `Ops@acme.com` and `ops@acme.com` are the same mailbox. That mismatch matters
   * now that migration 015 enforces uniqueness over the *lowercased* address: a
   * lookup that missed on case would fall through to an INSERT and hit the unique
   * index, failing the OAuth callback instead of connecting. This expression is
   * deliberately identical to the one the index is built on.
   *
   * Only identity lookups use this. The Gmail webhook path (findByEmail) stays on
   * containment because it runs on every notification and depends on
   * idx_integrations_parameters_gin to avoid the full table scans that migration
   * 012 exists to prevent; addresses arriving from Gmail are already lowercase,
   * and writes are normalized, so the two agree in practice.
   *
   * Key names come from a fixed internal list, never from a caller; the address
   * is bound as a query parameter.
   */
  private emailMatchesParametersIgnoringCase(
    email: string,
    keys: readonly string[] = EMAIL_PARAMETER_KEYS
  ): SQL {
    // Same guard as above: a falsy email must match nothing rather than degrade
    // into a predicate that matches any row carrying an email key at all.
    if (!email || keys.length === 0) {
      return sql`false`;
    }

    const needle = email.toLowerCase();

    return or(
      ...keys.map(
        (key) =>
          sql`lower(jsonb_path_query_first(${integrations.parameters}, ${`$[*] ? (@.key == "${key}").value`}::jsonpath) #>> '{}') = ${needle}`
      )
    )!;
  }

  /**
   * Find the integration owning `email` for this tenant/source, connected or not.
   *
   * Deliberately NOT filtered by is_active. Disconnecting a mailbox flips
   * is_active to false, so an active-only lookup made every reconnect miss the
   * existing row and INSERT a duplicate instead — which is what fragmented one
   * production mailbox across 13 rows and split its email_threads three ways
   * (see ADR-006).
   *
   * Ordering prefers the connected row, then the most recently created one. For
   * a tenant still carrying pre-fix duplicates that is the row holding the newest
   * email_threads, so a reconnect revives the richest row rather than an empty
   * one from months earlier.
   */
  async findByTenantAndEmail(
    tenantId: string,
    source: IntegrationSource,
    email: string
  ): Promise<IntegrationLookupResult | null> {
    const result = await this.db
      .select({ id: integrations.id, isActive: integrations.isActive })
      .from(integrations)
      .where(
        and(
          eq(integrations.tenantId, tenantId),
          eq(integrations.source, source),
          this.emailMatchesParametersIgnoringCase(email)
        )
      )
      .orderBy(desc(integrations.isActive), desc(integrations.createdAt), integrations.id)
      .limit(1);

    return result.length > 0 ? result[0] : null;
  }

  /**
   * Merge `input.keys` into one specific integration row.
   *
   * Current parameters are read from that same row by ID. The previous
   * implementation merged from getCredentials(tenantId, source), which returns an
   * arbitrary ACTIVE row for the tenant — with more than one mailbox connected
   * that copied the wrong mailbox's parameters over this one.
   *
   * `reactivate` marks a reconnect of a disconnected mailbox. Besides flipping
   * is_active back on it clears the stale sync bookkeeping: last_run_token is a
   * Gmail historyId, and Gmail rejects ones older than roughly a week, so
   * incrementalSync would throw rather than fall back (it only degrades to
   * initialSync when the cursor is absent). Clearing it makes the next run a full
   * initial sync — what used to happen implicitly when a reconnect minted a fresh
   * row. The watch and access-token fields are cleared for the same reason: the
   * watch was stopped at disconnect, and a stale expiry in the future would
   * suppress renewal.
   */
  async updateKeysById(
    integrationId: string,
    input: UpdateKeysInput,
    options: { reactivate: boolean; authType?: IntegrationAuthType } = { reactivate: false }
  ): Promise<IntegrationWithKeys> {
    const current = await this.findById(integrationId);

    if (!current) {
      throw new Error(`Integration not found: ${integrationId}`);
    }

    const currentKeys: IntegrationKeys = {
      ...parametersToObject(current.parameters as IntegrationParameters),
      refreshToken: current.refreshToken || current.token || undefined,
    };

    // accessToken/accessTokenExpiresAt are columns, not parameters — keep them
    // out of the JSONB. The access token is intentionally not written here: the
    // Gmail client only trusts one when a matching expiry is stored, and we have
    // no expiry on this path, so it refreshes from the refresh token instead.
    const { refreshToken, accessToken, accessTokenExpiresAt, ...params } = {
      ...currentKeys,
      ...input.keys,
    };

    // Re-authorizing over OAuth must retire the service-account credentials this
    // mailbox may have carried: GmailClientFactory tests serviceAccountEmail and
    // serviceAccountKey BEFORE the OAuth branch, so merging them forward would
    // keep the row authenticating as a service account and leave the grant the
    // user just made unused. impersonatedUserEmail is kept — it is an address,
    // not a credential, and it is one of the keys this mailbox is found by.
    if (options.authType === 'oauth') {
      delete params.serviceAccountEmail;
      delete params.serviceAccountKey;
    }

    const values: Partial<NewIntegration> = {
      parameters: objectToParameters(normalizeEmailParameters(params)),
      updatedBy: input.updatedBy,
      updatedAt: new Date(),
    };

    // Keep auth_type in step with the credentials actually stored, so a mailbox
    // that moves between strategies is not left claiming the old one.
    if (options.authType) {
      values.authType = options.authType;
    }

    // Write both columns, and only when we actually hold a token — an absent one
    // means "unchanged", never "clear it". getCredentials prefers refresh_token
    // and falls back to the legacy token, so writing only the legacy column would
    // leave a previously rotated refresh token winning over the one a reconnect
    // just issued.
    if (refreshToken) {
      values.refreshToken = refreshToken;
      values.token = refreshToken;
    }

    // A caller-supplied refresh token means someone just re-authorized, so the
    // cached access token is suspect — typically they revoked the grant and
    // reconnected to repair it. The Gmail client trusts any stored access token
    // whose expiry is more than 5 minutes out, so leaving it would keep a revoked
    // token in use for up to an hour after a successful reconnect. Test
    // input.keys rather than the merged value, which carries the row's existing
    // token forward and would clear on every settings-only save.
    if (input.keys.refreshToken || options.reactivate) {
      values.accessToken = null;
      values.accessTokenExpiresAt = null;
    }

    if (options.reactivate) {
      values.isActive = true;
      values.lastRunToken = null;
      values.lastRunAt = null;
      values.watchSetAt = null;
      values.watchExpiresAt = null;
    }

    const result = await this.db
      .update(integrations)
      .set(values)
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
    //
    // Compare against a JS-computed cutoff rather than SQL now(): last_used_at
    // is `timestamp` WITHOUT time zone and is written as a JS Date, so a
    // server-side now() comparison would be reinterpreted through the session
    // TimeZone and could shift the 10-min window (or defeat the debounce
    // entirely). A Date cutoff uses the same serialization path as the write.
    const staleCutoff = new Date(Date.now() - 10 * 60 * 1000);
    await this.db
      .update(integrations)
      .set({ lastUsedAt: new Date() })
      .where(
        and(
          eq(integrations.id, integrationId),
          or(
            isNull(integrations.lastUsedAt),
            lt(integrations.lastUsedAt, staleCutoff)
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

  private async mapToIntegration(row: Integration): Promise<IntegrationWithKeys> {
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
