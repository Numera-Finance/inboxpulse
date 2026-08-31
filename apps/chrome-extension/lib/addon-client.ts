/**
 * Reads the Workspace add-on's rendered cards so the extension can display the
 * same panel Gmail's own add-on shows.
 *
 * Why fetch rendered cards rather than rebuild the layout in React: the add-on
 * already decides what a section says, which numbers it shows and when it
 * withholds them. A second implementation of those decisions is the failure this
 * codebase keeps hitting — two email-reduction paths, the `/api/manager/*` shape
 * mismatch. Rendering the add-on's own output makes the two agree by
 * construction, the same reasoning lib/internal-client.ts gives for routing
 * panel reads through the chips' path.
 *
 * LOCAL ONLY. In production the add-on verifies a Google-signed ID token
 * (ADDON_VERIFY_ID_TOKEN=true) and an extension cannot mint one. This works
 * against a local add-on where that check is off; shipping it would need the
 * add-on to accept the internal service key as an alternative caller proof.
 */

import {
  isRuntimeAlive,
  sendRuntimeMessage,
  RUNTIME_GONE_MESSAGE,
} from './runtime-guard';

/** Either opens a link or invokes an add-on action URL. */
export interface CardOnClick {
  openLink?: { url?: string };
  /**
   * `parameters` is what the card attached to this action — which message, which
   * label, which stance. It was missing from this type, so the renderer could
   * not have forwarded it even if it had tried, and every parameterised button
   * in the panel reached the add-on carrying nothing.
   */
  action?: { function?: string; parameters?: Array<{ key?: string; value?: string }> };
}

/** A Cards-v2 button. */
export interface CardButton {
  text?: string;
  onClick?: CardOnClick;
}

export interface CardWidget {
  textParagraph?: { text?: string };
  decoratedText?: {
    startIcon?: { knownIcon?: string };
    topLabel?: string;
    text?: string;
    bottomLabel?: string;
    wrapText?: boolean;
    button?: CardButton;
    /**
     * Makes the WHOLE ROW the link, with no visible control.
     *
     * Not optional in practice: every "Where the fires are" row uses this and
     * carries no button at all — the add-on dropped the per-row "Open" pills
     * because six identical ones in a 400px column are decoration. A renderer
     * that only handles `button` therefore renders that entire section as
     * unclickable text and looks correct while doing it.
     */
    onClick?: CardOnClick;
  };
  image?: { imageUrl?: string; altText?: string };
  buttonList?: { buttons?: CardButton[] };
  divider?: Record<string, never>;
}

export interface CardSection {
  header?: string;
  widgets?: CardWidget[];
}

/**
 * A chart the add-on measured, in a shape something can plot.
 *
 * Mirrors `apps/addon/src/cards/chart.ts`. The add-on renders every chart TWICE
 * from one description — as block-character bars in the card (which is all Gmail
 * can draw) and as this spec — so the two are the same numbers by construction.
 * This side replaces the block bars with real SVG; it never computes a value,
 * re-derives a rate, or decides what may be drawn. Those are the add-on's
 * decisions and ADR-031 keeps them there.
 *
 * WHY IT ARRIVES BESIDE THE CARD RATHER THAN INSIDE IT. A trigger response is
 * parsed by Google directly as a `RenderActions` proto, which rejects unknown
 * fields — a `charts` key inside the Card fails the WHOLE card in real Gmail
 * rather than being ignored. So it rides as a sibling key that only a caller
 * asking for it ever receives, and Google never asks.
 */
export interface ChartSpec {
  id: string;
  title: string;
  /** A ranking, or a share of a whole. See the add-on's ChartKind for why only two. */
  kind: 'bars' | 'donut';
  /** False means the analyst said not to act on this. Render rows, never bars. */
  chartable: boolean;
  verdict?: string;
  columns: Array<{
    name: string;
    role: 'label' | 'count' | 'rate' | 'share' | 'denominator' | 'sample_n';
    label: string;
    unit?: 'percent' | 'count' | 'days' | 'hours';
  }>;
  rows: Array<{
    label: string;
    count?: number | null;
    rate?: number | null;
    /**
     * This row's share of the whole, in whole percents — a donut's magnitude.
     *
     * Not a rate: one denominator for the chart rather than one per row, and no
     * `baseRate` to compare against. Computed by the add-on so both renderings
     * print the same percentage without either dividing.
     */
    share?: number | null;
    sampleN?: number | null;
    /** Precomputed upstream. Never re-derived here — see the add-on's comment. */
    belowFloor?: boolean;
    /**
     * A second figure for this row, printed beside `n` and never plotted.
     *
     * Carries its own unit as text, because a question can have two honest
     * readings that rank differently and the bars can only draw one.
     */
    note?: string;
  }>;
  baseRate?: { value: number; unit: 'percent'; label: string } | null;
  /**
   * The whole a donut's slices are parts of. Printed, never plotted.
   *
   * A ring looks identical whether it divides forty messages or forty thousand,
   * so the count it divides has to be stated in words.
   */
  denominator?: {
    value: number;
    label: string;
    of?: { value: number; label: string } | null;
  } | null;
  window?: { start?: string; end?: string; cutoffSource?: string; blindTail?: string };
  caveats?: string[];
  /** How many card widgets this chart's fallback occupies. The splice anchor. */
  fallbackWidgets?: number;
}

export interface AddonResponse {
  ok: boolean;
  status: number;
  json: unknown;
  error?: string;
}

/**
 * Pull the card out of the add-on's envelope.
 *
 * The alternate-runtime shape is
 * `renderActions -> action -> navigations -> pushCard(Card)`, but the add-on
 * returns the bare `action` form for these two endpoints. Accept both rather
 * than making callers guess, and return [] rather than throwing — a card that
 * cannot be parsed should render as "couldn't load", not crash the sidebar.
 */
export function cardSections(json: unknown): CardSection[] {
  if (!json || typeof json !== 'object') return [];
  const root = json as {
    action?: { navigations?: Array<{ pushCard?: { sections?: CardSection[] } }> };
    renderActions?: { action?: { navigations?: Array<{ pushCard?: { sections?: CardSection[] } }> } };
  };
  const navs = root.renderActions?.action?.navigations ?? root.action?.navigations ?? [];
  return navs.flatMap((n) => n.pushCard?.sections ?? []);
}

/**
 * The toast an action answered with, if it answered with one.
 *
 * In Gmail a `notification` is a real affordance — the host pops it over the
 * panel. Here it has nowhere to go: `cardSections` reads `navigations`, a
 * notification has none, so the panel renders NOTHING and the press looks
 * inert. Several of the add-on's refusals are notifications and only
 * notifications — "Saving is not configured", "Could not tell which message to
 * save", "Could not analyse this thread, so nothing was saved" — so the reasons
 * a write did not happen were exactly the messages this panel could not show.
 */
export function cardNotification(json: unknown): string | null {
  if (!json || typeof json !== 'object') return null;
  const root = json as {
    action?: { notification?: { text?: string } };
    renderActions?: { action?: { notification?: { text?: string } } };
  };
  const text =
    root.renderActions?.action?.notification?.text ?? root.action?.notification?.text ?? null;
  return typeof text === 'string' && text.trim() ? text : null;
}

/**
 * The chart specs riding beside the card, or [] when the add-on sent none.
 *
 * Returns [] rather than throwing on anything unexpected, for the same reason
 * `cardSections` does: a card that cannot be parsed should lose a chart, not
 * blank the panel. An older add-on simply has no `charts` key, and the block-bar
 * fallback in the card is a complete rendering on its own — so degrading here
 * costs the SVG and nothing else.
 */
export function cardCharts(json: unknown): ChartSpec[] {
  if (!json || typeof json !== 'object') return [];
  const charts = (json as { charts?: unknown }).charts;
  if (!Array.isArray(charts)) return [];
  return charts.filter(
    (c): c is ChartSpec =>
      Boolean(c) &&
      typeof c === 'object' &&
      typeof (c as ChartSpec).title === 'string' &&
      // A SPEC WITH NO KIND IS NOT DEFAULTED TO BARS.
      //
      // The splice replaces a run of widgets by title match alone, so a spec whose
      // shape we cannot read would have its fallback consumed and be drawn as
      // whatever the renderer falls through to — a composition rendered as a
      // ranking, silently. Dropping it here leaves the card's own rendering in
      // place, which is complete.
      typeof (c as ChartSpec).kind === 'string',
  );
}

/**
 * Tell the add-on who is looking.
 *
 * Google identifies the user with a signed `userIdToken`; an extension cannot
 * mint one. Without an address the homepage skips `resolveViewer`, and its two
 * entitlement-scoped sections — "Where the fires are" and "Unhappy clients left
 * waiting" — are not rendered AND not reported as unscoped. The panel then shows
 * the firm-wide sections beside two absences and reads as a working product
 * reporting calm.
 *
 * Honoured only while the add-on has ADDON_VERIFY_ID_TOKEN off. See
 * apps/addon/src/auth/verify.ts.
 */
function withViewer(body: Record<string, unknown>, viewerEmail: string | null) {
  return viewerEmail ? { ...body, devViewerEmail: viewerEmail } : body;
}

async function post(path: string, body: unknown): Promise<AddonResponse> {
  // A dead extension context comes back as null rather than a throw — see
  // lib/runtime-guard.ts — and deserves "reload the tab", not "the add-on is down".
  if (!isRuntimeAlive()) {
    return { ok: false, status: 0, json: null, error: RUNTIME_GONE_MESSAGE };
  }

  const resp = await sendRuntimeMessage<AddonResponse>({
    type: 'ADDON_FETCH',
    path,
    body: JSON.stringify(body ?? {}),
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
 * The add-on homepage card — firm-wide sections, no thread context.
 *
 * `chartSpecs` says only "I can draw" — it is a rendering capability, not an
 * authorization claim like `devViewerEmail` above, and it unlocks no datum the
 * card does not already carry in its widgets. Gmail never sends it, which is
 * what keeps the extra response key away from Google's strict proto parse.
 *
 * `chartKinds` names the shapes THIS build can draw, and it must be kept in step
 * with `DRAWABLE` in CardRenderer. The add-on withholds any other kind rather
 * than sending a spec that would replace the card's own correct rendering with a
 * misdrawn one — the two guards cover opposite directions of version skew, since
 * either side can be the older one.
 */
export function fetchHomepageCard(viewerEmail: string | null = null): Promise<AddonResponse> {
  return post('/homepage', withViewer({ chartSpecs: true, chartKinds: ['bars', 'donut'] }, viewerEmail));
}

/**
 * One message of the open conversation, as the content script can see it.
 *
 * The add-on normally fetches these from Gmail with the token Google gives it.
 * This extension has no Gmail credential at all, so on this path it supplies
 * what it can already read off the page — see lib/message-bodies.ts.
 */
export interface SuppliedMessage {
  id: string;
  from?: string;
  /** Gmail's subject for the conversation. The add-on has no headers on this
   *  path, so without it a saved message is filed as '(no subject)'. */
  subject?: string;
  to?: string[];
  date?: string;
  body: string;
}

/** The contextual card for one open Gmail conversation. */
export function fetchContextualCard(
  messageId: string | null,
  threadId: string | null,
  viewerEmail: string | null = null,
  messages: SuppliedMessage[] = [],
): Promise<AddonResponse> {
  return post(
    '/gmail/contextual',
    withViewer({ gmail: { messageId, threadId, messages } }, viewerEmail),
  );
}

/**
 * Invoke a card action button (`onClick.action.function`), whose value is an
 * absolute add-on URL. Returns the replacement card the add-on renders.
 *
 * SENDS AN EVENT ENVELOPE, not a bare body. It used to post `{}` plus the viewer
 * address, which meant every action arrived at the add-on with
 * `getActionParameters(event)` returning `{}` and `getGmail(event)` returning
 * all-undefined — so a button knew neither which message it was pressed for nor
 * anything else the card had attached to it. The handler then took its "could
 * not do that" branch and answered with a notification, which this panel does
 * not render, so the button appeared to do nothing at all. Three silent
 * failures, one cause.
 *
 * `commonEventObject.parameters` is the shape Google sends and the add-on
 * already reads; matching it means the same handler serves both callers.
 */
export function invokeCardAction(
  fnUrl: string,
  viewerEmail: string | null = null,
  context: {
    parameters?: Record<string, string>;
    messageId?: string | null;
    threadId?: string | null;
    messages?: SuppliedMessage[];
  } = {},
): Promise<AddonResponse> {
  return post(
    fnUrl,
    withViewer(
      {
        commonEventObject: { parameters: context.parameters ?? {} },
        gmail: {
          messageId: context.messageId ?? null,
          threadId: context.threadId ?? null,
          messages: context.messages ?? [],
        },
      },
      viewerEmail,
    ),
  );
}

/**
 * Send the reader to the "This app is QA only." page instead of the web console.
 *
 * This build reads a CLONE. A card link that opened the real console would put
 * a reader in front of production data one click from a panel whose whole point
 * is that it is not production — and worse, would make the two indistinguishable
 * once the tab is open. Routed through the background worker because a
 * chrome-extension:// URL opened from Gmail's origin is blocked unless the page
 * is a web-accessible resource, which it has no other reason to be.
 */
export function openQaNotice(): void {
  if (!isRuntimeAlive()) return;
  void sendRuntimeMessage({ type: 'OPEN_QA_NOTICE' });
}
