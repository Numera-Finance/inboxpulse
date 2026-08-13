import { injectable, inject } from 'tsyringe';
import {
  IntegrationRepository,
  type CreateIntegrationInput,
  type UpdateKeysInput,
  type IntegrationKeys,
  type IntegrationWithKeys,
} from './repository';
import { TenantRepository } from '../tenants/repository';
import type { IntegrationSource } from './schema';
import type { UpdateRunState, UpdateAccessToken, UpdateWatchExpiry } from '@crm/clients';
import { logger } from '../utils/logger';

/**
 * Outcome of createOrUpdate. `reactivated` distinguishes a reconnect of a
 * previously disconnected mailbox from a routine credential refresh.
 */
export type CreateOrUpdateResult =
  | { integration: IntegrationWithKeys; updated: true; reactivated: boolean }
  | { integration: IntegrationWithKeys; created: true };

@injectable()
export class IntegrationService {
  constructor(
    @inject(IntegrationRepository) private integrationRepo: IntegrationRepository,
    @inject(TenantRepository) private tenantRepo: TenantRepository,
  ) {}

  /**
   * Create or update integration
   * Keyed by mailbox, so a tenant can connect several mailboxes
   *
   * The lookup covers disconnected integrations too. Matching only connected
   * ones made every reconnect insert a fresh row, and since email_threads is
   * unique on (tenant_id, integration_id, provider_thread_id) the same Gmail
   * thread was then re-ingested under each row (ADR-006).
   */
  async createOrUpdate(input: {
    tenantId: string;
    authType: 'oauth' | 'service_account' | 'api_key';
    keys: IntegrationKeys;
    createdBy?: string;
  }): Promise<CreateOrUpdateResult> {
    const { tenantId, authType, keys, createdBy } = input;

    // Validate that email is set for lookup
    const email = keys.email || keys.impersonatedUserEmail;
    if (!email) {
      throw new Error('keys.email or keys.impersonatedUserEmail is required for tenant lookup');
    }

    // Check if an integration already owns this mailbox, connected or not
    const existing = await this.integrationRepo.findByTenantAndEmail(tenantId, 'gmail', email);

    if (existing) {
      const reactivated = !existing.isActive;
      logger.info(
        { tenantId, email, integrationId: existing.id, reactivated },
        reactivated
          ? 'Reconnecting previously disconnected Gmail integration'
          : 'Updating existing Gmail integration'
      );
      const integration = await this.integrationRepo.updateKeysById(
        existing.id,
        { keys, updatedBy: createdBy },
        { reactivate: reactivated, authType }
      );
      return { integration, updated: true, reactivated };
    }

    logger.info({ tenantId, email, authType, createdBy }, 'Creating new Gmail integration');
    const integration = await this.integrationRepo.create({
      tenantId,
      source: 'gmail',
      authType,
      keys,
      tokenExpiresAt: keys.expiresAt ? new Date(keys.expiresAt) : undefined,
      createdBy,
    });
    return { integration, created: true };
  }

  /**
   * Get integration credentials (decrypted) - Internal use only
   */
  async getCredentials(tenantId: string, source: IntegrationSource): Promise<IntegrationKeys | null> {
    return this.integrationRepo.getCredentials(tenantId, source);
  }

  /**
   * Get integration metadata (without exposing keys)
   */
  async getIntegration(tenantId: string, source: IntegrationSource) {
    const integration = await this.integrationRepo.getIntegration(tenantId, source);

    if (!integration) {
      return null;
    }

    // Don't expose sensitive keys, but include run state and watch tracking
    return {
      id: integration.id,
      tenantId: integration.tenantId,
      source: integration.source,
      authType: integration.authType,
      isActive: integration.isActive,
      tokenExpiresAt: integration.tokenExpiresAt,
      lastUsedAt: integration.lastUsedAt,
      lastRunToken: integration.lastRunToken,
      lastRunAt: integration.lastRunAt,
      watchSetAt: integration.watchSetAt,
      watchExpiresAt: integration.watchExpiresAt,
      connectedEmail: integration.connectedEmail,
      createdByUser: integration.createdByUser,
      createdAt: integration.createdAt,
      updatedAt: integration.updatedAt,
    };
  }

  /**
   * Update token expiration (for OAuth refresh)
   */
  async updateTokenExpiration(tenantId: string, source: IntegrationSource, expiresAt: Date) {
    await this.integrationRepo.updateTokenExpiration(tenantId, source, expiresAt);
  }

  /**
   * Update refresh token (for OAuth re-authorization)
   */
  async updateRefreshToken(tenantId: string, source: IntegrationSource, refreshToken: string) {
    await this.integrationRepo.updateRefreshToken(tenantId, source, refreshToken);
  }

  /**
   * Update integration keys (partial update)
   */
  async updateKeys(tenantId: string, source: IntegrationSource, input: UpdateKeysInput) {
    return this.integrationRepo.updateKeys(tenantId, source, input);
  }

  /**
   * Find integration by email (for webhook lookup)
   * Returns the full integration so we have the ID for subsequent updates
   */
  async findByEmail(email: string, source: IntegrationSource = 'gmail', tenantId?: string) {
    return this.integrationRepo.findByEmail(email, source, tenantId);
  }

  /**
   * Get integration by ID
   */
  async getById(integrationId: string) {
    return this.integrationRepo.findById(integrationId);
  }

  /**
   * List integrations for tenant
   */
  async listByTenant(tenantId: string) {
    return this.integrationRepo.listByTenant(tenantId);
  }

  /**
   * Find integrations that need watch renewal (expiring within specified days)
   */
  async findIntegrationsNeedingWatchRenewal(
    source: IntegrationSource,
    daysBeforeExpiry: number = 2,
    tenantId?: string
  ) {
    const integrations = await this.integrationRepo.findIntegrationsNeedingWatchRenewal(
      source,
      daysBeforeExpiry,
      tenantId
    );

    // Return without sensitive data
    return integrations.map((integration) => ({
      id: integration.id,
      tenantId: integration.tenantId,
      source: integration.source,
      authType: integration.authType,
      isActive: integration.isActive,
      watchSetAt: integration.watchSetAt,
      watchExpiresAt: integration.watchExpiresAt,
      lastRunToken: integration.lastRunToken,
      lastRunAt: integration.lastRunAt,
      createdAt: integration.createdAt,
      updatedAt: integration.updatedAt,
    }));
  }

  /**
   * Update run state (lastRunToken, lastRunAt) by integration ID
   */
  async updateRunState(integrationId: string, state: UpdateRunState) {
    await this.integrationRepo.updateRunState(integrationId, state);
  }

  /**
   * Update access token after refresh by integration ID
   */
  async updateAccessToken(integrationId: string, data: UpdateAccessToken) {
    await this.integrationRepo.updateAccessToken(integrationId, data);
  }

  /**
   * Update watch expiry timestamps by integration ID
   */
  async updateWatchExpiry(integrationId: string, data: UpdateWatchExpiry) {
    await this.integrationRepo.updateWatchExpiry(integrationId, data);
  }

  /**
   * Deactivate integration
   */
  async deactivate(tenantId: string, source: IntegrationSource, updatedBy?: string) {
    logger.warn({ tenantId, source }, 'Deactivating integration');
    await this.integrationRepo.deactivate(tenantId, source, updatedBy);
  }

  /**
   * Update integration parameters by integration ID
   * Used for settings like blacklist emails, etc.
   */
  async updateParameters(integrationId: string, parameters: Record<string, any>) {
    logger.info({ integrationId, parameters }, 'Updating integration parameters');
    return this.integrationRepo.updateParameters(integrationId, parameters);
  }

  /**
   * Ensure tenant domains are in the integration's blacklist.
   * Prevents collecting internal emails during Gmail sync.
   * Called after OAuth connection to auto-configure the blacklist.
   */
  async ensureTenantDomainsBlacklisted(tenantId: string, source: IntegrationSource): Promise<void> {
    try {
      const tenant = await this.tenantRepo.findById(tenantId);
      if (!tenant?.domains?.length) {
        logger.debug({ tenantId }, 'No tenant domains configured, skipping blacklist auto-add');
        return;
      }

      const integration = await this.integrationRepo.getIntegration(tenantId, source);
      if (!integration) {
        logger.debug({ tenantId, source }, 'No active integration found, skipping blacklist auto-add');
        return;
      }

      // Get current blacklist
      const credentials = await this.integrationRepo.getCredentials(tenantId, source);
      const currentBlacklist: string[] = Array.isArray(credentials?.blacklistEmails)
        ? credentials.blacklistEmails
        : [];
      const existingDomains = new Set(currentBlacklist.map(e => e.toLowerCase()));

      // Find tenant domains not yet in blacklist
      const domainsToAdd = tenant.domains
        .map(d => d.toLowerCase())
        .filter(d => !existingDomains.has(d));

      if (domainsToAdd.length === 0) {
        logger.debug({ tenantId }, 'All tenant domains already in blacklist');
        return;
      }

      // Merge and update
      const updatedBlacklist = [...currentBlacklist, ...domainsToAdd];
      await this.integrationRepo.updateParameters(integration.id, {
        blacklistEmails: updatedBlacklist,
      });

      logger.info(
        { tenantId, addedDomains: domainsToAdd, totalBlacklist: updatedBlacklist.length },
        'Auto-added tenant domains to Gmail blacklist'
      );
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn(
        { tenantId, source, error: message },
        'Failed to auto-add tenant domains to blacklist (non-blocking)'
      );
    }
  }
}
