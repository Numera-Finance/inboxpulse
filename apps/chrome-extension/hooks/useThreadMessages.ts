import { useQuery } from '@tanstack/react-query';
import { internalFetch, unwrap } from '../lib/internal-client';

/** One stored message in the open thread, with its text, for searching. */
export interface ThreadMessage {
  /** Gmail (provider) message id — what Gmail's location hash navigates to. */
  messageId: string;
  fromEmail: string;
  fromName: string | null;
  receivedAt: string;
  subject: string;
  /** Plain text of the message, converted server-side from the stored HTML. */
  bodyPreview?: string;
  /** True when the text was cut short server-side. */
  bodyTruncated?: boolean;
}

interface ThreadMessagesResult {
  messages: ThreadMessage[];
  isLoading: boolean;
  error: string | null;
  /** The thread has more stored messages than the API will return at once. */
  truncated: boolean;
}

/**
 * Every stored message in the open thread.
 *
 * Two callers with opposite needs, which is what `includeBody` is for. The
 * search box wants the text — that is the whole point of searching inside one
 * conversation, where every message shares a subject — and pays for it by
 * fetching lazily, only once the reader shows intent. The message picker wants
 * only envelopes, but wants them as soon as the thread opens, because a message
 * the CRM holds and Gmail has not rendered can be offered from nowhere else.
 *
 * The two are cached separately (`includeBody` is in the query key) rather than
 * sharing the heavier response: making the picker's eager fetch pull every
 * message body would put the panel's largest request on every thread the reader
 * so much as opens.
 *
 * These are the messages the CRM ingested, which is not always every message
 * Gmail shows — the sync drops most outbound mail, so a reader's own replies
 * generally aren't here. The picker fills those in from the page itself.
 */
export function useThreadMessages(
  threadId: string | null,
  enabled: boolean,
  includeBody = true,
): ThreadMessagesResult {
  const { data, isLoading, error } = useQuery<{
    messages: ThreadMessage[];
    truncated: boolean;
  }>({
    queryKey: ['thread', 'messages', threadId, includeBody],
    queryFn: async () => {
      if (!threadId) return { messages: [], truncated: false };
      const res = await internalFetch(
        `/api/internal/emails/thread/${encodeURIComponent(threadId)}/messages${
          includeBody ? '?includeBody=1' : ''
        }`,
      );
      if (!res.ok) {
        throw new Error(res.error ?? `Failed to fetch thread messages (${res.status})`);
      }
      const body = unwrap<{ messages: ThreadMessage[]; truncated: boolean }>(res.json);
      return { messages: body.messages ?? [], truncated: body.truncated ?? false };
    },
    enabled: enabled && !!threadId,
    staleTime: 60_000,
  });

  return {
    messages: data?.messages ?? [],
    isLoading: enabled && !!threadId && isLoading,
    error: error ? (error as Error).message : null,
    truncated: data?.truncated ?? false,
  };
}
