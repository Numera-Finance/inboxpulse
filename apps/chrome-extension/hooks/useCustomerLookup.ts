import { useQuery } from '@tanstack/react-query';
import type { Customer } from '@crm/clients';
import { API_BASE_URL } from '../lib/clients';

interface CustomerLookupResult {
  customer: Customer | null;
  isLoading: boolean;
  error: string | null;
}

/**
 * Look up a customer by their email domain using GET /api/customers/domain/:domain.
 * Uses direct fetch since CustomerClient.getCustomerByDomain requires a tenantId param,
 * but the protected endpoint derives tenantId from the session automatically.
 */
export function useCustomerLookup(domain: string | null): CustomerLookupResult {
  const { data, isLoading, error } = useQuery<Customer | null>({
    queryKey: ['customer', 'domain', domain],
    queryFn: async () => {
      if (!domain) return null;
      const response = await fetch(
        `${API_BASE_URL}/api/customers/domain/${encodeURIComponent(domain)}`,
        { credentials: 'include' },
      );
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(`Failed to lookup customer: ${response.statusText}`);
      const json = (await response.json()) as { success: boolean; data?: Customer };
      return json.data ?? null;
    },
    enabled: !!domain,
    staleTime: 60_000,
  });

  return {
    customer: data ?? null,
    isLoading: !!domain && isLoading,
    error: error ? (error as Error).message : null,
  };
}

/**
 * Look up an enriched customer by ID using GET /api/customers/:id. Used after
 * resolving a thread to its customer via the email→customer link.
 */
export function useCustomerById(customerId: string | null): CustomerLookupResult {
  const { data, isLoading, error } = useQuery<Customer | null>({
    queryKey: ['customer', 'id', customerId],
    queryFn: async () => {
      if (!customerId) return null;
      const response = await fetch(
        `${API_BASE_URL}/api/customers/${encodeURIComponent(customerId)}?stats=true`,
        { credentials: 'include' },
      );
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(`Failed to load customer: ${response.statusText}`);
      const json = (await response.json()) as { success: boolean; data?: Customer };
      return json.data ?? null;
    },
    enabled: !!customerId,
    staleTime: 60_000,
  });

  return {
    customer: data ?? null,
    isLoading: !!customerId && isLoading,
    error: error ? (error as Error).message : null,
  };
}
