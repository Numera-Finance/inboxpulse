import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as api from '@/lib/api';
import type {
  AssignContactCustomerRequest,
  AssignContactCustomerResponse,
  Contact,
  CreateContactRequest,
} from '@crm/clients';

// Query keys for cache management
export const contactKeys = {
  all: ['contacts'] as const,
  byCustomer: (customerId: string) => [...contactKeys.all, 'customer', customerId] as const,
  byTenant: (tenantId: string) => [...contactKeys.all, 'tenant', tenantId] as const,
  detail: (id: string) => [...contactKeys.all, 'detail', id] as const,
};

/**
 * Hook to get contacts for a customer
 */
export function useContactsByCustomer(customerId: string) {
  return useQuery({
    queryKey: contactKeys.byCustomer(customerId),
    queryFn: () => api.getContactsByCustomer(customerId),
    enabled: !!customerId,
  });
}

/**
 * Hook to get contacts for a tenant
 */
export function useContactsByTenant(tenantId: string) {
  return useQuery({
    queryKey: contactKeys.byTenant(tenantId),
    queryFn: () => api.getContactsByTenant(tenantId),
    enabled: !!tenantId,
  });
}

/**
 * Hook to create or update a contact
 */
export function useUpsertContact() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateContactRequest) => api.upsertContact(data),
    onSuccess: (contact) => {
      // Invalidate related queries
      queryClient.invalidateQueries({ queryKey: contactKeys.all });
    },
  });
}

/**
 * Hook to assign an email address to a customer.
 *
 * Broader invalidation than a plain contact write: the call re-links existing
 * emails and may create tasks, so the analyzed-email lists, the customers list
 * (escalation counts) and tasks are all stale afterwards.
 */
export function useAssignContactCustomer() {
  const queryClient = useQueryClient();

  return useMutation<AssignContactCustomerResponse, Error, AssignContactCustomerRequest>({
    mutationFn: (data) => api.assignContactCustomer(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: contactKeys.all });
      queryClient.invalidateQueries({ queryKey: ['emails'] });
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
    },
  });
}

/**
 * Hook to update a contact
 */
export function useUpdateContact() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<CreateContactRequest> }) =>
      api.updateContact(id, data),
    onSuccess: (contact) => {
      queryClient.setQueryData(contactKeys.detail(contact.id), contact);
      queryClient.invalidateQueries({ queryKey: contactKeys.all });
    },
  });
}
