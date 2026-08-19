import { useQuery } from '@tanstack/react-query';
import { internalFetch, unwrap } from '../lib/internal-client';

/** One related conversation the drop bar offers. */
export interface ContextCandidate {
  messageId: string;
  /** Gmail's own thread id — what navigation opens. */
  threadId: string;
  subject: string;
  from: string;
  date: string;
  snippet: string;
}

export interface ThreadContextResult {
  intent: string | null;
  query: string | null;
  candidates: ContextCandidate[];
  /** Why the list is empty, when it is. */
  reason: string | null;
  isLoading: boolean;
  error: string | null;
}

/**
 * Conversations worth reading alongside the open one.
 *
 * `enabled` is the drop bar's own open state, not a readiness flag: the request
 * reaches out to live Gmail and costs a search plus one metadata fetch per
 * candidate, which is far too much to spend on every conversation a reader
 * passes through. Nothing is fetched until they ask for it.
 *
 * Cached for the session once opened — the mailbox does not change underneath
 * a reader fast enough to justify re-running a multi-call search on every
 * re-expand.
 */
export function useThreadContext(
  threadId: string | null,
  enabled: boolean,
  viewerEmail?: string | null,
): ThreadContextResult {
  const { data, isLoading, error } = useQuery({
    queryKey: ['thread', 'context', threadId, viewerEmail],
    queryFn: async () => {
      if (!threadId) return null;
      const viewer = viewerEmail ? `?viewer=${encodeURIComponent(viewerEmail)}` : '';
      const res = await internalFetch(
        `/api/internal/emails/thread/${encodeURIComponent(threadId)}/context${viewer}`,
      );
      if (!res.ok) {
        throw new Error(res.error ?? `Failed to search for context (${res.status})`);
      }
      return unwrap<{
        intent: string | null;
        query: string | null;
        candidates: ContextCandidate[];
        reason?: string;
      }>(res.json);
    },
    enabled: !!threadId && enabled,
    staleTime: 5 * 60_000,
  });

  return {
    intent: data?.intent ?? null,
    query: data?.query ?? null,
    candidates: data?.candidates ?? [],
    reason: data?.reason ?? null,
    isLoading: !!threadId && enabled && isLoading,
    error: error ? (error as Error).message : null,
  };
}
