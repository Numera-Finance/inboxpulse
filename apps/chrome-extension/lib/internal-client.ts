/**
 * Thread-scoped reads via the API's internal path.
 *
 * Routed through the background service worker, which attaches the service key
 * and pinned tenant and sends the request to WXT_FLAGS_API_URL — the same stack
 * and credentials the per-message flag chips use.
 *
 * Why these reads don't use the session path: it targets a different deployment
 * (production rather than the clone) AND filters every row by the caller's
 * user_accessible_customers entries. A message the chip had just tagged from the
 * clone therefore resolved to "no customer linked" in the panel. Reading through
 * the chips' own path makes the two agree by construction.
 *
 * DEMO caveat, inherited from the chips: the bundled key bypasses per-user
 * access control. Fine for a sideloaded internal build, not for distribution.
 */

import {
  isRuntimeAlive,
  sendRuntimeMessage,
  RUNTIME_GONE_MESSAGE,
} from './runtime-guard';

export interface InternalResponse<T = unknown> {
  ok: boolean;
  status: number;
  json: T | null;
  error?: string;
}

export async function internalFetch<T = unknown>(
  path: string,
  init?: { method?: string; body?: unknown },
): Promise<InternalResponse<T>> {
  // A dead extension context comes back as null rather than a throw — see
  // lib/runtime-guard.ts. Reported as its own message so the panel says "reload
  // the tab" instead of blaming the API for being unreachable.
  if (!isRuntimeAlive()) {
    return { ok: false, status: 0, json: null, error: RUNTIME_GONE_MESSAGE };
  }

  const resp = await sendRuntimeMessage<InternalResponse<T>>({
    type: 'INTERNAL_FETCH',
    path,
    method: init?.method,
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
  });

  if (!resp) {
    return {
      ok: false,
      status: 0,
      json: null,
      error: isRuntimeAlive()
        ? (chrome.runtime.lastError?.message ?? 'No response from background')
        : RUNTIME_GONE_MESSAGE,
    };
  }
  return resp;
}

/**
 * The API wraps most payloads as `{ success, data: {...} }` but a few routes
 * return the object bare. Accept either rather than making every caller guess.
 */
export function unwrap<T>(json: unknown): Partial<T> {
  if (!json || typeof json !== 'object') return {};
  const obj = json as { success?: boolean; data?: unknown };
  const inner = obj.data !== undefined ? obj.data : obj;
  return (inner ?? {}) as Partial<T>;
}
