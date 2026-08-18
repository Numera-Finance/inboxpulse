/**
 * Current-thread state, shared between InboxSDK's thread handler and the
 * Thread tab inside the global sidebar panel.
 *
 * Why this exists: the panel is mounted with `Global.addSidebarContentPanel`,
 * so it lives for the whole Gmail session and is NOT rebuilt per thread. The
 * old per-thread panel got its data as constructor props because InboxSDK
 * created a fresh React root for every `registerThreadViewHandler` firing; a
 * session-scoped panel can't work that way. Instead the thread handler pushes
 * into this store and the Thread tab subscribes.
 *
 * Deliberately a hand-rolled store rather than React state or a context: the
 * publisher (`content.ts`, inside an InboxSDK callback) is outside the React
 * tree entirely and has no way to reach a setState.
 */

export interface ThreadState {
  /** The external sender's email — used to highlight the matching contact. */
  senderEmail: string | null;
  /** Gmail message IDs for the open thread. Empty when no thread is open. */
  threadMessageIds: string[];
  /**
   * Gmail's own id for the open conversation.
   *
   * The message ids above are not a reliable way to identify the thread: Gmail
   * only builds views for the messages it has loaded, so that list can be a
   * single message — often the reader's own reply, which the sync never
   * ingested. Thread-scoped sections then had nothing to resolve and vanished,
   * appearing only when an analyzed message happened to be the one open. This
   * id is a property of the conversation and doesn't move with the selection.
   */
  providerThreadId: string | null;
  /** False before the first thread opens, and after Gmail returns to a list view. */
  hasThread: boolean;
}

const EMPTY: ThreadState = {
  senderEmail: null,
  threadMessageIds: [],
  providerThreadId: null,
  hasThread: false,
};

let state: ThreadState = EMPTY;
const listeners = new Set<() => void>();

function emit(): void {
  for (const fn of listeners) {
    try {
      fn();
    } catch (err) {
      // One bad subscriber must not stop the others, and must never surface
      // as an exception inside an InboxSDK callback.
      console.warn('[InboxPulse] thread-store listener failed:', err);
    }
  }
}

export function setThread(next: Omit<ThreadState, 'hasThread'>): void {
  state = { ...next, hasThread: true };
  emit();
}

export function clearThread(): void {
  if (!state.hasThread) return;
  state = EMPTY;
  emit();
}

/** useSyncExternalStore contract — must return a stable reference. */
export function getThreadSnapshot(): ThreadState {
  return state;
}

export function subscribeThread(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
