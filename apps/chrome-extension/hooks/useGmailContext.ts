import { useState, useEffect } from 'react';

export interface GmailContext {
  senderEmail: string | null;
  senderDomain: string | null;
}

const STORAGE_KEY = 'gmailContext';

/**
 * Listen for Gmail context updates from the content script.
 * The content script writes { senderEmail, senderDomain } to chrome.storage.session,
 * and this hook subscribes to changes.
 */
export function useGmailContext(): GmailContext {
  const [context, setContext] = useState<GmailContext>({
    senderEmail: null,
    senderDomain: null,
  });

  useEffect(() => {
    // Read initial value
    chrome.storage.session.get(STORAGE_KEY, (result) => {
      const stored = result[STORAGE_KEY] as GmailContext | undefined;
      if (stored) {
        setContext(stored);
      }
    });

    // Listen for changes
    const listener = (
      changes: { [key: string]: chrome.storage.StorageChange },
      areaName: string,
    ): void => {
      if (areaName === 'session' && changes[STORAGE_KEY]) {
        const newValue = changes[STORAGE_KEY].newValue as GmailContext | undefined;
        setContext(newValue ?? { senderEmail: null, senderDomain: null });
      }
    };

    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }, []);

  return context;
}
