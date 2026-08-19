/**
 * Layout harness for the sidebar shell.
 *
 * Mounts the real manager shell — same app-shell.js, same section modules, same
 * manager.css, same shadow-root isolation — inside a 400px column so the narrow
 * layout can be inspected without Gmail. Gmail itself can't be automated here
 * (it needs a live Google session), but everything below InboxSDK can.
 *
 * `apiFetch` talks to the real service through the local gcloud proxy, so what
 * renders is production data, not fixtures. The harness is served over
 * http://localhost by Vite specifically so the manager service's CORS
 * allow-list (chrome-extension:// and localhost origins) accepts it — a
 * file:// page would send `Origin: null` and be rejected.
 *
 *   Terminal 1:  gcloud run services proxy crm-manager --region us-central1 --port 8080
 *   Terminal 2:  npx vite --port 5177
 *   Open:        http://localhost:5177/harness/index.html
 *
 * NOT part of the extension build — WXT only bundles entrypoints/.
 */

import { mountApp, MANAGER_SECTIONS } from '../manager/app-shell.js';
import managerCss from '../manager/manager.css?inline';

const MANAGER_BASE = 'http://localhost:8080';

/** Mirrors lib/manager-client.ts's contract: { ok, status, json }. */
async function apiFetch(path, init) {
  try {
    const res = await fetch(`${MANAGER_BASE}${path}`, init ?? {});
    let json = null;
    try {
      json = await res.json();
    } catch {
      /* non-JSON body */
    }
    return { ok: res.ok, status: res.status, json };
  } catch (err) {
    console.error('[harness] fetch failed', path, err);
    return { ok: false, status: 0, json: null, error: err.message };
  }
}

/** Stands in for the React thread tab, which needs InboxSDK to say anything real. */
function mountThreadPlaceholder(host) {
  host.innerHTML = `
    <div style="padding:24px 12px;text-align:center;color:#5f6368;font-size:13px">
      <p style="margin:0 0 6px">Thread tab</p>
      <p style="margin:0;font-size:12px;color:#8a8f95">
        Renders the React CRM view in Gmail. Needs InboxSDK, so it is stubbed here.
      </p>
    </div>`;
  return {};
}

const host = document.getElementById('panel');
const shadow = host.attachShadow({ mode: 'open' });

const style = document.createElement('style');
style.textContent = managerCss;
shadow.appendChild(style);

const root = document.createElement('div');
shadow.appendChild(root);

const sections = [
  { id: 'thread', label: 'Thread', usesFilters: false, mount: mountThreadPlaceholder },
  ...MANAGER_SECTIONS,
];

const shell = mountApp(root, {
  apiFetch,
  sections,
  initialSection: new URLSearchParams(location.search).get('section') || 'dashboard',
});

// Let the screenshot driver switch tabs via ?section=, and expose the shell for
// manual poking from the devtools console.
window.__shell = shell;
