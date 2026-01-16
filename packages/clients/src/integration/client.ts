import { BaseClient, NotFoundError } from '../base-client';
import type { ApiResponse } from '@crm/shared';
import type { Integration, IntegrationCredentials, IntegrationSource, IntegrationKeys } from './types';

/**
 * Client for integration-related API operations
 */
export class IntegrationClient extends BaseClient {
  /**
   * Get integration credentials (decrypted)
   */
  async getCredentials(tenantId: string, source: string): Promise<IntegrationCredentials | null> {
    const response = await this.get<ApiResponse<IntegrationCredentials>>(
      `/api/integrations/${tenantId}/${source}/credentials`
    );
    return response?.data ?? null;
  }

  /**
   * Get integration details
   * Returns null if integration doesn't exist (404)
   */
  async getByTenantAndSource(tenantId: string, source: string): Promise<Integration | null> {
    try {
      const response = await this.get<ApiResponse<Integration>>(`/api/integrations/${tenantId}/${source}`);
      return response?.data ?? null;
    } catch (error) {
      if (error instanceof NotFoundError) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Update integration keys (re-encrypts)
   */
  async updateKeys(tenantId: string, source: string, keys: IntegrationKeys): Promise<void> {
    await this.patch(`/api/integrations/${tenantId}/${source}/keys`, { keys });
  }

  /**
   * Update OAuth token expiration
   */
  async updateTokenExpiration(tenantId: string, source: string, expiresAt: Date): Promise<void> {
    await this.put(`/api/integrations/${tenantId}/${source}/token-expiration`, {
      expiresAt: expiresAt.toISOString(),
    });
  }

  /**
   * Find integration by email address (for webhook lookup)
   * Returns the full integration so we have the ID for subsequent updates
   */
  async findByEmail(email: string, source: IntegrationSource = 'gmail'): Promise<Integration | null> {
    const response = await this.get<ApiResponse<Integration>>(
      `/api/integrations/lookup/by-email?email=${encodeURIComponent(email)}&source=${source}`
    );
    return response?.data ?? null;
  }

  /**
   * Update run state (lastRunToken, lastRunAt) by integration ID
   */
  async updateRunState(
    integrationId: string,
    state: { lastRunToken?: string; lastRunAt?: Date }
  ): Promise<void> {
    await this.patch(`/api/integrations/${integrationId}/run-state`, state);
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
  ): Promise<void> {
    await this.patch(`/api/integrations/${integrationId}/access-token`, {
      accessToken: data.accessToken,
      accessTokenExpiresAt: data.accessTokenExpiresAt.toISOString(),
      refreshToken: data.refreshToken,
    });
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
  ): Promise<void> {
    await this.patch(`/api/integrations/${integrationId}/watch-expiry`, {
      watchSetAt: data.watchSetAt.toISOString(),
      watchExpiresAt: data.watchExpiresAt.toISOString(),
    });
  }

  /**
   * Check if watch needs renewal for a specific integration
   */
  async needsWatchRenewal(integration: Integration): Promise<boolean> {
    if (!integration.watchExpiresAt) {
      return true;
    }
    const now = new Date();
    const oneDayFromNow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    return integration.watchExpiresAt < oneDayFromNow;
  }

  /**
   * Disconnect integration (stops watch and deactivates)
   */
  async disconnect(tenantId: string, source: string): Promise<void> {
    await this.delete(`/api/integrations/${tenantId}/${source}`);
  }

  /**
   * Update integration parameters by integration ID
   * Used for settings like blacklist emails, etc.
   */
  async updateParameters(
    integrationId: string,
    parameters: Record<string, any>
  ): Promise<void> {
    await this.patch(`/api/integrations/${integrationId}/parameters`, { parameters });
  }
}
