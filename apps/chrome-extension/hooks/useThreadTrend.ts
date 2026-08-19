import { useQuery } from '@tanstack/react-query';
import { internalFetch, unwrap } from '../lib/internal-client';

export type Sentiment = 'positive' | 'neutral' | 'negative';

export interface TrendPoint {
  /** Gmail (provider) message id — lets the panel pick out the open message. */
  messageId: string;
  score: number;
  sentiment: Sentiment;
  receivedAt: string;
  isCustomer: boolean;
}

interface ThreadTrendResult {
  points: TrendPoint[];
  isLoading: boolean;
  error: string | null;
}

/**
 * Per-message sentiment for the open thread, oldest → newest.
 *
 * Same endpoint the Gmail add-on's "Trend, this thread" card uses, reached
 * through the session-authenticated mount (`/api/emails/...`) rather than the
 * internal one — the router is mounted at both paths in the API, so the add-on
 * and the sidebar read identical data.
 *
 * Returns [] rather than throwing when nothing in the thread is scored: an
 * unscored thread is the common case, not an error.
 */
export function useThreadTrend(threadId: string | null): ThreadTrendResult {
  const { data, isLoading, error } = useQuery<TrendPoint[]>({
    queryKey: ['thread', 'trend', threadId],
    queryFn: async () => {
      if (!threadId) return [];
      const res = await internalFetch(
        `/api/internal/emails/thread/${encodeURIComponent(threadId)}/trend`,
      );
      if (!res.ok) {
        throw new Error(res.error ?? `Failed to fetch thread trend (${res.status})`);
      }
      return unwrap<{ points: TrendPoint[] }>(res.json).points ?? [];
    },
    enabled: !!threadId,
    staleTime: 60_000,
  });

  return {
    points: data ?? [],
    isLoading: !!threadId && isLoading,
    error: error ? (error as Error).message : null,
  };
}
