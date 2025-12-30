import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as api from '@/lib/api';
import type { SearchRequest, Customer, CreateCustomerRequest } from '@/lib/api';

// Query keys for cache management
export const customerKeys = {
  all: ['customers'] as const,
  lists: () => [...customerKeys.all, 'list'] as const,
  list: (filters: SearchRequest) => [...customerKeys.lists(), filters] as const,
  byTenant: (tenantId: string) => [...customerKeys.all, 'tenant', tenantId] as const,
  details: () => [...customerKeys.all, 'detail'] as const,
  detail: (id: string) => [...customerKeys.details(), id] as const,
  byDomain: (tenantId: string, domain: string) =>
    [...customerKeys.all, 'domain', tenantId, domain] as const,
};


/**
 * Hook to search/list customers with pagination and filtering
 */
export function useCustomers(request: SearchRequest) {
  return useQuery({
    queryKey: customerKeys.list(request),
    queryFn: () => api.searchCustomers(request),
  });
}

/**
 * Hook to get all customers for a tenant
 */
export function useCustomersByTenant(tenantId: string) {
  return useQuery({
    queryKey: customerKeys.byTenant(tenantId),
    queryFn: () => api.getCustomersByTenant(tenantId),
    enabled: !!tenantId,
  });
}

/**
 * Hook to get a single customer by ID
 */
export function useCustomer(id: string) {
  return useQuery({
    queryKey: customerKeys.detail(id),
    queryFn: () => api.getCustomer(id),
    enabled: !!id,
  });
}

/**
 * Hook to get a customer by domain
 */
export function useCustomerByDomain(tenantId: string, domain: string) {
  return useQuery({
    queryKey: customerKeys.byDomain(tenantId, domain),
    queryFn: () => api.getCustomerByDomain(tenantId, domain),
    enabled: !!tenantId && !!domain,
  });
}

/**
 * Hook to create or update a customer
 */
export function useUpsertCustomer() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateCustomerRequest) => api.upsertCustomer(data),
    onSuccess: (customer) => {
      // Update the cache for this specific customer
      queryClient.setQueryData(customerKeys.detail(customer.id), customer);
      // Invalidate lists to refetch
      queryClient.invalidateQueries({ queryKey: customerKeys.lists() });
      queryClient.invalidateQueries({ queryKey: customerKeys.byTenant(customer.tenantId) });
    },
  });
}

/**
 * Hook to update customer fields (name, labels, metadata, etc.)
 */
export function useUpdateCustomer() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      id,
      data,
    }: {
      id: string;
      data: {
        name?: string;
        website?: string | null;
        industry?: string | null;
        labels?: string[];
        metadata?: Record<string, any> | null;
      };
    }) => api.updateCustomer(id, data),
    onSuccess: (customer) => {
      // Update the cache for this specific customer
      queryClient.setQueryData(customerKeys.detail(customer.id), customer);
      // Invalidate lists to refetch
      queryClient.invalidateQueries({ queryKey: customerKeys.lists() });
      queryClient.invalidateQueries({ queryKey: customerKeys.byTenant(customer.tenantId) });
    },
  });
}
