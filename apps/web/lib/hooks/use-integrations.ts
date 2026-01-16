import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as api from '@/lib/api';
import type { IntegrationSource } from '@/lib/api';

// Query keys for cache management
export const integrationKeys = {
  all: ['integrations'] as const,
  byTenantAndSource: (tenantId: string, source: IntegrationSource) =>
    [...integrationKeys.all, tenantId, source] as const,
  credentials: (tenantId: string, source: IntegrationSource) =>
    [...integrationKeys.all, tenantId, source, 'credentials'] as const,
};

/**
 * Hook to get Gmail integration status for a tenant
 */
export function useGmailIntegration(tenantId: string) {
  return useQuery({
    queryKey: integrationKeys.byTenantAndSource(tenantId, 'gmail'),
    queryFn: () => api.getIntegration(tenantId, 'gmail'),
    enabled: !!tenantId,
  });
}

/**
 * Hook to get integration credentials (for reading settings like blacklist)
 */
export function useIntegrationCredentials(tenantId: string, source: IntegrationSource) {
  return useQuery({
    queryKey: integrationKeys.credentials(tenantId, source),
    queryFn: () => api.getIntegrationCredentials(tenantId, source),
    enabled: !!tenantId,
  });
}

/**
 * Hook to disconnect an integration
 */
export function useDisconnectIntegration() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ tenantId, source }: { tenantId: string; source: IntegrationSource }) =>
      api.disconnectIntegration(tenantId, source),
    onSuccess: (_, { tenantId, source }) => {
      // Invalidate the integration query to refetch
      queryClient.invalidateQueries({
        queryKey: integrationKeys.byTenantAndSource(tenantId, source),
      });
    },
  });
}

/**
 * Hook to update integration parameters (settings like blacklist emails)
 */
export function useUpdateIntegrationParameters() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      integrationId,
      parameters,
    }: {
      integrationId: string;
      tenantId: string;
      source: IntegrationSource;
      parameters: Record<string, any>;
    }) => api.updateIntegrationParameters(integrationId, parameters),
    onSuccess: (_, { tenantId, source }) => {
      // Invalidate the credentials query to refetch
      queryClient.invalidateQueries({
        queryKey: integrationKeys.credentials(tenantId, source),
      });
    },
  });
}
