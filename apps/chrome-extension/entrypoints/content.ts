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

    // Fetch the tenant domain from the API so we correctly identify
    // internal vs external participants regardless of who has access.
    let tenantDomain = '';
    try {
      const res = await fetch(`${API_BASE_URL}/api/users/me`, { credentials: 'include' });
      if (res.ok) {
        const json = (await res.json()) as { success: boolean; data?: { tenantDomain?: string | null } };
        tenantDomain = json.data?.tenantDomain?.toLowerCase() ?? '';
      }
    } catch {
      // Fall back to user's email domain if API is unreachable
    }

    // Fall back to the logged-in user's email domain if tenant domain unavailable
    if (!tenantDomain) {
      const currentUser = sdk.User.getEmailAddress();
      tenantDomain = currentUser.split('@')[1]?.toLowerCase() ?? '';
    }

    sdk.Conversations.registerThreadViewHandler((threadView) => {
      const messages = threadView.getMessageViews();
      if (messages.length === 0) return;

      // Find the first external domain from the thread participants.
      // Check senders first, then recipients, to find a customer domain.
      let domain: string | null = null;
      let senderEmail: string | null = null;

      // 1. Check senders for an external domain
      for (const msg of messages) {
        const sender = msg.getSender();
        const d = sender.emailAddress.split('@')[1]?.toLowerCase();
        if (d && d !== tenantDomain) {
          domain = d;
          senderEmail = sender.emailAddress.toLowerCase();
          break;
        }
      }

      // 2. If all senders are internal, check recipients for an external domain
      if (!domain) {
        for (const msg of messages) {
          const recipientEmails = msg.getRecipientEmailAddresses();
          for (const email of recipientEmails) {
            const d = email.split('@')[1]?.toLowerCase();
            if (d && d !== tenantDomain) {
              domain = d;
              senderEmail = email.toLowerCase();
              break;
            }
          }
          if (domain) break;
        }
      }

      // 3. Fall back to the first message's sender domain if no external found
      if (!domain) {
        const fallbackSender = messages[0].getSender();
        domain = fallbackSender.emailAddress.split('@')[1]?.toLowerCase() ?? null;
        senderEmail = fallbackSender.emailAddress.toLowerCase() ?? null;
      }
      if (!domain) return;

      console.log('[CRM Extension] Thread sender domain:', domain);

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

      // Fresh QueryClient per thread to avoid stale data across navigations
      const queryClient = new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            retry: 1,
          },
        },
      });

      const root = ReactDOM.createRoot(mountPoint);
      root.render(
        React.createElement(
          React.StrictMode,
          null,
          React.createElement(
            QueryClientProvider,
            { client: queryClient },
            React.createElement(SidebarApp, { senderDomain: domain, senderEmail }),
          ),
        ),
      );

      // Register the sidebar panel with InboxSDK
      threadView.addSidebarContentPanel({
        el: host,
        title: 'CRM',
        iconUrl: chrome.runtime.getURL('icons/icon-32.png'),
      });

      // Clean up React and QueryClient when thread is destroyed
      threadView.on('destroy', () => {
        root.unmount();
        queryClient.clear();
      });
    });
  },
});
