/**
 * Session gate for the manager sections.
 *
 * The thread view sits behind a login wall because SidebarApp checks useAuth
 * before rendering anything. The manager sections did not: they talk to
 * crm-manager through the local gcloud proxy, which is gated by Cloud Run IAM
 * but knows nothing about the app's own session — so anyone with the extension
 * loaded and the proxy running could read the whole dashboard without signing
 * in. This puts both surfaces behind the same wall.
 *
 * IAM still applies underneath; this is an additional app-level check, not a
 * replacement. Note it is a UI gate: it stops the sections rendering and
 * fetching, but the manager service itself remains IAM-only. Anyone who can
 * already run `gcloud run services proxy` against crm-manager can still curl it
 * directly — closing that would mean teaching crm-manager to verify a session,
 * which it has no notion of today.
 *
 * Deliberately standalone rather than reusing useAuth: the consumer is the
 * vanilla manager shell, which has no React tree to hang a hook off.
 */

import { API_BASE_URL } from './clients';
import { isRuntimeAlive, onRuntimeGone } from './runtime-guard';

export type AuthState = 'checking' | 'authenticated' | 'unauthenticated';

let state: AuthState = 'checking';
const listeners = new Set<(s: AuthState) => void>();
let timer: number | null = null;

function emit(): void {
  for (const fn of listeners) {
    try {
      fn(state);
    } catch (err) {
      console.warn('[InboxPulse] auth-gate listener failed:', err);
    }
  }
}

function setState(next: AuthState): void {
  if (next === state) return;
  state = next;
  emit();
}

async function check(): Promise<void> {
  // Once the extension context is gone every request fails forever, and the
  // 5s unauthenticated cadence would spin on it for as long as the tab is open.
  // Stop instead: the panel shows its own reload notice.
  if (!isRuntimeAlive()) {
    stop();
    return;
  }

  try {
    // Goes through the content script's fetch proxy (see content.ts), so it
    // carries the session cookie via the background worker.
    const res = await fetch(`${API_BASE_URL}/api/users/me`, { credentials: 'include' });
    setState(res.ok ? 'authenticated' : 'unauthenticated');
  } catch {
    // A network failure is not proof of being signed out, but the sections
    // can't load without the API either — treat it as closed.
    setState('unauthenticated');
  } finally {
    if (isRuntimeAlive()) schedule();
    else stop();
  }
}

/**
 * Poll fast while signed out so the sections unlock promptly after the user
 * completes login in the popup, and slowly once in, purely to notice logout.
 */
function schedule(): void {
  if (timer !== null) window.clearTimeout(timer);
  timer = window.setTimeout(
    () => void check(),
    state === 'authenticated' ? 60_000 : 5_000,
  );
}

/** Cancel the poll for good. Only a tab reload restarts it. */
function stop(): void {
  if (timer !== null) window.clearTimeout(timer);
  timer = null;
}

export function getAuthState(): AuthState {
  return state;
}

export function subscribeAuth(listener: (s: AuthState) => void): () => void {
  listeners.add(listener);
  listener(state);
  return () => listeners.delete(listener);
}

/** Begin checking. Safe to call more than once. */
export function startAuthGate(): void {
  onRuntimeGone(stop);
  if (timer === null) void check();
}

/** Force an immediate re-check, e.g. right after a login attempt returns. */
export function refreshAuth(): void {
  void check();
}
