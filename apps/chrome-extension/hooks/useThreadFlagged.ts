import { useQuery } from '@tanstack/react-query';
import { internalFetch, unwrap } from '../lib/internal-client';

export interface FlaggedFlag {
  type: string;
  label: string;
  detail?: string;
  provenance: string;
  /**
   * Raw risk level on churn flags (low | medium | high | critical), carried
   * alongside the label so the panel can style by risk without parsing
   * "Churn risk · Low" back apart.
   */
  level?: string;
}

export interface FlaggedMessage {
  /** Gmail (provider) message id — what Gmail's location hash navigates to. */
  messageId: string;
  fromEmail: string;
  fromName: string | null;
  receivedAt: string;
  subject: string;
  severity: number;
  flags: FlaggedFlag[];
  /**
   * How the message text begins, converted server-side from the stored HTML.
   *
   * Not shown anywhere — it's what lets a click find this message in Gmail when
   * the stored id belongs to a colleague's mailbox rather than the reader's.
   * See `MessageDescriptor` in lib/message-registry.ts.
   */
  bodyPreview?: string;
}

interface ThreadFlaggedResult {
  messages: FlaggedMessage[];
  isLoading: boolean;
  error: string | null;
}

/**
 * Flagged messages in the open thread — the messages carrying an actionable
 * signal (at risk / churn / competitor / upsell / kudos / negative sentiment),
 * each with its "why" reason and provenance.
 *
 * Hits the same endpoint the Gmail add-on uses, via the session-authenticated
 * mount (`/api/emails/...`) rather than the internal one — the router is mounted
 * at both paths in the API, so no new endpoint was needed.
 *
 * The API sorts most-severe-first; we re-sort oldest→newest here so the list
 * reads as the thread's timeline.
 */
export function useThreadFlagged(threadId: string | null): ThreadFlaggedResult {
  const { data, isLoading, error } = useQuery<FlaggedMessage[]>({
    queryKey: ['thread', 'flagged', threadId],
    queryFn: async () => {
      if (!threadId) return [];
      const res = await internalFetch(
        `/api/internal/emails/thread/${encodeURIComponent(threadId)}/flagged?includeBody=1`,
      );
      if (!res.ok) {
        throw new Error(res.error ?? `Failed to fetch flagged messages (${res.status})`);
      }
      return unwrap<{ messages: FlaggedMessage[] }>(res.json).messages ?? [];
    },
    enabled: !!threadId,
    staleTime: 60_000,
  });

  const messages = [...(data ?? [])].sort(
    (a, b) => new Date(a.receivedAt).getTime() - new Date(b.receivedAt).getTime(),
  );

  return {
    messages,
    isLoading: !!threadId && isLoading,
    error: error ? (error as Error).message : null,
  };
}
