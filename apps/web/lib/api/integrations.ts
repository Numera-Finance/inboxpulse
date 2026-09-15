import { getIntegrationClient, API_BASE_URL } from './clients';
import type { Integration, IntegrationSource } from '@crm/clients';

/**
 * Get integration for a tenant and source
 */
export async function getIntegration(
  tenantId: string,
  source: IntegrationSource
): Promise<Integration | null> {
  const client = getIntegrationClient();
  return client.getByTenantAndSource(tenantId, source);
}

/**
 * Disconnect integration (stops watch and deactivates)
 */
export async function disconnectIntegration(
  tenantId: string,
  source: IntegrationSource
): Promise<void> {
  const client = getIntegrationClient();
  return client.disconnect(tenantId, source);
}

/**
 * Update integration parameters (settings like blacklist emails)
 */
export async function updateIntegrationParameters(
  integrationId: string,
  parameters: Record<string, any>
): Promise<void> {
  const client = getIntegrationClient();
  return client.updateParameters(integrationId, parameters);
}

/**
 * Get integration credentials (for reading settings like blacklist)
 */
export async function getIntegrationCredentials(
  tenantId: string,
  source: IntegrationSource
): Promise<Record<string, any> | null> {
  const client = getIntegrationClient();
  return client.getCredentials(tenantId, source);
}

/**
 * The Gmail OAuth entry point.
 *
 * One builder, because the flow is started from two places — the Connect button
 * and the "reconnect" action on an expired-state toast — and a divergence between
 * them is a query parameter the API silently does without.
 *
 * Identity is deliberately not passed. The API reads both the tenant and the user
 * from the session: the id this client holds is a better-auth id, and the audit
 * columns behind that call want a `users.id` uuid. `tenantId` is sent only so the
 * API can check it against the session and refuse a mismatch.
 */
export function gmailAuthorizeUrl(params: { tenantId: string }): string {
  const query = new URLSearchParams({ tenantId: params.tenantId });
  return `${API_BASE_URL}/oauth/gmail/authorize?${query.toString()}`;
}
