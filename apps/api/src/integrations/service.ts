import { injectable, inject } from 'tsyringe';
import { IntegrationRepository, type CreateIntegrationInput, type UpdateKeysInput, type IntegrationKeys } from './repository';
import type { IntegrationSource } from './schema';
import type { UpdateRunState, UpdateAccessToken, UpdateWatchExpiry } from '@crm/clients';
import { logger } from '../utils/logger';

@injectable()
export class IntegrationService {
  constructor(@inject(IntegrationRepository) private integrationRepo: IntegrationRepository) {}

  /**
   * Create or update integration
   * Now checks by email to allow multiple integrations per tenant
   */
  async createOrUpdate(input: {
    tenantId: string;
    authType: 'oauth' | 'service_account' | 'api_key';
    keys: IntegrationKeys;
    createdBy?: string;
  }) {
    const { tenantId, authType, keys, createdBy } = input;

    // Validate that email is set for lookup
    const email = keys.email || keys.impersonatedUserEmail;
    if (!email) {
      throw new Error('keys.email or keys.impersonatedUserEmail is required for tenant lookup');
    }

    // Check if integration exists for this specific email
    const existingIntegrationId = await this.integrationRepo.findIdByEmail(tenantId, 'gmail', email);

    if (existingIntegrationId) {
      logger.info({ tenantId, email }, 'Updating existing Gmail integration');
      const integration = await this.integrationRepo.updateKeysByEmail(tenantId, 'gmail', email, { keys });
      return { integration, updated: true };
    } else {
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
  async findByEmail(email: string, source: IntegrationSource = 'gmail') {
    return this.integrationRepo.findByEmail(email, source);
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
    daysBeforeExpiry: number = 2
  ) {
    const integrations = await this.integrationRepo.findIntegrationsNeedingWatchRenewal(
      source,
      daysBeforeExpiry
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
}
