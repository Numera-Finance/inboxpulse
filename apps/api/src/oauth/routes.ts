import { Hono } from 'hono';
import { google } from 'googleapis';
import { container } from 'tsyringe';
import { GMAIL_SCOPE_URLS } from '@crm/shared';
import { IntegrationService } from '../integrations/service';
import { logger } from '../utils/logger';
import { internalFetch } from '../utils/internal-fetch';
import { getEnv } from '../env';
import { signOAuthState, verifyOAuthState, OAUTH_STATE_TTL_SECONDS } from './state';

const app = new Hono();

interface OAuthCredentials {
  clientId: string;
  clientSecret: string;
  source: 'integration' | 'environment';
}

/**
 * Resolve the OAuth client credentials for a tenant.
 *
 * `/authorize` and `/callback` MUST agree on these — Google validates the
 * client_id/redirect_uri pair at both ends — and they no longer have a shared
 * in-process store to pass them through, so they call this instead of each
 * resolving credentials in its own way.
 *
 * The client secret used to be accepted as a query parameter and stashed in the
 * state store for the callback to pick up. That is gone: a secret in a URL is a
 * secret in the Cloud Run request log, and nothing calls it — the web app sends
 * only tenantId and userId (apps/web/components/integrations/gmail-card.tsx).
 * First-time setup uses GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET, which are
 * required env vars on every crm-api instance.
 */
async function resolveOAuthCredentials(tenantId: string): Promise<OAuthCredentials> {
  const integrationService = container.resolve(IntegrationService);
  const credentials = await integrationService.getCredentials(tenantId, 'gmail');

  if (credentials?.clientId && credentials?.clientSecret) {
    return {
      clientId: credentials.clientId,
      clientSecret: credentials.clientSecret,
      source: 'integration',
    };
  }

  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } = getEnv();

  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    throw new Error(
      'OAuth credentials not found. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET, ' +
      'or store them on the tenant integration.'
    );
  }

  return {
    clientId: GOOGLE_CLIENT_ID,
    clientSecret: GOOGLE_CLIENT_SECRET,
    source: 'environment',
  };
}

/** Both endpoints must build the same redirect_uri or Google rejects the exchange. */
function getRedirectUri(): string {
  return `${getEnv().SERVICE_API_URL}/oauth/gmail/callback`;
}

/**
 * Where the user lands when the flow ends. `/integrations` is a `<Navigate replace>`
 * to the settings page that drops the query string, so link the real route directly
 * or the outcome is silently discarded.
 */
function webResultUrl(params: Record<string, string>): string {
  const query = new URLSearchParams({ tab: 'integrations', ...params });
  return `${getEnv().WEB_URL}/settings?${query.toString()}`;
}

/**
 * Initiate OAuth flow
 * GET /oauth/gmail/authorize?tenantId=xxx&userId=xxx
 *
 * This generates an authorization URL and redirects the user to Google's consent screen.
 * After authorization, Google will redirect back to /oauth/gmail/callback
 */
app.get('/gmail/authorize', async (c) => {
  const tenantId = c.req.query('tenantId');
  const userId = c.req.query('userId');

  if (!tenantId) {
    return c.json({ error: 'tenantId query parameter is required' }, 400);
  }

  try {
    const { clientId, clientSecret, source } = await resolveOAuthCredentials(tenantId);
    const redirectUri = getRedirectUri();

    const oAuth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);

    // Signed, self-contained CSRF token. Nothing about this request is retained
    // in the process — see ./state.ts for why.
    const state = signOAuthState({ tenantId, userId });

    const authUrl = oAuth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: GMAIL_SCOPE_URLS,
      prompt: 'consent', // Force consent to get refresh token
      state,
    });

    logger.info({ tenantId, redirectUri, credentialSource: source }, 'OAuth authorization initiated');

    // Redirect user to Google's consent screen
    return c.redirect(authUrl);
  } catch (error: any) {
    logger.error({ error, tenantId }, 'Failed to initiate OAuth flow');
    return c.json({ error: error.message }, 500);
  }
});

/**
 * OAuth callback endpoint
 * GET /oauth/gmail/callback?code=xxx&state=xxx
 *
 * Google redirects here after user authorizes.
 * We exchange the authorization code for tokens and save the refresh token.
 */
app.get('/gmail/callback', async (c) => {
  const code = c.req.query('code');
  const state = c.req.query('state');
  const error = c.req.query('error');

  // Handle authorization errors
  if (error) {
    logger.error({ error }, 'OAuth authorization failed');
    return c.html(`
      <html>
        <head><title>Authorization Failed</title></head>
        <body>
          <h1>Authorization Failed</h1>
          <p>Error: ${error}</p>
          <p>Please try again or contact support.</p>
        </body>
      </html>
    `, 400);
  }

  if (!code || !state) {
    return c.json({ error: 'Missing code or state parameter' }, 400);
  }

  // Verify state to prevent CSRF. A stale consent screen and a forged request are
  // reported separately: only the first is fixed by pressing the button again, and
  // rendering them identically is what made this failure unreadable.
  const verified = verifyOAuthState(state);

  if (verified.status === 'expired') {
    logger.warn(
      { ageSeconds: verified.ageSeconds, ttlSeconds: OAUTH_STATE_TTL_SECONDS },
      'OAuth state expired before the callback'
    );
    return c.redirect(webResultUrl({
      oauth: 'error',
      reason: 'expired',
      error: `This connection request expired after ${Math.round(OAUTH_STATE_TTL_SECONDS / 60)} minutes. Please connect Gmail again.`,
    }));
  }

  if (verified.status === 'invalid') {
    logger.error({ reason: verified.reason }, 'Rejected OAuth state');
    return c.redirect(webResultUrl({
      oauth: 'error',
      reason: 'invalid',
      error: 'This connection request could not be verified. Please start again from Settings.',
    }));
  }

  const { tenantId, userId } = verified.state;

  try {
    const integrationService = container.resolve(IntegrationService);

    // Same credentials and same redirect_uri as /authorize built, or Google
    // rejects the exchange.
    const { clientId, clientSecret } = await resolveOAuthCredentials(tenantId);
    const redirectUri = getRedirectUri();

    const oAuth2Client = new google.auth.OAuth2(
      clientId,
      clientSecret,
      redirectUri
    );

    // Exchange authorization code for tokens
    const { tokens } = await oAuth2Client.getToken(code);

    if (!tokens.refresh_token) {
      throw new Error(
        'No refresh token received. The user may need to revoke access first: ' +
        'https://myaccount.google.com/permissions'
      );
    }

    logger.info(
      {
        tenantId,
        scope: tokens.scope,
        hasRefreshToken: !!tokens.refresh_token
      },
      'OAuth tokens received'
    );

    // Set credentials first, then get user's email from Google
    oAuth2Client.setCredentials(tokens);
    const oauth2 = google.oauth2({ version: 'v2', auth: oAuth2Client });
    const { data: userInfo } = await oauth2.userinfo.get();
    const email = userInfo.email;

    if (!email) {
      throw new Error('Could not retrieve email from Google account');
    }

    logger.info({ tenantId, email }, 'Retrieved user email from Google');

    // Create or update integration based on email
    // Note: clientId and clientSecret are NOT stored in DB - they come from environment variables
    await integrationService.createOrUpdate({
      tenantId,
      authType: 'oauth',
      keys: {
        email,
        refreshToken: tokens.refresh_token,
        accessToken: tokens.access_token || undefined,
      },
      createdBy: userId,
    });

    logger.info({ tenantId, email }, 'OAuth integration created/updated successfully');

    // Auto-add tenant domains to blacklist to prevent collecting internal emails
    await integrationService.ensureTenantDomainsBlacklisted(tenantId, 'gmail');

    // Setup Gmail watch automatically
    try {
      const gmailServiceUrl = getEnv().SERVICE_GMAIL_URL;
      const watchResponse = await internalFetch(`${gmailServiceUrl}/api/watch?tenantId=${tenantId}`, {
        method: 'POST',
      });

      if (watchResponse.ok) {
        const watchData = await watchResponse.json();
        logger.info(
          { tenantId, watchExpiresAt: watchData.watchExpiresAt },
          'Gmail watch set up successfully after OAuth'
        );
      } else {
        const errorText = await watchResponse.text();
        logger.warn(
          { tenantId, status: watchResponse.status, error: errorText },
          'Failed to set up Gmail watch after OAuth - will need manual setup'
        );
      }
    } catch (watchError: any) {
      logger.warn(
        { tenantId, error: watchError.message },
        'Failed to set up Gmail watch after OAuth - will need manual setup'
      );
      // Don't fail the OAuth flow if watch setup fails
    }

    // Trigger initial sync to fetch historical emails (last 30 days)
    try {
      const gmailServiceUrl = getEnv().SERVICE_GMAIL_URL;
      const syncResponse = await internalFetch(`${gmailServiceUrl}/api/sync/${tenantId}/initial`, {
        method: 'POST',
      });

      if (syncResponse.ok) {
        const syncData = await syncResponse.json();
        logger.info(
          { tenantId, runId: syncData.runId },
          'Initial email sync triggered after OAuth'
        );
      } else {
        const errorText = await syncResponse.text();
        logger.warn(
          { tenantId, status: syncResponse.status, error: errorText },
          'Failed to trigger initial sync after OAuth'
        );
      }
    } catch (syncError: any) {
      logger.warn(
        { tenantId, error: syncError.message },
        'Failed to trigger initial sync after OAuth'
      );
      // Don't fail the OAuth flow if sync fails - user can manually trigger
    }

    // Redirect to web app integrations settings
    return c.redirect(webResultUrl({ oauth: 'success' }));
  } catch (error: any) {
    logger.error({ error, tenantId }, 'Failed to complete OAuth flow');

    // Redirect to web app with error
    return c.redirect(webResultUrl({
      oauth: 'error',
      reason: 'exchange-failed',
      error: error.message || 'Unknown error',
    }));
  }
});

export default app;
