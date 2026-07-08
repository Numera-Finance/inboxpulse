import { google, gmail_v1 } from 'googleapis';
import { batchFetchImplementation } from '@jrmdayn/googleapis-batcher';
import { IntegrationClient } from '@crm/clients';
import { logger } from '../utils/logger';
import { getEnv } from '../env';

/**
 * Single-flight cache for in-progress OAuth token refreshes, keyed by tenantId.
 *
 * GmailClientFactory is constructed per-request, so this MUST live at module
 * scope (not on the instance) to collapse the refresh stampede across the many
 * concurrent webhooks that hit the same tenant at token-expiry time. Without it,
 * every concurrent caller independently calls Google's token endpoint AND writes
 * the same integration row, producing an external-call fan-out plus heavy
 * row-lock contention. Cloud Run runs multiple instances, so this bounds
 * refreshes to ~one per instance rather than one per webhook.
 */
const inFlightRefreshes = new Map<string, Promise<{ accessToken: string; expiresAt: Date }>>();

/**
 * Credential record returned by IntegrationClient.getCredentials for a Gmail
 * integration. All fields are optional — the auth strategy (OAuth vs service
 * account) is chosen from which ones are present.
 */
interface GmailCredentials {
  accessToken?: string;
  accessTokenExpiresAt?: string | Date;
  refreshToken?: string;
  serviceAccountEmail?: string;
  serviceAccountKey?: { private_key: string };
  impersonatedUserEmail?: string;
  scopes?: string[];
}

/**
 * Gmail Client Factory
 *
 * Abstracts away credential strategy and returns a ready-to-use Gmail client.
 * Handles both OAuth and Service Account authentication transparently.
 *
 * Credentials are stored in the database via IntegrationClient.
 * Access tokens are refreshed from Google and stored in the database.
 */
export class GmailClientFactory {
  constructor(private integrationClient: IntegrationClient) { }

  /**
   * Get Gmail API client for tenant
   * Automatically handles OAuth vs Service Account based on stored credentials
   */
  async getClient(tenantId: string): Promise<gmail_v1.Gmail> {
    // Get credentials from database
    const credentials = await this.integrationClient.getCredentials(tenantId, 'gmail');

    if (!credentials) {
      throw new Error(`No Gmail integration found for tenant ${tenantId}`);
    }

    // Determine auth strategy and create client
    if (credentials.serviceAccountEmail && credentials.serviceAccountKey) {
      return this.createServiceAccountClient(credentials);
    } else if (credentials.refreshToken || credentials.accessToken) {
      return this.createOAuthClient(tenantId, credentials);
    }

    throw new Error('Invalid credentials format - missing required fields');
  }

  /**
   * Get Gmail API client with batch support for tenant
   * Uses googleapis-batcher to automatically batch concurrent requests into single HTTP calls
   * @param maxBatchSize - Max requests per batch (default 50, Gmail recommends <= 50)
   */
  async getBatchClient(tenantId: string, maxBatchSize = 50): Promise<gmail_v1.Gmail> {
    // Get credentials from database
    const credentials = await this.integrationClient.getCredentials(tenantId, 'gmail');

    if (!credentials) {
      throw new Error(`No Gmail integration found for tenant ${tenantId}`);
    }

    // Create batch fetch implementation
    const fetchImpl = batchFetchImplementation({ maxBatchSize });

    // Determine auth strategy and create batch-enabled client
    if (credentials.serviceAccountEmail && credentials.serviceAccountKey) {
      return this.createServiceAccountClient(credentials, fetchImpl);
    } else if (credentials.refreshToken || credentials.accessToken) {
      return this.createOAuthClient(tenantId, credentials, fetchImpl);
    }

    throw new Error('Invalid credentials format - missing required fields');
  }

  /**
   * Create OAuth-authenticated Gmail client
   * Handles automatic token refresh if needed
   * @param fetchImplementation - Optional custom fetch for batching support
   */
  private async createOAuthClient(
    tenantId: string,
    credentials: any,
    fetchImplementation?: typeof fetch
  ): Promise<gmail_v1.Gmail> {
    const now = new Date();

    // Check if we have a valid access token in database (not expired)
    if (credentials.accessToken && credentials.accessTokenExpiresAt) {
      const expiresAt = new Date(credentials.accessTokenExpiresAt);
      // Check if token expires in more than 5 minutes
      if (expiresAt.getTime() - now.getTime() > 5 * 60 * 1000) {
        logger.info({ tenantId, expiresAt }, 'Using access token from database');
        const auth = new google.auth.OAuth2();
        auth.setCredentials({ access_token: credentials.accessToken });
        return google.gmail({ version: 'v1', auth, fetchImplementation });
      }
    }

    // Need to refresh token
    logger.info({ tenantId }, 'Access token expired or missing, refreshing');
    const { accessToken } = await this.refreshOAuthToken(tenantId, credentials);

    // Create OAuth2 client
    const auth = new google.auth.OAuth2();
    auth.setCredentials({ access_token: accessToken });

    return google.gmail({ version: 'v1', auth, fetchImplementation });
  }

  /**
   * Create Service Account-authenticated Gmail client
   * @param fetchImplementation - Optional custom fetch for batching support
   */
  private async createServiceAccountClient(
    credentials: any,
    fetchImplementation?: typeof fetch
  ): Promise<gmail_v1.Gmail> {
    const jwtClient = new google.auth.JWT({
      email: credentials.serviceAccountEmail,
      key: credentials.serviceAccountKey.private_key,
      scopes: credentials.scopes || ['https://www.googleapis.com/auth/gmail.readonly'],
      subject: credentials.impersonatedUserEmail,
    });

    await jwtClient.authorize();

    return google.gmail({ version: 'v1', auth: jwtClient, fetchImplementation });
  }

  /**
   * Ensure we have a valid access token, refreshing if needed
   * Call this periodically during long-running operations to prevent token expiration
   * @returns the valid access token
   */
  async ensureValidTokenAndRefresh(tenantId: string): Promise<string> {
    const credentials = await this.integrationClient.getCredentials(tenantId, 'gmail');
    if (!credentials) {
      throw new Error(`No Gmail integration found for tenant ${tenantId}`);
    }

    const now = new Date();

    // Check if we have a valid access token in database (not expired)
    if (credentials.accessToken && credentials.accessTokenExpiresAt) {
      const expiresAt = new Date(credentials.accessTokenExpiresAt);
      // Check if token expires in more than 2 minutes
      if (expiresAt.getTime() - now.getTime() > 2 * 60 * 1000) {
        return credentials.accessToken;
      }
    }

    // Token expired or about to expire - refresh it
    logger.info({ tenantId }, 'Token expired or expiring soon, refreshing proactively');

    if (credentials.refreshToken) {
      const { accessToken } = await this.refreshOAuthToken(tenantId, credentials);
      return accessToken;
    }

    // For service accounts, we need to re-authorize
    if (credentials.serviceAccountEmail && credentials.serviceAccountKey) {
      const jwtClient = new google.auth.JWT({
        email: credentials.serviceAccountEmail,
        key: credentials.serviceAccountKey.private_key,
        scopes: credentials.scopes || ['https://www.googleapis.com/auth/gmail.readonly'],
        subject: credentials.impersonatedUserEmail,
      });

      const authResponse = await jwtClient.authorize();
      if (!authResponse.access_token) {
        throw new Error('Failed to get access token from service account');
      }

      return authResponse.access_token;
    }

    throw new Error('No valid credentials to refresh token');
  }

  /**
   * Refresh OAuth access token (single-flighted per tenant).
   *
   * Concurrent callers for the same tenant share one in-flight refresh, so we
   * make exactly one Google token call and one DB write per tenant at a time
   * instead of one per webhook. The promise is cleared on settle so the next
   * expiry window triggers a fresh refresh (and a failure doesn't get cached).
   */
  private refreshOAuthToken(
    tenantId: string,
    credentials: GmailCredentials
  ): Promise<{ accessToken: string; expiresAt: Date }> {
    const existing = inFlightRefreshes.get(tenantId);
    if (existing) {
      logger.info({ tenantId }, 'Joining in-flight OAuth token refresh');
      return existing;
    }

    const refresh = this.doRefreshOAuthToken(tenantId, credentials).finally(() => {
      inFlightRefreshes.delete(tenantId);
    });
    inFlightRefreshes.set(tenantId, refresh);
    return refresh;
  }

  /**
   * Perform the actual OAuth access token refresh against Google.
   * Returns both access token and expiration time.
   */
  private async doRefreshOAuthToken(
    tenantId: string,
    credentials: GmailCredentials
  ): Promise<{ accessToken: string; expiresAt: Date }> {
    logger.info({ tenantId }, 'Refreshing OAuth access token');

    // Get OAuth app credentials from environment (static, not user-specific)
    const env = getEnv();
    const clientId = env.GOOGLE_CLIENT_ID;
    const clientSecret = env.GOOGLE_CLIENT_SECRET;

    // Get user-specific refresh token from database
    const refreshToken = credentials.refreshToken;

    if (!refreshToken) {
      throw new Error('refreshToken is required to refresh access token');
    }

    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error({ tenantId, error: errorText }, 'Failed to refresh OAuth token');
      throw new Error(`Failed to refresh token: ${response.statusText}`);
    }

    const data = await response.json() as any;

    // Calculate expiration time
    const expiresAt = new Date(Date.now() + data.expires_in * 1000);

    // Log token response details (without exposing the actual token)
    logger.info(
      {
        tenantId,
        expiresAt,
        tokenType: data.token_type,
        scope: data.scope,
        expiresIn: data.expires_in,
      },
      'OAuth token refreshed - checking granted scopes'
    );

    // Check if we have the required scopes
    const requiredScopes = ['https://www.googleapis.com/auth/gmail.readonly'];
    const grantedScopes = data.scope ? data.scope.split(' ') : [];
    const missingScopes = requiredScopes.filter((scope) => !grantedScopes.includes(scope));

    if (missingScopes.length > 0) {
      logger.error(
        {
          tenantId,
          requiredScopes,
          grantedScopes,
          missingScopes,
        },
        'CRITICAL: Access token is missing required scopes - user needs to re-authorize'
      );
    }

    // Get integration ID for update (API now uses integrationId instead of tenantId/source)
    const integration = await this.integrationClient.getByTenantAndSource(tenantId, 'gmail');
    if (!integration) {
      throw new Error(`No Gmail integration found for tenant ${tenantId}`);
    }

    // Update access token in database (stores both accessToken and refreshToken separately)
    await this.integrationClient.updateAccessToken(integration.id, {
      accessToken: data.access_token,
      accessTokenExpiresAt: expiresAt,
      // Refresh token might change, but usually stays the same
      // Only update if provided in response
      refreshToken: data.refresh_token,
    });

    logger.info({ tenantId, expiresAt }, 'OAuth token refreshed and stored in database');

    return {
      accessToken: data.access_token,
      expiresAt,
    };
  }
}
