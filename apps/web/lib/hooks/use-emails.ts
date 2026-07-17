import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { UpdateEmailSignalsRequest } from '@crm/clients';
import * as api from '@/lib/api';

// Query keys for cache management
export const emailKeys = {
  all: ['emails'] as const,
  byCustomer: (
    tenantId: string,
    customerId: string,
    options?: {
      limit?: number;
      offset?: number;
      sentiment?: 'positive' | 'negative' | 'neutral';
      signal?: 'upsell' | 'churn';
      tatViolation?: boolean;
      dateFrom?: string;
      dateTo?: string;
    }
  ) => [...emailKeys.all, 'customer', tenantId, customerId, options] as const,
};

/**
 * Hook to get emails for a customer (via domain matching)
 * Supports filtering by sentiment, signal (upsell/churn), TAT violations, and date range
 */
export function useEmailsByCustomer(
  tenantId: string,
  customerId: string,
  options?: {
    limit?: number;
    offset?: number;
    sentiment?: 'positive' | 'negative' | 'neutral';
    signal?: 'upsell' | 'churn';
    tatViolation?: boolean;
    dateFrom?: string;
    dateTo?: string;
  }
) {
  return useQuery({
    queryKey: emailKeys.byCustomer(tenantId, customerId, options),
    queryFn: () => api.getEmailsByCustomer(tenantId, customerId, options),
    enabled: !!tenantId && !!customerId,
  });
}

/**
 * Hook to manually override an email's signals (sentiment / churn / tags).
 * Invalidates customer-scoped email lists so the churn/sentiment views refresh.
 * The inbox list/detail are fetched imperatively and refreshed by the caller.
 */
export function useUpdateEmailSignals() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ emailId, request }: { emailId: string; request: UpdateEmailSignalsRequest }) =>
      api.updateEmailSignals(emailId, request),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: emailKeys.all });
    },
  });
}

