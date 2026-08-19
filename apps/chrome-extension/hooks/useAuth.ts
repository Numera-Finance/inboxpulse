import { useQuery, useQueryClient } from '@tanstack/react-query';
import { API_BASE_URL } from '../lib/clients';
import type { UserResponse } from '@crm/clients';

interface AuthState {
  user: UserResponse | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  error: string | null;
  refresh: () => void;
}

/**
 * Auth hook that checks session validity via GET /api/users/me.
 * Uses direct fetch instead of UserClient to avoid the base client's
 * automatic 401 → /login redirect which breaks the extension.
 *
 * When not authenticated, refetches every 3 seconds so the panel
 * auto-updates as soon as the user completes login in another tab.
 */
export function useAuth(): AuthState {
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery<UserResponse | null>({
    queryKey: ['auth', 'me'],
    queryFn: async (): Promise<UserResponse | null> => {
      const response = await fetch(`${API_BASE_URL}/api/users/me`, {
        credentials: 'include',
      });
      if (response.status === 401) {
        return null;
      }
      if (!response.ok) {
        throw new Error(`Auth check failed: ${response.statusText}`);
      }
      const json = (await response.json()) as { success: boolean; data?: UserResponse };
      return json.data ?? null;
    },
    // One retry, not zero. The request travels through the MV3 background
    // worker, which Chrome evicts when idle — the first call after a quiet
    // spell can lose its response through no fault of the API. Retrying once
    // wakes the worker and succeeds; without it a single eviction left the
    // panel showing a sign-in prompt to an already-signed-in user until they
    // hit refresh. Bounded at one so a genuinely failing /me cannot spin.
    retry: 1,
    retryDelay: 1_000,
    staleTime: 5_000,
    // Poll every 3s only when we got a definitive "not logged in" (queryFn
    // returned null on a 401), so the panel auto-updates after login. On a
    // transient error the query is in the error state (data === undefined) — do
    // NOT poll, otherwise a failing /me would hammer the API every 3s forever.
    refetchInterval: (query) => (query.state.data === null ? 3000 : false),
    refetchOnWindowFocus: true,
  });

  const refresh = (): void => {
    queryClient.invalidateQueries({ queryKey: ['auth', 'me'] });
  };

  return {
    user: data ?? null,
    isLoading,
    isAuthenticated: !!data,
    error: error ? (error as Error).message : null,
    refresh,
  };
}
