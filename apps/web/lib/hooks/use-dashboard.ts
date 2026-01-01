import { useQuery } from '@tanstack/react-query';
import { SearchOperator } from '@crm/shared';
import * as api from '@/lib/api';
import type { TileFilters } from '@/components/dashboard/tiles';

// Query keys for cache management
export const dashboardKeys = {
  all: ['dashboard'] as const,
  customers: (filters?: TileFilters) => [...dashboardKeys.all, 'customers', filters] as const,
  emails: (filters?: TileFilters) => [...dashboardKeys.all, 'emails', filters] as const,
  escalations: (filters?: TileFilters) => [...dashboardKeys.all, 'escalations', filters] as const,
  opportunities: (filters?: TileFilters) => [...dashboardKeys.all, 'opportunities', filters] as const,
  sentiment: (filters?: TileFilters) => [...dashboardKeys.all, 'sentiment', filters] as const,
};

// Shared query options for dashboard tiles
const DASHBOARD_QUERY_OPTIONS = {
  staleTime: 2 * 60 * 1000, // 2 minutes
  gcTime: 5 * 60 * 1000, // 5 minutes
  retry: 3,
  retryDelay: (attemptIndex: number) => Math.min(1000 * 2 ** attemptIndex, 30000),
  refetchOnWindowFocus: false,
};

/**
 * Hook for customer count dashboard tile
 * Uses customer search API to get total count
 */
export function useDashboardCustomers(filters?: TileFilters) {
  return useQuery({
    queryKey: dashboardKeys.customers(filters),
    queryFn: async () => {
      const queries: api.SearchRequest['queries'] = [];

      // Add customer filter if specified
      if (filters?.customerId) {
        queries.push({
          field: 'id',
          operator: SearchOperator.EQUALS,
          value: filters.customerId,
        });
      }

      const result = await api.searchCustomers({
        queries,
        sortOrder: 'asc',
        limit: 1, // We only need the count
        offset: 0,
      });
      return {
        value: result.total,
        change: '+0%', // TODO: Calculate from historical data
      };
    },
    ...DASHBOARD_QUERY_OPTIONS,
  });
}

/**
 * Hook for escalation count dashboard tile
 * Uses task search API to get open escalation tasks
 */
export function useDashboardEscalations(filters?: TileFilters) {
  return useQuery({
    queryKey: dashboardKeys.escalations(filters),
    queryFn: async () => {
      const request: api.TaskSearchRequest = {
        status: 'open',
        limit: 1, // We only need the count
        offset: 0,
      };

      // Add filters
      if (filters?.customerId) {
        request.customerId = filters.customerId;
      }
      if (filters?.userId) {
        request.assignedToId = filters.userId;
      }
      if (filters?.dateFrom) {
        request.dateFrom = filters.dateFrom;
      }
      if (filters?.dateTo) {
        request.dateTo = filters.dateTo;
      }

      const result = await api.searchTasks(request);
      return {
        value: result.total,
        change: '+0 new', // TODO: Calculate new since last period
      };
    },
    ...DASHBOARD_QUERY_OPTIONS,
  });
}

/**
 * Hook for email count dashboard tile
 * Uses /api/emails/stats endpoint
 */
export function useDashboardEmails(filters?: TileFilters) {
  return useQuery({
    queryKey: dashboardKeys.emails(filters),
    queryFn: async () => {
      const stats = await api.getDashboardEmailStats({
        customerId: filters?.customerId,
        dateFrom: filters?.dateFrom,
        dateTo: filters?.dateTo,
      });

      // Format the value (e.g., 15200 -> "15.2K")
      const formatValue = (num: number): string => {
        if (num >= 1000) {
          return `${(num / 1000).toFixed(1)}K`;
        }
        return num.toString();
      };

      return {
        value: formatValue(stats.total),
        change: stats.analyzed > 0 ? `${Math.round((stats.analyzed / stats.total) * 100)}% analyzed` : '0% analyzed',
      };
    },
    ...DASHBOARD_QUERY_OPTIONS,
  });
}

/**
 * Hook for upsell opportunities dashboard tile
 * Uses /api/emails/upsell-count endpoint
 */
export function useDashboardOpportunities(filters?: TileFilters) {
  return useQuery({
    queryKey: dashboardKeys.opportunities(filters),
    queryFn: async () => {
      const count = await api.getDashboardUpsellCount({
        customerId: filters?.customerId,
        dateFrom: filters?.dateFrom,
        dateTo: filters?.dateTo,
      });

      return {
        value: count,
        change: '+0 this week', // TODO: Calculate from historical data
      };
    },
    ...DASHBOARD_QUERY_OPTIONS,
  });
}

// Sentiment pie chart data
export interface SentimentData {
  pieData: Array<{ name: string; value: number }>
}

/**
 * Hook for sentiment chart data
 * Uses /api/emails/sentiment-stats endpoint
 */
export function useDashboardSentiment(filters?: TileFilters) {
  return useQuery({
    queryKey: dashboardKeys.sentiment(filters),
    queryFn: async (): Promise<SentimentData> => {
      const stats = await api.getDashboardSentimentStats({
        customerId: filters?.customerId,
        dateFrom: filters?.dateFrom,
        dateTo: filters?.dateTo,
      });

      // Calculate percentages
      const total = stats.positive + stats.neutral + stats.negative;
      if (total === 0) {
        return {
          pieData: [
            { name: 'Positive', value: 0 },
            { name: 'Neutral', value: 0 },
            { name: 'Negative', value: 0 },
          ],
        };
      }

      return {
        pieData: [
          { name: 'Positive', value: Math.round((stats.positive / total) * 100) },
          { name: 'Neutral', value: Math.round((stats.neutral / total) * 100) },
          { name: 'Negative', value: Math.round((stats.negative / total) * 100) },
        ],
      };
    },
    ...DASHBOARD_QUERY_OPTIONS,
  });
}
