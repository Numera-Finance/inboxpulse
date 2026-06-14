/**
 * Gmail content script — uses InboxSDK to reliably detect the sender in a
 * thread view and render a CRM sidebar panel with Shadow DOM isolation.
 *
 * Replaces the old DOM-scraping approach with InboxSDK's stable API:
 *   sdk.Conversations.registerThreadViewHandler → messageView.getSender()
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import InboxSDK from '@inboxsdk/core';
import { SidebarApp } from '../components/SidebarApp';
import { API_BASE_URL } from '../lib/clients';
import cssText from '../assets/globals.css?inline';

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

    const proxyResponse = (await chrome.runtime.sendMessage({
      type: 'PROXY_FETCH',
      url,
      method,
      headers,
      body,
    })) as {
      status: number;
      statusText: string;
      headers: Record<string, string>;
      body: string;
      error?: string;
    };

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

export default defineContentScript({
  matches: ['https://mail.google.com/*'],
  runAt: 'document_end',

  async main() {
    setupFetchProxy();

    const sdk = await InboxSDK.load(2, INBOXSDK_APP_ID);

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

    // One shared QueryClient for all thread panels. Per-thread data is keyed by
    // customerId/messageIds so it never collides; sharing means the auth query
    // (and its unauthenticated 3s poll) runs once, not once per open thread.
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          staleTime: 30_000,
          retry: 1,
        },
      },
    });

    sdk.Conversations.registerThreadViewHandler((threadView) => {
      const messages = threadView.getMessageViews();
      if (messages.length === 0) return;

      // The external sender (first non-tenant participant) — used only to
      // highlight the matching contact and for the "no customer" message.
      // Customer identity itself is resolved from the thread's emails server-side.
      let senderEmail: string | null = null;
      for (const msg of messages) {
        const email = msg.getSender().emailAddress.toLowerCase();
        const d = email.split('@')[1];
        if (d && !tenantDomains.has(d)) {
          senderEmail = email;
          break;
        }
      }

      // Collect every Gmail message ID in the thread. The backend maps these to
      // the linked customer (and sentiment) via the stored email→customer link —
      // authoritative, unlike guessing the customer from the sender's domain.
      // InboxSDK's getMessageIDAsync() returns the same ID stored as messageId.
      const collectThreadMessageIds = async (): Promise<string[]> => {
        const ids = await Promise.all(
          messages.map(async (msg) => {
            try {
              return await msg.getMessageIDAsync();
            } catch {
              return null;
            }
          }),
        );
        return ids.filter((id): id is string => !!id);
      };

      // Create Shadow DOM container to isolate Tailwind from Gmail
      const host = document.createElement('div');
      const shadow = host.attachShadow({ mode: 'open' });

      // Inject processed Tailwind CSS into Shadow DOM
      const style = document.createElement('style');
      style.textContent = cssText;
      shadow.appendChild(style);

      // Create mount point inside shadow
      const mountPoint = document.createElement('div');
      mountPoint.className = 'bg-background text-foreground';
      mountPoint.style.fontSize = '13px';
      mountPoint.style.lineHeight = '1.5';
      mountPoint.style.fontFamily = '"Segoe UI", system-ui, -apple-system, sans-serif';
      shadow.appendChild(mountPoint);

      const root = ReactDOM.createRoot(mountPoint);
      let destroyed = false;

      // Render once the thread's message IDs are collected. SidebarApp shows its
      // own loading skeleton while the customer resolves. Guard against rendering
      // after the thread was destroyed (the async resolve can outlive the view).
      void collectThreadMessageIds().then((threadMessageIds) => {
        if (destroyed) return;
        root.render(
          React.createElement(
            React.StrictMode,
            null,
            React.createElement(
              QueryClientProvider,
              { client: queryClient },
              React.createElement(SidebarApp, { senderEmail, threadMessageIds }),
            ),
          ),
        );
      });

      // Register the sidebar panel with InboxSDK
      threadView.addSidebarContentPanel({
        el: host,
        title: 'InboxPulse',
        iconUrl: chrome.runtime.getURL('icons/icon-32.png'),
      });

      // Clean up React when thread is destroyed. The QueryClient is shared and
      // intentionally NOT cleared here (other open threads may still use it).
      threadView.on('destroy', () => {
        destroyed = true;
        root.unmount();
      });
    });
  },
});
