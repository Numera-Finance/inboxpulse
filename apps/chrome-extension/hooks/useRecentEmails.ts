import { useQuery } from '@tanstack/react-query';
import { API_BASE_URL } from '../lib/clients';

export interface RecentEmail {
  id: string;
  subject: string;
  fromName: string | null;
  messageId: string;
  receivedAt: string;
}

interface RecentEmailsResult {
  emails: RecentEmail[];
  isLoading: boolean;
  error: string | null;
}

/**
 * Fetch the most recent emails for a customer.
 * Uses direct fetch (same pattern as useCustomerLookup) which gets proxied
 * through the background service worker via setupFetchProxy().
 */
export function useRecentEmails(customerId: string | null): RecentEmailsResult {
  const { data, isLoading, error } = useQuery<RecentEmail[]>({
    queryKey: ['emails', 'recent', customerId],
    queryFn: async () => {
      if (!customerId) return [];
      const response = await fetch(
        `${API_BASE_URL}/api/emails/customer/${encodeURIComponent(customerId)}?limit=5`,
        { credentials: 'include' },
      );
      if (!response.ok) {
        throw new Error(`Failed to fetch emails: ${response.statusText}`);
      }
      const json = (await response.json()) as {
        success: boolean;
        data?: { emails: RecentEmail[] };
      };
      return json.data?.emails ?? [];
    },
    enabled: !!customerId,
    staleTime: 60_000,
  });

  return {
    emails: data ?? [],
    isLoading: !!customerId && isLoading,
    error: error ? (error as Error).message : null,
  };
}
