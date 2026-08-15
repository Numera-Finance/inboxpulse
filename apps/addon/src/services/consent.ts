/**
 * Whether this viewer has agreed to have the open thread read.
 *
 * The panel used to send the open thread to a model the instant it rendered.
 * Nobody was asked. For most users that is invisible; for one who has said he
 * is sensitive about his mail being read, it is the whole question, and a
 * privacy claim printed on a card that reads first and explains afterwards is
 * not a claim, it is a caption.
 *
 * So reading is OFF until the viewer turns it on, and the card says what will
 * happen before it happens.
 *
 * ---------------------------------------------------------------------------
 * WHAT THE PROMISE ACTUALLY COVERS
 * ---------------------------------------------------------------------------
 *
 * The three sentences the card shows have to be literally true, so each is tied
 * to something in the code rather than to intent:
 *
 *   "Only if you turn it on"  — this module. No consent, no model call: the
 *                               thread text is never assembled.
 *   "Nothing is stored"       — analysis-cache.ts is in memory, and its disk
 *                               backing needs ADDON_CACHE_DIR, which is unset
 *                               in production. Cloud Run scaling to zero erases
 *                               it. No thread text reaches the database; the
 *                               add-on has no write path to it.
 *   "Only you see it"         — the card is rendered per request for the viewer
 *                               Google authenticated. Logs carry a salted,
 *                               namespaced hash instead of an address
 *                               (api-client.ts pseudo()), so not even a project
 *                               owner reading logs learns whose panel it was.
 *
 * The one thing it does NOT cover, and which the card therefore states plainly:
 * the thread is sent to Google's Gemini API to be summarized. That is a third
 * party, and burying it would make the rest of the promise worthless.
 *
 * ---------------------------------------------------------------------------
 * WHY MEMORY, AND WHY THAT IS THE HONEST CHOICE
 * ---------------------------------------------------------------------------
 *
 * Consent lives in this process and dies with it, so it is forgotten whenever
 * Cloud Run scales to zero. That is a worse experience than a row in a table —
 * he will be asked again — and it is the right trade twice over: a preference
 * about being read should not outlive the session in a database the person
 * cannot see, and "ephemeral" printed on the card stays true of the consent
 * record itself, not only of the analysis.
 */

/** Viewer email → when they turned reading on. */
const granted = new Map<string, number>();

/** Consent is per person, and the key is the address Google verified. */
function key(viewer: string | undefined): string {
  return (viewer ?? '').trim().toLowerCase();
}

export function hasConsent(viewer: string | undefined): boolean {
  const k = key(viewer);
  return k.length > 0 && granted.has(k);
}

export function grantConsent(viewer: string | undefined): void {
  const k = key(viewer);
  if (k) granted.set(k, Date.now());
}

export function revokeConsent(viewer: string | undefined): void {
  granted.delete(key(viewer));
}

/** For the card's own status line — how long this has been on, in minutes. */
export function consentAgeMinutes(viewer: string | undefined): number | null {
  const at = granted.get(key(viewer));
  return at === undefined ? null : Math.floor((Date.now() - at) / 60000);
}

/** Test seam. Nothing in the request path calls this. */
export function __resetConsent(): void {
  granted.clear();
}
