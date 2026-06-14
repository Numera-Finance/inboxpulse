import { useQuery } from '@tanstack/react-query';
import { getSentimentFromSignals } from '@crm/shared';
import { API_BASE_URL } from '../lib/clients';

interface ResolvedEmail {
  id: string;
  messageId: string;
  threadId: string;
  subject: string | null;
  receivedAt: string | null;
  signals: number[] | null;
  customerId: string;
}

export interface ThreadNegativeEmail {
  id: string;
  subject: string;
  receivedAt: string | null;
}

interface ThreadCustomerResult {
  /** The customer this thread belongs to (resolved via the email→customer link). */
  customerId: string | null;
  /** Negative-sentiment emails present in this thread. */
  negativeEmails: ThreadNegativeEmail[];
  isLoading: boolean;
  error: string | null;
}

/**
 * Resolve the open Gmail thread to a customer authoritatively: we send the
 * thread's Gmail message IDs to the backend, which returns the linked customer
 * and sentiment signals for each stored email. This is far more reliable than
 * guessing the customer from the sender's domain (personal Gmail addresses,
 * shared/free domains, etc.). When several customers appear in one thread (e.g.
 * a forward), we pick the one that owns the most messages.
 */
export function useThreadCustomer(threadMessageIds: string[]): ThreadCustomerResult {
  const { data, isLoading, error } = useQuery<ResolvedEmail[]>({
    queryKey: ['thread', 'resolve', [...threadMessageIds].sort()],
    queryFn: async () => {
      if (threadMessageIds.length === 0) return [];
      const response = await fetch(`${API_BASE_URL}/api/emails/resolve-by-messages`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messageIds: threadMessageIds }),
      });
      if (!response.ok) {
        throw new Error(`Failed to resolve thread: ${response.statusText}`);
      }
      const json = (await response.json()) as {
        success: boolean;
        data?: { emails: ResolvedEmail[] };
      };
      return json.data?.emails ?? [];
    },
    enabled: threadMessageIds.length > 0,
    staleTime: 60_000,
  });

  const resolved = data ?? [];

  // Pick the customer that owns the most messages in the thread.
  const counts = new Map<string, number>();
  for (const email of resolved) {
    counts.set(email.customerId, (counts.get(email.customerId) ?? 0) + 1);
  }
  const customerId =
    [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  // Only surface negatives belonging to the resolved customer — a thread can
  // contain emails from more than one customer (forwards/quotes), and we render
  // these under the single resolved customer.id. Use the shared sentiment helper
  // so classification matches the rest of the app (positive takes precedence on
  // mixed-signal emails).
  const negativeEmails: ThreadNegativeEmail[] = resolved
    .filter(
      (email) =>
        email.customerId === customerId &&
        getSentimentFromSignals(email.signals) === 'negative',
    )
    .map((email) => ({
      id: email.id,
      subject: email.subject ?? '',
      receivedAt: email.receivedAt,
    }));

  return {
    customerId,
    negativeEmails,
    isLoading: threadMessageIds.length > 0 && isLoading,
    error: error ? (error as Error).message : null,
  };
}
