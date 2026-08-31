/**
 * Service worker — InboxSDK background registration + OAuth login flow.
 *
 * - Imports InboxSDK's background.js (required by InboxSDK in the service worker)
 * - Handles LOGIN messages from the content script sidebar by opening a popup
 *   window for Google OAuth, then auto-closing it when login completes
 */

import '@inboxsdk/core/background.js';

// Build-time configurable (see .env.example) so OAuth login works against both
// the local dev web app and the Cloud Run deployment.
const WEB_URL = import.meta.env.WXT_WEB_URL || 'http://localhost:4000';
const API_URL = import.meta.env.WXT_API_URL || 'http://localhost:4001';
// DEMO-ONLY auth for the per-message flags path: the internal service key + a
// pinned tenant, resolved from the CLONE-pointed api. This bundles a secret into
// the extension and is NOT for public distribution — production should use the
// session-cookie auth the sidebar already uses. Left blank => feature disabled.
const SERVICE_API_KEY = import.meta.env.WXT_SERVICE_API_KEY || '';
const TENANT_ID = import.meta.env.WXT_TENANT_ID || '';
// Where the per-message flag chips read from. Separate from API_URL because the
// two paths authenticate differently and therefore cannot always share a host:
// the chips use service-key + pinned-tenant headers (no cookie), so they can
// point at the CLONE, while everything else needs a better-auth session cookie
// and must therefore live on the same host the web app logs into. Defaults to
// API_URL so a single-stack build needs no extra config.
const FLAGS_API_URL = import.meta.env.WXT_FLAGS_API_URL || API_URL;
// The local `gcloud run services proxy` listener fronting the IAM-gated
// crm-manager service. See lib/manager-client.ts for why traffic is routed
// through the service worker rather than issued from the content script.
const MANAGER_URL = import.meta.env.WXT_MANAGER_URL || 'http://localhost:8080';
// The Workspace add-on service, whose rendered Cards-v2 JSON the sidebar can
// display directly so the extension and the add-on cannot drift apart. Local
// only: a deployed add-on verifies a Google-signed ID token that an extension
// cannot mint. See lib/addon-client.ts.
const ADDON_URL = import.meta.env.WXT_ADDON_URL || 'http://localhost:4005';

export default defineBackground(() => {
  // Handle messages from content script sidebar
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === 'LOGIN') {
      handleLogin()
        .then(() => sendResponse({ success: true }))
        .catch((err: Error) => sendResponse({ success: false, error: err.message }));
      return true;
    }

    // Per-message flags for the open thread. The content script sends the Gmail
    // message ids; we resolve them to stored signals via the internal API path
    // (key + tenant) and return a { messageId: signals[] } map for chip rendering.
    if (message.type === 'GET_THREAD_FLAGS') {
      const { messageIds } = message as { messageIds: string[] };
      if (!SERVICE_API_KEY || !TENANT_ID) {
        sendResponse({ ok: false, error: 'flags auth not configured' });
        return true;
      }
      fetch(`${FLAGS_API_URL}/api/internal/emails/resolve-by-messages`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-internal-api-key': SERVICE_API_KEY,
          'x-tenant-id': TENANT_ID,
        },
        body: JSON.stringify({ messageIds: messageIds.slice(0, 100), provider: 'gmail' }),
      })
        .then(async (res) => {
          const json = (await res.json()) as { data?: { emails?: Array<{ messageId?: string; signals?: number[] }> }; emails?: Array<{ messageId?: string; signals?: number[] }> };
          const emails = json?.data?.emails ?? json?.emails ?? [];
          const flags: Record<string, number[]> = {};
          for (const e of emails) if (e.messageId) flags[e.messageId] = e.signals ?? [];
          console.log('[InboxPulse bg] resolve-by-messages status', res.status, 'matched', emails.length, 'of', messageIds.length);
          sendResponse({ ok: true, flags });
        })
        .catch((err: Error) => {
          console.warn('[InboxPulse bg] flags fetch failed:', err.message);
          sendResponse({ ok: false, error: err.message });
        });
      return true;
    }

    // A reader's suggested alternative tags for one message. Posted through the
    // same internal (key + pinned tenant) path the chip read uses, since the
    // content script can't carry the web app's session cookie to the API.
    //
    // WRITE PATH — same DEMO caveat as GET_THREAD_FLAGS: the internal key is
    // bundled into the extension. The API only ever writes the user_submitted_*
    // columns, so a leaked key cannot alter the AI's analysis, but production
    // should still move this to session-cookie auth before public distribution.
    if (message.type === 'SUBMIT_TAG_SUGGESTION') {
      const { messageId, riskLevel, sentimentValue } = message as {
        messageId: string;
        riskLevel: string | null;
        sentimentValue: string | null;
      };
      if (!SERVICE_API_KEY || !TENANT_ID) {
        sendResponse({ ok: false, error: 'suggestion auth not configured' });
        return true;
      }
      fetch(`${FLAGS_API_URL}/api/internal/emails/tag-suggestion`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-internal-api-key': SERVICE_API_KEY,
          'x-tenant-id': TENANT_ID,
        },
        // Omit a field entirely (rather than sending null) when the user didn't
        // pick anything for it, so an untouched group keeps its stored value.
        body: JSON.stringify({
          messageId,
          provider: 'gmail',
          ...(riskLevel ? { riskLevel } : {}),
          ...(sentimentValue ? { sentimentValue } : {}),
        }),
      })
        .then(async (res) => {
          const json = (await res.json()) as {
            success?: boolean;
            error?: { message?: string };
          };
          if (!res.ok || json?.success === false) {
            sendResponse({
              ok: false,
              error: json?.error?.message ?? `API returned ${res.status}`,
            });
            return;
          }
          sendResponse({ ok: true });
        })
        .catch((err: Error) => {
          console.warn('[InboxPulse bg] tag suggestion failed:', err.message);
          sendResponse({ ok: false, error: err.message });
        });
      return true;
    }

    // Thread-scoped reads through the INTERNAL path (service key + pinned
    // tenant) against FLAGS_API_URL — the same stack and the same credentials
    // the flag chips use.
    //
    // Why not the session path: it reads a different database (production) and
    // additionally filters by the caller's user_accessible_customers rows, so a
    // message the chip had just flagged from the clone resolved to "no customer
    // linked" in the sidebar. Sharing the chips' path makes the two agree by
    // construction — whatever a chip claims, the panel can explain.
    //
    // Same DEMO caveat as the chips: the bundled key bypasses per-user access
    // control, so this build must not be distributed.
    if (message.type === 'INTERNAL_FETCH') {
      const { path, method, body } = message as {
        path: string;
        method?: string;
        body?: string;
      };
      if (!SERVICE_API_KEY || !TENANT_ID) {
        sendResponse({ ok: false, status: 0, json: null, error: 'internal auth not configured' });
        return true;
      }
      fetch(`${FLAGS_API_URL}${path}`, {
        method: method ?? 'GET',
        headers: {
          'content-type': 'application/json',
          'x-internal-api-key': SERVICE_API_KEY,
          'x-tenant-id': TENANT_ID,
        },
        ...(body ? { body } : {}),
      })
        .then(async (res) => {
          let json: unknown = null;
          try {
            json = await res.json();
          } catch {
            /* non-JSON body */
          }
          sendResponse({ ok: res.ok, status: res.status, json });
        })
        .catch((err: Error) => {
          console.warn('[InboxPulse bg] internal fetch failed:', path, err.message);
          sendResponse({ ok: false, status: 0, json: null, error: err.message });
        });
      return true;
    }

    // Manager section requests → local gcloud auth proxy → Cloud Run.
    //
    // Returns the { ok, status, json } envelope the ported dashboard UI expects
    // rather than a Response, which cannot cross the message boundary anyway.
    // A connect failure here almost always means the proxy process isn't
    // running, so the error is phrased to say exactly that.
    if (message.type === 'MANAGER_FETCH') {
      const { path, init } = message as {
        path: string;
        init?: { method?: string; headers?: Record<string, string>; body?: string };
      };

      fetch(`${MANAGER_URL}${path}`, init ?? {})
        .then(async (res) => {
          let json: unknown = null;
          try {
            json = await res.json();
          } catch {
            /* non-JSON body — leave json null and let status carry the outcome */
          }
          sendResponse({ ok: res.ok, status: res.status, json });
        })
        .catch((err: Error) => {
          console.warn('[InboxPulse bg] manager fetch failed:', err.message);
          sendResponse({
            ok: false,
            status: 0,
            json: null,
            error:
              `Can't reach the InboxPulse manager service at ${MANAGER_URL}. ` +
              `Start the authenticated proxy with:  gcloud run services proxy crm-manager --region us-central1 --port 8080`,
          });
        });
      return true;
    }

    // The Workspace add-on's rendered cards. POSTed, always, because every
    // add-on trigger endpoint is a POST that takes the event object as its body
    // — see apps/addon/src/index.ts.
    //
    // Returns the same { ok, status, json } envelope MANAGER_FETCH does. A
    // Response cannot cross the message boundary, and the envelope is what
    // lib/addon-client.ts is typed against.
    if (message.type === 'ADDON_FETCH') {
      const { path, body } = message as { path: string; body?: string };

      // Card action buttons carry an ABSOLUTE url (the add-on builds them from
      // ADDON_BASE_URL, because Google has to call them). Everything else is a
      // path. Accept both, but never let an absolute url point somewhere else:
      // a card is data from the API, so a rewritten action url would otherwise
      // make the service worker POST wherever it said.
      const url = path.startsWith('http') ? path : `${ADDON_URL}${path}`;
      if (!url.startsWith(ADDON_URL)) {
        sendResponse({
          ok: false,
          status: 0,
          json: null,
          error: `Refused to call ${url} — not the configured add-on (${ADDON_URL}).`,
        });
        return true;
      }

      fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: body ?? '{}',
      })
        .then(async (res) => {
          let json: unknown = null;
          try {
            json = await res.json();
          } catch {
            /* non-JSON body — status carries the outcome */
          }
          sendResponse({ ok: res.ok, status: res.status, json });
        })
        .catch((err: Error) => {
          console.warn('[InboxPulse bg] addon fetch failed:', path, err.message);
          // "Couldn't load" and "the add-on isn't running" render identically in
          // the panel, and only one of them is fixed by starting a process.
          sendResponse({
            ok: false,
            status: 0,
            json: null,
            error:
              `Can't reach the InboxPulse add-on at ${ADDON_URL}. ` +
              `Start it with:  pnpm --filter @crm/addon dev`,
          });
        });
      return true;
    }

    // Every card link that would leave for the web console lands here instead.
    // See components/CardRenderer.tsx — the panel never navigates to a real
    // host, so a QA build cannot be used to act on production by accident.
    //
    // Opened from the background rather than the content script so the page
    // needs no web_accessible_resources entry: a chrome-extension:// URL loaded
    // from Gmail's origin would otherwise be blocked.
    if (message.type === 'OPEN_QA_NOTICE') {
      chrome.tabs.create({ url: chrome.runtime.getURL('qa-only.html') }).then(
        () => sendResponse({ ok: true }),
        (err: Error) => sendResponse({ ok: false, error: err.message }),
      );
      return true;
    }

    // Proxy fetch requests from content script to bypass Private Network Access restrictions.
    // Content scripts run in Gmail's origin and can't reach localhost directly.
    if (message.type === 'PROXY_FETCH') {
      const { url, method, headers, body } = message as {
        url: string;
        method: string;
        headers: Record<string, string>;
        body: string | null;
      };

      fetch(url, {
        method,
        headers,
        body,
        credentials: 'include',
      })
        .then(async (res) => {
          const responseBody = await res.text();
          sendResponse({
            status: res.status,
            statusText: res.statusText,
            headers: Object.fromEntries(res.headers.entries()),
            body: responseBody,
          });
        })
        .catch((err: Error) => {
          sendResponse({ error: err.message });
        });
      return true;
    }
  });

  async function handleLogin(): Promise<void> {
    const loginWindow = await chrome.windows.create({
      url: `${WEB_URL}/login`,
      type: 'popup',
      width: 500,
      height: 650,
    });

    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error('Login timed out'));
      }, 120_000);

      function onTabUpdated(tabId: number, changeInfo: chrome.tabs.TabChangeInfo): void {
        if (!loginWindow.id) return;
        chrome.tabs.query({ windowId: loginWindow.id }, (tabs) => {
          const isOurTab = tabs.some((t) => t.id === tabId);
          if (!isOurTab || !changeInfo.url) return;

          if (changeInfo.url.startsWith(WEB_URL) && !changeInfo.url.includes('/login')) {
            cleanup();
            chrome.windows.remove(loginWindow.id!).catch(() => {});
            resolve();
          }
        });
      }

      function onWindowRemoved(windowId: number): void {
        if (windowId !== loginWindow.id) return;
        cleanup();
        resolve();
      }

      function cleanup(): void {
        clearTimeout(timeout);
        chrome.tabs.onUpdated.removeListener(onTabUpdated);
        chrome.windows.onRemoved.removeListener(onWindowRemoved);
      }

      chrome.tabs.onUpdated.addListener(onTabUpdated);
      chrome.windows.onRemoved.addListener(onWindowRemoved);
    });
  }
});
