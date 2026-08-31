/**
 * Layout harness for the Panel tab.
 *
 * Mounts the REAL CardView — same addon-client, same CardRenderer, same
 * card.css — inside a 400px column, so the add-on's cards can be inspected
 * without Gmail. Gmail itself can't be automated here (it needs a live Google
 * session), but everything below InboxSDK can.
 *
 * The ONLY thing stubbed is Chrome's messaging transport, which does not exist
 * on a plain web page. The stub does exactly what entrypoints/background.ts
 * does — POST to the add-on, return { ok, status, json } — so what renders is
 * the add-on's real output against the clone, not a fixture.
 *
 * OPEN_QA_NOTICE is caught and shown in the corner instead of opening a tab.
 * That is the point of the harness for this feature: a link that would have
 * gone to the web console has to be visibly proven NOT to have gone there.
 *
 *   Terminal 1:  pnpm --filter @crm/api dev
 *   Terminal 2:  pnpm --filter @crm/addon dev
 *   Terminal 3:  npx vite --port 5177
 *   Open:        http://localhost:5177/harness/card.html
 *
 * NOT part of the extension build — WXT only bundles entrypoints/.
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import { CardView } from '../components/CardView';
import cardCss from '../assets/card.css?inline';

const ADDON_URL = 'http://localhost:4005';

/** Whoever the panel should be scoped to. Override with ?viewer=… */
const VIEWER =
  new URLSearchParams(location.search).get('viewer') ?? 'npradhan@mystartupcfo.com';

function reportQaClick(): void {
  const el = document.getElementById('qa-log');
  if (!el) return;
  el.style.display = 'block';
  el.innerHTML =
    '<b>QA-only page opened.</b><br>A card link that points at the web console was ' +
    'intercepted and did not navigate. In the extension this opens ' +
    '<code>chrome-extension://…/qa-only.html</code>.';
}

// Stand in for chrome.runtime, mirroring background.ts's ADDON_FETCH handler.
(globalThis as unknown as { chrome: unknown }).chrome = {
  runtime: {
    id: 'harness',
    lastError: undefined,
    async sendMessage(payload: { type: string; path?: string; body?: string }) {
      if (payload.type === 'OPEN_QA_NOTICE') {
        reportQaClick();
        return { ok: true };
      }
      if (payload.type !== 'ADDON_FETCH') return { ok: false, status: 0, json: null };

      const path = payload.path ?? '';
      const url = path.startsWith('http') ? path : `${ADDON_URL}${path}`;
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: payload.body ?? '{}',
        });
        let json: unknown = null;
        try {
          json = await res.json();
        } catch {
          /* non-JSON body */
        }
        return { ok: res.ok, status: res.status, json };
      } catch (err) {
        return {
          ok: false,
          status: 0,
          json: null,
          error: `Can't reach the InboxPulse add-on at ${ADDON_URL}. ${(err as Error).message}`,
        };
      }
    },
  },
};

const panel = document.getElementById('panel')!;

// Same shadow-root isolation the real panel uses, so the harness page's own
// styles cannot flatter the card's layout.
const shadow = panel.attachShadow({ mode: 'open' });
const style = document.createElement('style');
// globals.css needs Tailwind's build step, which this page does not run; the
// card itself is styled entirely by card.css, and CardView's chrome degrades to
// unstyled text rather than disappearing.
style.textContent = cardCss;
shadow.appendChild(style);
const mount = document.createElement('div');
shadow.appendChild(mount);

ReactDOM.createRoot(mount).render(
  React.createElement(
    React.StrictMode,
    null,
    React.createElement(CardView, { viewerEmail: VIEWER }),
  ),
);
