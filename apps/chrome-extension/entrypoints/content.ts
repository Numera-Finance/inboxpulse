/**
 * Gmail content script.
 *
 * Surfaces, in order of appearance:
 *   1. A single global sidebar panel (`Global.addSidebarContentPanel`) holding
 *      every InboxPulse view as tabs: Thread (the CRM customer view) plus the
 *      manager sections ported from the standalone dashboard.
 *   2. Per-message flag chips injected into the thread body.
 *   3. A click guard that protects InboxPulse label chips from removal.
 *
 * Why ONE global panel instead of a per-thread panel plus a nav route: the
 * previous split put two identically-titled "InboxPulse" entries in Gmail's
 * right rail, which is why the per-thread panel ended up parked behind a flag.
 * A global panel is created once per Gmail session and survives navigation, so
 * the manager sections keep their state (and their in-flight queries) while the
 * reader moves between conversations. The thread-scoped view stays live by
 * subscribing to `lib/thread-store`, which the thread handler below feeds.
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import InboxSDK from '@inboxsdk/core';
import { ThreadTab } from '../components/ThreadTab';
import { API_BASE_URL } from '../lib/clients';
import { managerFetch } from '../lib/manager-client';
import { buildFlagRow, flagSummary, type TagSuggestion } from '../lib/flags';
import { guardLabelChips, installLabelClickGuard } from '../lib/label-guard';
import { setThread, clearThread } from '../lib/thread-store';
import {
  registerMessage,
  forgetMessage,
  clearMessages,
  readRowTimestamp,
} from '../lib/message-registry';
import {
  setActiveMessage,
  resetActiveMessage,
  type ActiveMessage,
} from '../lib/active-message-store';
import {
  putThreadMessage,
  dropThreadMessage,
  clearThreadMessages,
} from '../lib/thread-messages-store';
import { startAuthGate, subscribeAuth, refreshAuth, type AuthState } from '../lib/auth-gate';
import {
  isRuntimeAlive,
  markRuntimeGone,
  onRuntimeGone,
  sendRuntimeMessage,
  isRuntimeGoneError,
} from '../lib/runtime-guard';
import { mountApp, MANAGER_SECTIONS } from '../manager/app-shell.js';
import type {
  SectionDescriptor,
  SectionContext,
  SectionInstance,
} from '../manager/app-shell';
import cssText from '../assets/globals.css?inline';
import managerCssText from '../manager/manager.css?inline';

const INBOXSDK_APP_ID = 'sdk_mcfo-crm_f3ce3285d1';

/**
 * Override fetch in the content script's isolated world to proxy API requests
 * through the background service worker. Content scripts run in Gmail's origin
 * and Chrome's Private Network Access policy blocks requests to localhost.
 * The service worker has host_permissions and can reach localhost freely.
 */
function setupFetchProxy(): void {
  const originalFetch = globalThis.fetch.bind(globalThis);

  globalThis.fetch = async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const url =
      input instanceof Request
        ? input.url
        : input instanceof URL
          ? input.toString()
          : input;

    if (!url.startsWith(API_BASE_URL)) {
      return originalFetch(input, init);
    }

    const method =
      init?.method ?? (input instanceof Request ? input.method : 'GET');

    let headers: Record<string, string> = {};
    const rawHeaders =
      init?.headers ?? (input instanceof Request ? input.headers : undefined);
    if (rawHeaders instanceof Headers) {
      rawHeaders.forEach((value, key) => {
        headers[key] = value;
      });
    } else if (rawHeaders && typeof rawHeaders === 'object') {
      headers = rawHeaders as Record<string, string>;
    }

    let body: string | null = null;
    if (init?.body) {
      body = typeof init.body === 'string' ? init.body : String(init.body);
    } else if (input instanceof Request && input.body) {
      body = await input.text();
    }

    const proxyResponse = await sendRuntimeMessage<{
      status: number;
      statusText: string;
      headers: Record<string, string>;
      body: string;
      error?: string;
    }>({
      type: 'PROXY_FETCH',
      url,
      method,
      headers,
      body,
    });

    // The extension went away mid-flight. Reported as a normal rejection so
    // every caller's existing error path handles it; the runtime guard has
    // already latched the dead state for the UI to read.
    if (!proxyResponse) {
      throw new Error('InboxPulse was reloaded — refresh this Gmail tab.');
    }

    if (proxyResponse.error) {
      throw new Error(proxyResponse.error);
    }

    return new Response(proxyResponse.body, {
      status: proxyResponse.status,
      statusText: proxyResponse.statusText,
      headers: new Headers(proxyResponse.headers),
    });
  };
}

/** Mount the React thread view into its own nested shadow root. */
function mountThreadSection(
  sectionHost: HTMLElement,
  queryClient: QueryClient,
): { destroy: () => void } {
  const shadow = sectionHost.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = cssText;
  shadow.appendChild(style);

  const mountPoint = document.createElement('div');
  mountPoint.className = 'bg-background text-foreground';
  mountPoint.style.fontSize = '13px';
  mountPoint.style.lineHeight = '1.5';
  mountPoint.style.fontFamily = '"Segoe UI", system-ui, -apple-system, sans-serif';
  shadow.appendChild(mountPoint);

  const reactRoot = ReactDOM.createRoot(mountPoint);
  reactRoot.render(
    React.createElement(
      React.StrictMode,
      null,
      React.createElement(
        QueryClientProvider,
        { client: queryClient },
        React.createElement(ThreadTab),
      ),
    ),
  );

  return { destroy: () => reactRoot.unmount() };
}

/**
 * Wrap a manager section so it only mounts for a signed-in user.
 *
 * The thread view was already behind a login wall (SidebarApp checks useAuth);
 * the manager sections were not, so the dashboard rendered for anyone with the
 * extension loaded and the gcloud proxy running. This puts both behind the same
 * wall. The real section is mounted lazily on the first authenticated state and
 * then kept — so signing in swaps the notice for live data without a reload,
 * and a later session expiry doesn't tear down a section mid-use.
 */
function gateSection(section: SectionDescriptor): SectionDescriptor {
  return {
    ...section,
    mount(host: HTMLElement, ctx: SectionContext): SectionInstance {
      const notice = document.createElement('div');
      notice.className = 'ip-authgate';
      host.appendChild(notice);

      const inner = document.createElement('div');
      host.appendChild(inner);

      let mounted: SectionInstance | null = null;

      const render = (state: AuthState): void => {
        if (state === 'authenticated') {
          notice.hidden = true;
          if (!mounted) mounted = section.mount(inner, ctx);
          return;
        }
        notice.hidden = false;
        notice.innerHTML =
          state === 'checking'
            ? `<p class="ip-authgate__title">Checking sign-in…</p>`
            : `<p class="ip-authgate__title">Sign in required</p>
               <p class="ip-authgate__body">Sign in on the Thread tab to view ${section.label}.</p>
               <button type="button" class="ip-authgate__btn" data-el="authgate-signin">Sign in</button>`;
        const btn = notice.querySelector('[data-el="authgate-signin"]');
        btn?.addEventListener('click', () => {
          void sendRuntimeMessage({ type: 'LOGIN' })
            .then(() => refreshAuth())
            .catch((err: unknown) => {
              if (!isRuntimeGoneError(err)) console.warn('[InboxPulse] login failed:', err);
            });
        });
      };

      const unsubscribe = subscribeAuth(render);

      // Forward the shell's calls to the real section once it exists; before
      // that they're no-ops rather than errors, so cross-section navigation
      // arriving while signed out is simply ignored.
      return {
        setFilters: (f) => mounted?.setFilters?.(f),
        openEmail: (id) => mounted?.openEmail?.(id),
        openInbox: (f) => mounted?.openInbox?.(f),
        openCustomer: (id) => mounted?.openCustomer?.(id),
        destroy: () => {
          unsubscribe();
          mounted?.destroy?.();
        },
      };
    },
  };
}

/**
 * Build the panel host: a shadow root carrying the ported manager stylesheet,
 * with the tabbed shell mounted inside it.
 *
 * The Thread tab gets its OWN nested shadow root (see `mountThreadSection`).
 * The two UIs ship incompatible CSS: the React components rely on Tailwind,
 * whose preflight resets bare element selectors (button, h1, table…), and the
 * ported dashboard styles those same elements directly. Sharing one root would
 * let preflight silently restyle the dashboard. Nesting keeps each in its own
 * scope, at the cost of one extra <style> copy.
 */
function buildPanelHost(queryClient: QueryClient): HTMLElement {
  const host = document.createElement('div');
  const shadow = host.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = managerCssText;
  shadow.appendChild(style);

  const root = document.createElement('div');
  shadow.appendChild(root);

  const sections = [
    {
      id: 'thread',
      label: 'Thread',
      // The thread view describes whichever conversation is open; the global
      // date/customer filters have no meaning for it.
      usesFilters: false,
      mount: (sectionHost: HTMLElement) => mountThreadSection(sectionHost, queryClient),
    },
    // Manager sections sit behind the same session wall as the thread view.
    ...MANAGER_SECTIONS.map(gateSection),
  ];

  mountApp(root, { apiFetch: managerFetch, sections, initialSection: 'thread' });

  return host;
}

export default defineContentScript({
  matches: ['https://mail.google.com/*'],
  runAt: 'document_end',

  async main() {
    console.log('[InboxPulse] content script running');

    // Cross-world liveness marker. The content script runs in an isolated world,
    // so nothing it logs or defines is reachable from a console evaluating in the
    // page context — which made "is the extension even loaded?" unanswerable
    // during debugging. The DOM is shared, so stamp it there.
    document.documentElement.setAttribute('data-inboxpulse-loaded', new Date().toISOString());

    setupFetchProxy();

    // Notice the extension going away even when nobody is clicking.
    //
    // Nothing else polls: the transports only learn the context is dead when
    // something asks them to send, so a tab left idle would keep the click guard
    // installed indefinitely after a reload. A property read every 10s costs
    // nothing and is what makes the teardown prompt rather than incidental.
    const heartbeat = window.setInterval(() => {
      if (isRuntimeAlive()) return;
      window.clearInterval(heartbeat);
      markRuntimeGone();
    }, 10_000);
    onRuntimeGone(() => window.clearInterval(heartbeat));

    // Start the session check that gates the manager sections. Must come after
    // setupFetchProxy — the check calls the API and needs the background proxy.
    startAuthGate();

    // Page-level capture guard for protected label chips. Installed once, before
    // InboxSDK loads, so a removal click is swallowed even on the very first
    // thread render — and even if the chip-hiding pass never finds the control.
    //
    // Removed the moment the extension context dies. This listener cancels
    // Gmail's own handlers by design, and an orphaned content script would go on
    // doing that with nothing behind it — clicks quietly swallowed in a tab whose
    // sidebar no longer works. Standing down is the honest failure.
    onRuntimeGone(installLabelClickGuard());

    const sdk = await InboxSDK.load(2, INBOXSDK_APP_ID);
    console.log('[InboxPulse] InboxSDK loaded');

    // Fetch the tenant's email domains from the API so we correctly identify
    // internal vs external participants regardless of who has access.
    const tenantDomains = new Set<string>();
    try {
      const res = await fetch(`${API_BASE_URL}/api/users/me`, { credentials: 'include' });
      if (res.ok) {
        const json = (await res.json()) as { success: boolean; data?: { tenantDomains?: string[] } };
        for (const d of json.data?.tenantDomains ?? []) {
          if (d) tenantDomains.add(d.toLowerCase());
        }
      }
    } catch {
      // Fall back to user's email domain if API is unreachable
    }

    // Fall back to the logged-in user's email domain if no tenant domains available
    if (tenantDomains.size === 0) {
      const currentUserDomain = sdk.User.getEmailAddress().split('@')[1]?.toLowerCase();
      if (currentUserDomain) tenantDomains.add(currentUserDomain);
    }

    // One shared QueryClient for the panel. Per-thread data is keyed by
    // customerId/messageIds so it never collides; sharing means the auth query
    // (and its unauthenticated 3s poll) runs once for the whole session.
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          staleTime: 30_000,
          retry: 1,
        },
      },
    });

    let activeThreadToken = 0;

    // Gmail message ids for the OPEN thread, accumulated rather than collected
    // once.
    //
    // Both getMessageViews() and getMessageViewsAll() return only the views
    // Gmail has actually built by the time registerThreadViewHandler fires —
    // for a collapsed thread that is a single message, usually the reader's own
    // latest reply, which isn't ingested. The result was a permanent
    // "1 message sent · 0 matched" even though the thread's other messages were
    // stored all along.
    //
    // registerMessageViewHandler, by contrast, fires for every message as Gmail
    // loads it — which is exactly why the flag chips always worked while the
    // panel did not. Feeding the same events into the set means the id list
    // converges on the full thread instead of freezing at whatever existed in
    // the first frame.
    let threadIds = new Set<string>();
    let threadSenderEmail: string | null = null;
    let providerThreadId: string | null = null;
    let publishTimer = 0;

    /**
     * Push what we know about the open thread, coalescing the burst as it
     * expands.
     *
     * No longer gated on having message ids. The thread's own id is enough for
     * every thread-scoped section, and waiting for message ids is what made
     * those sections come and go with the selection.
     */
    const publishThread = (token: number): void => {
      if (publishTimer) window.clearTimeout(publishTimer);
      publishTimer = window.setTimeout(() => {
        publishTimer = 0;
        if (token !== activeThreadToken) return;
        if (threadIds.size === 0 && !providerThreadId) return;
        setThread({
          senderEmail: threadSenderEmail,
          threadMessageIds: [...threadIds],
          providerThreadId,
        });
      }, 250);
    };

    // Per-message flag chips. registerMessageViewHandler fires for EACH message
    // as it loads/expands — so chips land on every message the user opens, not
    // just the one auto-expanded when the thread first renders. Fully isolated:
    // any failure is swallowed so it can never affect Gmail or the sidebar.
    const flagCache = new Map<string, number[]>();
    sdk.Conversations.registerMessageViewHandler((messageView) => {
      void (async () => {
        // InboxSDK keeps calling this for every message Gmail renders, for the
        // life of the tab — long after the extension itself may be gone. Bail
        // before touching chrome.* rather than throwing once per message.
        if (!isRuntimeAlive()) return;
        try {
          const id = await messageView.getMessageIDAsync();
          if (!id) return;

          // Feed the thread's id set. This handler is the ONLY reliable source
          // for every message in a thread — the thread-view handler runs before
          // Gmail has built the collapsed views, so it sees just one. Adding
          // here is what turns "1 message sent" into the full conversation.
          if (!threadIds.has(id)) {
            threadIds.add(id);
            publishThread(activeThreadToken);
          }

          // Hand the panel a way to act on this message. The sidebar's flagged
          // rows and search results name a message by id; expanding and
          // scrolling to its view is the only thing that actually takes the
          // reader there (see lib/message-registry.ts).
          registerMessage(id, messageView);
          messageView.on('destroy', () => {
            forgetMessage(id);
            dropThreadMessage(id);
          });

          // Drive the message-scoped sections of the panel, and feed the panel's
          // message picker.
          //
          // The envelope below is read for EVERY message, not just expanded
          // ones. It always was cheap to read and was simply discarded unless
          // the message happened to be open — which is why the panel could
          // describe the message the reader had expanded but could not offer
          // them the others.
          //
          // Each accessor is guarded separately: they read different parts of a
          // header Gmail fills in progressively, so one that isn't ready yet
          // must not cost us the fields that are. Whatever is missing gets
          // picked up by the next viewStateChange, or comes from the stored row.
          const readEnvelope = (): ActiveMessage => {
            let fromName: string | null = null;
            let fromEmail: string | null = null;
            let recipients: string[] = [];
            let dateString: string | null = null;
            let subject: string | null = null;
            try {
              const sender = messageView.getSender();
              fromEmail = sender?.emailAddress ?? null;
              fromName = sender?.name ?? null;
            } catch {
              /* sender not parsed yet */
            }
            try {
              recipients = messageView.getRecipientEmailAddresses() ?? [];
            } catch {
              /* recipient list not parsed yet */
            }
            try {
              dateString = messageView.getDateString() || null;
            } catch {
              /* date not parsed yet */
            }
            try {
              subject = messageView.getThreadView()?.getSubject() || null;
            } catch {
              /* thread view gone */
            }
            return { id, fromName, fromEmail, recipients, dateString, subject };
          };

          const publish = (): void => {
            const envelope = readEnvelope();

            // The row element is re-read on every publish rather than captured
            // once: Gmail swaps the node out as a message expands, and the list
            // orders itself by document position, so a stale reference silently
            // demotes that row to "position unknown" and sends it to the bottom.
            let element: HTMLElement | null = null;
            try {
              element = messageView.getElement();
            } catch {
              /* not available in this view state — the row still lists, in
                 arrival order rather than conversation order */
            }
            // Scraped rather than taken from getDateString(), which is the
            // *visible* date — "9:14 AM" with no day for today's mail. The
            // picker needs a real instant to match this message against a
            // stored row and to sort the two sources into one order.
            putThreadMessage(
              { message: envelope, receivedAt: element ? readRowTimestamp(element) : null },
              element,
            );

            try {
              // Expanding selects. Collapsing no longer deselects — see
              // active-message-store for why that coupling had to go.
              if (messageView.getViewState() === 'EXPANDED') setActiveMessage(envelope);
            } catch {
              /* view state unavailable — leave the current selection alone */
            }
          };
          publish();
          messageView.on('viewStateChange', publish);
          let signals = flagCache.get(id);
          if (signals === undefined) {
            const resp = await sendRuntimeMessage<{
              ok: boolean;
              flags?: Record<string, number[]>;
            }>({
              type: 'GET_THREAD_FLAGS',
              messageIds: [id],
            });
            // Runtime gone — leave the cache empty so a later tab reload starts
            // clean rather than inheriting a fabricated "no signals" answer.
            if (!resp) return;
            signals = resp.flags?.[id] ?? [];
            flagCache.set(id, signals);
          }
          console.log('[InboxPulse] message', id, 'signals', signals);
          // Same cross-world marker, per message: lets a page-context console
          // report which messages the extension saw and what it got back.
          try {
            const el = messageView.getElement();
            el.setAttribute('data-inboxpulse-msg', id);
            el.setAttribute('data-inboxpulse-signals', signals.join(',') || 'none');
          } catch {
            /* element not available for this view state — marker is diagnostic only */
          }
          if (signals.length === 0) return;

          const chipSignals = signals;

          // Send the reader's suggested tags to the API. They land in the
          // user_submitted_* columns of email_analyses — the AI's own verdict
          // (and therefore the chips above) is never overwritten.
          const submitSuggestion = async (suggestion: TagSuggestion): Promise<void> => {
            const resp = await sendRuntimeMessage<{ ok: boolean; error?: string }>({
              type: 'SUBMIT_TAG_SUGGESTION',
              messageId: id,
              riskLevel: suggestion.riskLevel ?? null,
              sentimentValue: suggestion.sentimentValue ?? null,
            });
            if (!resp) {
              throw new Error('InboxPulse was reloaded — refresh this Gmail tab.');
            }
            if (!resp.ok) throw new Error(resp.error ?? 'Request failed');
          };

          // Marker on the message row itself, so a flagged message is visible
          // while COLLAPSED — otherwise the only clue a message carries tags is
          // opening it, and the reader has no idea which of five messages to
          // open. addAttachmentIcon is InboxSDK's supported per-message row
          // indicator; best-effort, since it's the one part of this that
          // depends on Gmail rendering an icon area for the message.
          try {
            messageView.addAttachmentIcon({
              iconHtml: '<span style="font-size:13px;line-height:1">🏷️</span>',
              tooltip: `InboxPulse — ${flagSummary(chipSignals)}. Open the message to suggest a different tag.`,
            });
          } catch (err) {
            console.warn('[InboxPulse] row marker unavailable:', err);
          }

          const tryInject = (): boolean => {
            let body: HTMLElement | null = null;
            try {
              body = messageView.getBodyElement();
            } catch {
              body = null;
            }
            const parent = body?.parentElement;
            if (!body || !parent) return false;
            if (parent.querySelector(':scope > [data-inboxpulse-flags]')) return true; // already injected
            const row = buildFlagRow(chipSignals, submitSuggestion);
            if (row) parent.insertBefore(row, body);
            return true;
          };
          // Collapsed message: no body yet — inject when it expands. Gmail
          // re-collapses and re-expands without re-firing the message handler,
          // so keep listening rather than unsubscribing after the first hit.
          if (!tryInject()) messageView.on('viewStateChange', () => void tryInject());
        } catch (err) {
          console.warn('[InboxPulse] message handler failed:', err);
        }
      })();
    });

    // Identifies the thread currently published to the store. Gmail fires the
    // next thread's handler BEFORE the previous thread's `destroy`, so an
    // unconditional clear on destroy would wipe the thread that just opened.
    sdk.Conversations.registerThreadViewHandler((threadView) => {
      // Strip the "x" off Inbox / InboxPulse-* label chips.
      //
      // Gmail renders the chips asynchronously and re-renders them on its own
      // schedule (label edits, window resize, thread re-render), so one pass at
      // handler time is not enough: re-scan on DOM mutations for a short window,
      // then stop so we're not observing the document for the whole session.
      try {
        const subject = threadView.getSubject();
        // report:true on the first pass only — one diagnostic line per thread,
        // so a failure is visible in the console instead of silent.
        guardLabelChips(subject, true);

        // Coalesce mutation bursts: Gmail mutates the DOM constantly, and the
        // scan walks the subject region on every call.
        let queued = 0;
        const observer = new MutationObserver(() => {
          if (queued) return;
          queued = window.setTimeout(() => {
            queued = 0;
            guardLabelChips(subject);
          }, 250);
        });
        observer.observe(document.body, { childList: true, subtree: true });
        const stop = setTimeout(() => observer.disconnect(), 15_000);
        threadView.on('destroy', () => {
          clearTimeout(stop);
          if (queued) clearTimeout(queued);
          observer.disconnect();
        });
      } catch (err) {
        console.warn('[InboxPulse] label guard failed:', err);
      }

      // getMessageViewsAll(), NOT getMessageViews(). The latter returns only the
      // messages Gmail has actually rendered, which for a collapsed thread is
      // just the one it auto-expands — usually the reader's own latest reply.
      // That produced "1 message sent · 0 matched": the single id collected was
      // the reader's own sent mail, which isn't ingested, so the thread resolved
      // to nothing even though its other messages were stored all along.
      const messages = threadView.getMessageViewsAll();
      if (messages.length === 0) return;

      const token = ++activeThreadToken;

      // New conversation — drop the previous thread's message selection so the
      // "This message" section doesn't briefly describe an email from the
      // thread the reader just left. The message registry goes with it: those
      // views belong to a conversation that is no longer on screen, and the
      // handler above refills it as Gmail builds this thread's messages.
      resetActiveMessage();
      clearMessages();
      // The picker's list goes with them. Its entries describe rows in the
      // thread pane the reader has just left, and the handler above refills it
      // as Gmail builds this conversation's messages.
      clearThreadMessages();

      // The external sender (first non-tenant participant) — used only to
      // highlight the matching contact and for the "no customer" message.
      // Customer identity itself is resolved from the thread's emails server-side.
      // getSender() is only safe on a loaded message view — now that we iterate
      // ALL views, including collapsed ones, a throw here would abort the whole
      // handler and with it the thread resolution below.
      let senderEmail: string | null = null;
      for (const msg of messages) {
        let email: string | undefined;
        try {
          email = msg.getSender()?.emailAddress?.toLowerCase();
        } catch {
          continue; // not loaded yet — the id path below still covers it
        }
        if (!email) continue;
        const d = email.split('@')[1];
        if (d && !tenantDomains.has(d)) {
          senderEmail = email;
          break;
        }
      }

      // Start this thread's id set. Seeded with whatever views exist now, then
      // topped up by the message handler as Gmail builds the rest — see
      // `publishThread`.
      threadIds = new Set<string>();
      threadSenderEmail = senderEmail;
      providerThreadId = null;

      // Gmail's own id for the conversation, published as soon as it resolves.
      //
      // This is what makes the thread-scoped sections independent of the
      // reader's selection. The message ids below only cover messages Gmail has
      // loaded — often just one, and often the reader's own reply, which the
      // sync never ingested — so resolving the thread through them meant trend
      // and flagged messages appeared only when an ANALYZED message happened to
      // be open. The conversation's id doesn't move with the selection.
      void threadView
        .getThreadIDAsync()
        .then((id) => {
          if (token !== activeThreadToken) return;
          providerThreadId = id || null;
          publishThread(token);
        })
        .catch(() => {
          /* thread id unavailable — the message-id path below still applies */
        });

      void Promise.all(
        messages.map(async (msg) => {
          try {
            return await msg.getMessageIDAsync();
          } catch {
            return null;
          }
        }),
      ).then((ids) => {
        // A newer thread opened while we were resolving ids — drop this result
        // rather than overwriting the thread the reader is actually looking at.
        if (token !== activeThreadToken) return;
        for (const id of ids) if (id) threadIds.add(id);
        publishThread(token);
      });

      threadView.on('destroy', () => {
        // Only clear if no other thread has taken over in the meantime.
        if (token !== activeThreadToken) return;
        clearThread();
        clearThreadMessages();
      });
    });

    // ---- The InboxPulse rail entry -------------------------------------
    // Created once per Gmail session; every view lives inside it as a tab.
    //
    // Deliberately LAST, and deliberately NOT awaited.
    // `Global.addSidebarContentPanel` waits internally on
    // waitForGlobalSidebarReady(), which does not settle in every Gmail view.
    // Awaiting it here — while it sat above the handlers — silently killed the
    // message and thread handlers, so a single blocked line cost both the panel
    // AND the label-chip guarding. Registering the handlers first means a slow
    // or never-resolving panel can no longer take anything else down with it,
    // and the synchronous guard covers a throw from buildPanelHost.
    //
    // It resolves to null (rather than throwing) when Gmail exposes no companion
    // rail, so the outcome is still reported — just off the critical path.
    try {
      document.documentElement.setAttribute('data-inboxpulse-panel', 'pending');
      sdk.Global.addSidebarContentPanel({
        el: buildPanelHost(queryClient),
        title: 'InboxPulse',
        iconUrl: chrome.runtime.getURL('icons/icon-32.png'),
      })
        .then((panel) => {
          if (panel) {
            console.log('[InboxPulse] global sidebar panel added');
            document.documentElement.setAttribute('data-inboxpulse-panel', 'ok');
          } else {
            console.error(
              '[InboxPulse] global sidebar panel returned NULL — Gmail exposed no companion rail to InboxSDK.',
            );
            document.documentElement.setAttribute('data-inboxpulse-panel', 'null');
          }
        })
        .catch((err: Error) => {
          console.error('[InboxPulse] global sidebar panel FAILED:', err);
          document.documentElement.setAttribute('data-inboxpulse-panel', 'error');
        });
    } catch (err) {
      console.error('[InboxPulse] building the sidebar panel threw:', err);
      document.documentElement.setAttribute('data-inboxpulse-panel', 'build-error');
    }
  },
});
