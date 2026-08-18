import { useQuery } from '@tanstack/react-query';
import { getSentimentFromSignals } from '@crm/shared';
import { internalFetch, unwrap } from '../lib/internal-client';

/** One address on an email's envelope, as stored. */
export interface EmailAddress {
  email: string;
  name?: string;
}

interface ResolvedEmail {
  id: string;
  messageId: string;
  threadId: string;
  subject: string | null;
  receivedAt: string | null;
  signals: number[] | null;
  customerId: string;
  fromEmail: string | null;
  fromName: string | null;
  tos: EmailAddress[] | null;
  ccs: EmailAddress[] | null;
}

/** The stored envelope for one message, keyed out for the "Selected" block. */
export interface MessageEnvelope {
  messageId: string;
  fromEmail: string | null;
  fromName: string | null;
  tos: EmailAddress[];
  ccs: EmailAddress[];
  subject: string | null;
  receivedAt: string | null;
}

export interface ThreadNegativeEmail {
  id: string;
  subject: string;
  receivedAt: string | null;
}

interface ThreadCustomerResult {
  /** The customer this thread belongs to (resolved via the email→customer link). */
  customerId: string | null;
  /** InboxPulse thread id for the open conversation, for thread-scoped lookups. */
  threadId: string | null;
  /** Negative-sentiment emails present in this thread. */
  negativeEmails: ThreadNegativeEmail[];
  /**
   * Stored envelope per Gmail message id, for the "Selected" block. Comes from
   * the resolve call the panel already makes, so reading it costs nothing extra.
   */
  envelopes: Map<string, MessageEnvelope>;
  isLoading: boolean;
  error: string | null;
  /**
   * Resolution diagnostics. "No customer linked" has two very different causes
   * that look identical in the UI: none of the thread's Gmail message ids matched
   * a stored email, or they matched but carried no customer link (customerId
   * comes from an email_participants join, which is known to be missing rows).
   * Surfacing the counts tells the two apart without a database session.
   */
  diagnostics: {
    /** Gmail message ids sent for resolution. */
    sent: number;
    /** Stored emails matched. */
    matched: number;
    /** Of those, how many carried a customerId. */
    linked: number;
  };
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
      const res = await internalFetch('/api/internal/emails/resolve-by-messages', {
        method: 'POST',
        body: { messageIds: threadMessageIds.slice(0, 100), provider: 'gmail' },
      });
      if (!res.ok) {
        throw new Error(res.error ?? `Failed to resolve thread (${res.status})`);
      }
      return unwrap<{ emails: ResolvedEmail[] }>(res.json).emails ?? [];
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

  // Thread id of the resolved customer's messages. A forward can pull in emails
  // from more than one stored thread, so take the one owning the most messages —
  // the same tie-break used for the customer above.
  const threadCounts = new Map<string, number>();
  for (const email of resolved) {
    if (email.customerId !== customerId || !email.threadId) continue;
    threadCounts.set(email.threadId, (threadCounts.get(email.threadId) ?? 0) + 1);
  }
  const threadId = [...threadCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

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

  // Keyed on the Gmail message id, which is what the open-message store reports.
  const envelopes = new Map<string, MessageEnvelope>();
  for (const email of resolved) {
    envelopes.set(email.messageId, {
      messageId: email.messageId,
      fromEmail: email.fromEmail,
      fromName: email.fromName,
      tos: email.tos ?? [],
      ccs: email.ccs ?? [],
      subject: email.subject,
      receivedAt: email.receivedAt,
    });
  }

  return {
    customerId,
    threadId,
    negativeEmails,
    envelopes,
    isLoading: threadMessageIds.length > 0 && isLoading,
    error: error ? (error as Error).message : null,
    diagnostics: {
      sent: threadMessageIds.length,
      matched: resolved.length,
      linked: resolved.filter((e) => !!e.customerId).length,
    },
  };
}
