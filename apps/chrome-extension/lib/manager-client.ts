/**
 * Transport for the manager sections.
 *
 * The ported dashboard UI calls `apiFetch(path, init)` and expects
 * `{ ok, status, json }` — never a Response. That contract is preserved here
 * verbatim so the ported section modules did not have to change.
 *
 * Requests go through the background service worker rather than direct from the
 * content script for two reasons: the content script carries Gmail's origin
 * (which the manager service does not allow-list), and Chrome's Private Network
 * Access policy blocks a public-origin page from reaching localhost. The service
 * worker has host_permissions and neither restriction applies to it.
 *
 * The target is the local `gcloud run services proxy` listener, which injects
 * the caller's identity token and forwards to the IAM-gated Cloud Run service.
 * That proxy is a separate process the user starts (see apps/manager/README.md);
 * when it is not running every request fails at connect, so that specific case
 * is detected and reported as actionable text instead of a bare network error.
 */

import {
  isRuntimeAlive,
  sendRuntimeMessage,
  RUNTIME_GONE_MESSAGE,
} from './runtime-guard';
import { API_BASE_URL } from './clients';

export const MANAGER_BASE_URL =
  import.meta.env.WXT_MANAGER_URL || 'http://localhost:8080';

export interface ManagerResponse<T = unknown> {
  ok: boolean;
  status: number;
  json: T | null;
  /** Set only on transport failure — the UI shows this verbatim. */
  error?: string;
}

/** Distinguishes "proxy isn't running" from a real API error. */
export const PROXY_DOWN_MESSAGE =
  `Can't reach the InboxPulse manager service at ${MANAGER_BASE_URL}. ` +
  `Start the authenticated proxy with:  gcloud run services proxy crm-manager --region us-central1 --port 8080`;

/**
 * Paths already served by crm-api under /api/manager.
 *
 * The manager surface was moved off the standalone crm-manager service one
 * group at a time, and this list is the switch: a matching path goes to crm-api
 * on the session cookie the extension already holds, anything else still goes
 * through the local gcloud proxy. Keeping it explicit meant a half-finished
 * migration degraded to "that tab still needs the proxy" rather than to a tab
 * that 404s.
 *
 * It now covers every path the extension calls, so the proxy is no longer part
 * of normal operation — the fallback below only fires against a crm-api that
 * predates these routes. Anything added here must exist under /api/manager
 * before it ships, or that call will quietly go looking for a proxy nobody is
 * running, which is what "Request failed: 0" meant on the Customers tab.
 */
const PORTED_PREFIXES = [
  '/api/dashboard/',
  '/api/emails/analyzed', // stats, search, and /:emailId
  '/api/emails/threads/',
  '/api/tasks/',
  '/api/roles',
  '/api/customers/', // search, /:id, /:id/contacts, /:id/team
  '/api/users/', // search and /:id
  '/api/team-roles',
];

function isPorted(path: string): boolean {
  return PORTED_PREFIXES.some((prefix) => path.startsWith(prefix));
}

/**
 * Whether the deployed crm-api actually serves /api/manager yet.
 *
 * `null` until we've asked once. The extension and the API deploy separately,
 * and this list moves the moment the client-side code ships — so between an
 * extension reload and the next crm-api deploy, every ported path would 404
 * against an API that has never heard of /api/manager. That is exactly what
 * happened: the dashboard went blank behind "Request failed: 404" while a
 * perfectly good proxy was sitting right there.
 *
 * A 404 on the first attempt means "not deployed yet", so we fall back to the
 * proxy and stop asking for the rest of the session. Reload the tab after
 * deploying crm-api and it will pick the API path up again.
 */
let apiManagerAvailable: boolean | null = null;

/**
 * Call crm-api for a ported path.
 *
 * Goes through the content script's fetch proxy (see content.ts) so it carries
 * the better-auth session cookie, and unwraps crm-api's `{ success, data }`
 * envelope down to the bare object the ported UI expects — the manager service
 * answered with bare JSON, and the section modules read it directly.
 */
async function apiManagerFetch<T>(
  path: string,
  init?: RequestInit,
): Promise<ManagerResponse<T>> {
  // Strip the leading /api so /api/dashboard/summary lands on
  // /api/manager/dashboard/summary rather than /api/manager/api/dashboard/...
  const url = `${API_BASE_URL}/api/manager${path.replace(/^\/api/, '')}`;

  try {
    const res = await fetch(url, { ...init, credentials: 'include' });
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      /* non-JSON body — status still carries the outcome */
    }

    const envelope = body as { success?: boolean; data?: T; error?: { message?: string } } | null;
    if (!res.ok || envelope?.success === false) {
      return {
        ok: false,
        status: res.status,
        json: null,
        error:
          envelope?.error?.message ??
          (res.status === 401
            ? 'Session expired. Open the Thread tab and sign in again.'
            : `Request failed: ${res.status}`),
      };
    }

    return {
      ok: true,
      status: res.status,
      json: (envelope?.data !== undefined ? envelope.data : (body as T)) ?? null,
    };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      json: null,
      error: err instanceof Error ? err.message : 'Request failed',
    };
  }
}

export async function managerFetch<T = unknown>(
  path: string,
  init?: RequestInit,
): Promise<ManagerResponse<T>> {
  // Distinguish "the extension is gone" from "the proxy is down" — both fail at
  // the same call site, but only one of them is fixed by starting the proxy.
  if (!isRuntimeAlive()) {
    return { ok: false, status: 0, json: null, error: RUNTIME_GONE_MESSAGE };
  }

  // Try crm-api for a ported path, but never let an undeployed API be the
  // reason a tab shows nothing — fall through to the proxy if it isn't there.
  if (isPorted(path) && apiManagerAvailable !== false) {
    const viaApi = await apiManagerFetch<T>(path, init);

    if (viaApi.status !== 404) {
      if (viaApi.ok) apiManagerAvailable = true;
      return viaApi;
    }

    if (apiManagerAvailable === null) {
      console.warn(
        '[InboxPulse] crm-api has no /api/manager routes yet — falling back to the ' +
          'local proxy for manager sections. Reload this tab after deploying crm-api.',
      );
    }
    apiManagerAvailable = false;
  }

  const resp = await sendRuntimeMessage<ManagerResponse<T>>({
    type: 'MANAGER_FETCH',
    path,
    init: init ? serializeInit(init) : undefined,
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
 * chrome.runtime.sendMessage structured-clones its payload, and a Headers
 * instance does not survive that intact — it arrives as `{}`, silently
 * dropping Content-Type and turning every POST body into an unparseable one.
 * Flatten to a plain object before it crosses the boundary.
 */
function serializeInit(init: RequestInit): {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
} {
  let headers: Record<string, string> | undefined;
  if (init.headers instanceof Headers) {
    headers = {};
    init.headers.forEach((value, key) => {
      headers![key] = value;
    });
  } else if (Array.isArray(init.headers)) {
    headers = Object.fromEntries(init.headers);
  } else if (init.headers && typeof init.headers === 'object') {
    headers = init.headers as Record<string, string>;
  }

  return {
    method: init.method,
    headers,
    body: typeof init.body === 'string' ? init.body : undefined,
  };
}
