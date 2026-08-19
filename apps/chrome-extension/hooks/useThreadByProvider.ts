import { useQuery } from '@tanstack/react-query';
import { internalFetch, unwrap } from '../lib/internal-client';

/**
 * The CRM's thread id for the open Gmail conversation, resolved from Gmail's own
 * thread id.
 *
 * This exists because resolving through message ids ties the thread-scoped
 * sections to the reader's selection. Gmail builds views only for the messages
 * it has loaded — frequently one, frequently the reader's own reply, which the
 * sync drops — so trend, flagged messages and search were present only when an
 * ingested message happened to be the one open, and disappeared on clicking a
 * neighbouring email in the same conversation. A conversation's id is a property
 * of the conversation.
 *
 * Uses the endpoint the add-on already had for exactly this reason ("lets the
 * add-on show thread-level trend/flagged even on an untracked open message").
 *
 * Not a total fix for identity: provider thread ids are per-mailbox in the same
 * way message ids are, so a conversation ingested from a colleague's mailbox
 * won't be found by this reader's id either. It resolves strictly more cases
 * than the message-id path, and the caller keeps that as a fallback.
 */
export function useThreadByProvider(providerThreadId: string | null): {
  threadId: string | null;
  isLoading: boolean;
} {
  const { data, isLoading } = useQuery<string | null>({
    queryKey: ['thread', 'by-provider', providerThreadId],
    queryFn: async () => {
      if (!providerThreadId) return null;
      const res = await internalFetch(
        `/api/internal/emails/thread/by-provider/${encodeURIComponent(providerThreadId)}`,
      );
      if (!res.ok) {
        // A conversation the CRM never ingested is an ordinary outcome here,
        // not a failure worth surfacing or retrying.
        return null;
      }
      return unwrap<{ threadId: string | null }>(res.json).threadId ?? null;
    },
    enabled: !!providerThreadId,
    staleTime: 5 * 60_000,
  });

  return {
    threadId: data ?? null,
    isLoading: !!providerThreadId && isLoading,
  };
}
