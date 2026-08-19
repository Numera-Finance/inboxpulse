/**
 * Survives the extension's own death.
 *
 * When an extension is reloaded, updated, or disabled, Chrome does NOT clean up
 * the content scripts it already injected into open tabs. They keep running with
 * a dead `chrome.runtime`: every `sendMessage` throws "Extension context
 * invalidated", synchronously, forever. Meanwhile everything the script put into
 * the page — InboxSDK's bridge, the sidebar panel, the capture-phase click guard
 * — is still installed and still intercepting Gmail's events, now with no
 * working backend behind it.
 *
 * That is the state where Gmail visibly breaks, and it is not recoverable from
 * inside: a content script cannot re-attach itself to a new extension context.
 * The only correct behaviour is to notice, stand down completely, and tell the
 * user to reload the tab.
 *
 * `chrome.runtime.id` is the cheap canonical probe — it reads `undefined` the
 * moment the context is gone, and touching it never throws the way sendMessage
 * does.
 */

let invalidated = false;
const listeners = new Set<() => void>();

/** True while the extension context is still usable. */
export function isRuntimeAlive(): boolean {
  if (invalidated) return false;
  try {
    return typeof chrome !== 'undefined' && !!chrome.runtime?.id;
  } catch {
    // Touching chrome.runtime can itself throw once the context is torn down.
    return false;
  }
}

/**
 * Whether an error is the runtime going away rather than a real failure.
 *
 * Deliberately narrow. "Receiving end does not exist" and "message port closed"
 * look like the same thing and are NOT: under MV3 the service worker is
 * evicted when idle, so both show up transiently on a perfectly healthy
 * extension whose worker is still waking. Treating them as death would latch
 * the whole panel off permanently over a hiccup that the next request would
 * have survived — strictly worse than the unguarded behaviour.
 *
 * Only the invalidation message is definitive, and even then `isRuntimeAlive()`
 * (which reads `chrome.runtime.id`) is the authority — see sendRuntimeMessage.
 */
export function isRuntimeGoneError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return (
    message.includes('Extension context invalidated') ||
    message.includes('Extension context was invalidated')
  );
}

/** Latch the dead state and notify once. Safe to call repeatedly. */
export function markRuntimeGone(): void {
  if (invalidated) return;
  invalidated = true;
  console.warn(
    '[InboxPulse] extension context is gone (reloaded, updated, or disabled). ' +
      'Standing down — reload the Gmail tab to reconnect.',
  );
  for (const fn of listeners) {
    try {
      fn();
    } catch (err) {
      console.warn('[InboxPulse] shutdown listener failed:', err);
    }
  }
  listeners.clear();
}

/**
 * Run `fn` when the runtime dies (or immediately, if it already has).
 * Used to tear down everything this script installed into Gmail.
 */
export function onRuntimeGone(fn: () => void): void {
  if (invalidated) {
    fn();
    return;
  }
  listeners.add(fn);
}

export function subscribeRuntimeGone(listener: () => void): () => void {
  if (invalidated) {
    listener();
    return () => {};
  }
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** For `useSyncExternalStore` — the panel renders a reload notice when dead. */
export function getRuntimeGoneSnapshot(): boolean {
  return invalidated;
}

/**
 * How long to wait for the background worker before giving up on a message.
 *
 * Generous enough to cover a cold service-worker start plus a slow Cloud Run
 * request, short enough that a lost response becomes a visible error rather
 * than a permanent spinner.
 */
const MESSAGE_TIMEOUT_MS = 20_000;

/**
 * `chrome.runtime.sendMessage` that reports the runtime being gone instead of
 * throwing it into a caller that has no way to tell it apart from a network
 * error. Returns `null` once the context is dead; every transport in this
 * extension goes through here so exactly one place has to know the difference.
 *
 * The timeout matters more than it looks. Under MV3 the background worker is
 * evicted when idle, and a worker torn down after its listener returned `true`
 * but before it called `sendResponse` leaves this promise pending FOREVER —
 * Chrome does not always reject it. Every API call in the panel rides this
 * path, so a single lost response was enough to strand the sidebar on
 * "Checking authentication…" with no error, no retry and no way back except a
 * reload. Failing loudly after a bounded wait is what lets react-query's error
 * path run at all.
 */
export async function sendRuntimeMessage<T>(payload: unknown): Promise<T | null> {
  if (!isRuntimeAlive()) {
    markRuntimeGone();
    return null;
  }

  let timer: number | undefined;
  try {
    const response = await Promise.race([
      chrome.runtime.sendMessage(payload) as Promise<T>,
      new Promise<never>((_resolve, reject) => {
        timer = globalThis.setTimeout(
          () =>
            reject(
              new Error(
                'InboxPulse background worker did not respond in time. It may have been evicted mid-request; the next attempt should wake it.',
              ),
            ),
          MESSAGE_TIMEOUT_MS,
        ) as unknown as number;
      }),
    ]);
    return response;
  } catch (err) {
    // `chrome.runtime.id` is the authority: a transient worker-wakeup failure
    // leaves it intact, so anything that still has an id gets rethrown and
    // handled as the ordinary error it is. Only a genuinely dead context latches.
    if (isRuntimeGoneError(err) || !isRuntimeAlive()) {
      markRuntimeGone();
      return null;
    }
    throw err;
  } finally {
    if (timer !== undefined) globalThis.clearTimeout(timer);
  }
}

/** Message shown wherever a dead runtime surfaces in the UI. */
export const RUNTIME_GONE_MESSAGE =
  'InboxPulse was reloaded or updated. Refresh this Gmail tab to reconnect.';
