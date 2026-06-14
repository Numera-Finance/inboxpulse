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

export default defineBackground(() => {
  // Handle messages from content script sidebar
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === 'LOGIN') {
      handleLogin()
        .then(() => sendResponse({ success: true }))
        .catch((err: Error) => sendResponse({ success: false, error: err.message }));
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
