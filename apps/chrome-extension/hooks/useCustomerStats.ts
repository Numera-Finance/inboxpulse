import { useQuery } from '@tanstack/react-query';
import { internalFetch, unwrap } from '../lib/internal-client';

/** The ranges the Stats block offers. `all` reads the customer's rollups. */
export type StatsRange = 'all' | '7d' | '30d' | '90d' | '12m';

export const STATS_RANGE_LABELS: Record<StatsRange, string> = {
  all: 'All time',
  '7d': 'Last 7 days',
  '30d': 'Last 30 days',
  '90d': 'Last 90 days',
  '12m': 'Last 12 months',
};

const RANGE_DAYS: Record<Exclude<StatsRange, 'all'>, number> = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
  '12m': 365,
};

export interface CustomerSignalStats {
  emailCount: number;
  escalationCount: number;
  upsellCount: number;
  churnCount: number;
  positiveCount: number;
  lastContactDate: string | null;
}

interface CustomerStatsResult {
  stats: CustomerSignalStats | null;
  isLoading: boolean;
  error: string | null;
}

/**
 * Start of a range, as an ISO timestamp. Computed once per query key rather than
 * per render so the key stays stable — a fresh `new Date()` on every render
 * would produce a new key each time and refetch forever.
 */
export function statsRangeStart(range: Exclude<StatsRange, 'all'>): string {
  const start = new Date();
  start.setDate(start.getDate() - RANGE_DAYS[range]);
  start.setHours(0, 0, 0, 0);
  return start.toISOString();
}

/** Day-granular key part, so the query is stable within a day but not stale across one. */
function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Signal counts for one customer over a date range.
 *
 * Disabled for `all`: those figures already ride along on the customer record
 * the panel has fetched, so asking the API again would be a redundant round trip
 * for an answer we hold. The caller falls back to the record in that case.
 */
export function useCustomerStats(
  customerId: string | null,
  range: StatsRange,
): CustomerStatsResult {
  const enabled = !!customerId && range !== 'all';

  const { data, isLoading, error } = useQuery<CustomerSignalStats>({
    queryKey: ['customer', 'stats', customerId, range, todayKey()],
    queryFn: async () => {
      if (!customerId || range === 'all') {
        throw new Error('range stats requested without a customer');
      }
      const from = encodeURIComponent(statsRangeStart(range));
      const res = await internalFetch(
        `/api/internal/emails/customer/${encodeURIComponent(customerId)}/stats?from=${from}`,
      );
      if (!res.ok) {
        throw new Error(res.error ?? `Failed to fetch stats (${res.status})`);
      }
      return unwrap<CustomerSignalStats>(res.json) as CustomerSignalStats;
    },
    enabled,
    staleTime: 60_000,
  });

  return {
    stats: data ?? null,
    isLoading: enabled && isLoading,
    error: error ? (error as Error).message : null,
  };
}
