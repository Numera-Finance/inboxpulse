import { useQuery } from '@tanstack/react-query';
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

