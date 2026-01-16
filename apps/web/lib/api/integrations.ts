import { getIntegrationClient } from './clients';
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
