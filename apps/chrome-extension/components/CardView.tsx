/**
 * The add-on's panel, rendered inside the extension.
 *
 * Shows the contextual (thread) card when a conversation is open and the
 * homepage card underneath it, matching what the Workspace add-on puts in
 * Gmail's rail.
 *
 * This path deliberately does NOT sit behind the session gate the rest of
 * SidebarApp uses. The add-on authenticates its own call to crm-api with the
 * service key; requiring a better-auth cookie here would mean a sandbox with no
 * working OAuth client shows a login screen instead of a panel.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, RefreshCw, AlertTriangle } from 'lucide-react';
import { CardRenderer } from './CardRenderer';
import {
  cardCharts,
  cardNotification,
  cardSections,
  fetchContextualCard,
  fetchHomepageCard,
  invokeCardAction,
  type CardSection,
  type ChartSpec,
  type SuppliedMessage,
} from '../lib/addon-client';
import { getThreadMessagesSnapshot } from '../lib/thread-messages-store';
import { getMessageBody } from '../lib/message-bodies';

/**
 * The open conversation, in the shape the add-on's Gmail fetch would have
 * returned — envelope from InboxSDK, text from Gmail's DOM.
 *
 * Read at call time rather than held in state: this is never rendered, and
 * subscribing would re-fetch the card every time Gmail finished laying out
 * another row.
 *
 * Messages with no text yet are dropped rather than sent empty. A collapsed
 * message Gmail has not expanded has no body to read, and sending it as `''`
 * would tell the add-on the message is blank — which is a claim, where absence
 * is merely the truth.
 */
function openThreadMessages(): SuppliedMessage[] {
  return getThreadMessagesSnapshot()
    .map((entry): SuppliedMessage | null => {
      const body = getMessageBody(entry.message.id);
      if (!body) return null;
      return {
        id: entry.message.id,
        from: entry.message.fromEmail ?? undefined,
        subject: entry.message.subject ?? undefined,
        to: entry.message.recipients,
        date: entry.receivedAt ? new Date(entry.receivedAt).toISOString() : undefined,
        body,
      };
    })
    .filter((m): m is SuppliedMessage => m !== null);
}

/**
 * What to call the wait, taken from the action's URL.
 *
 * "Working…" is true of everything and therefore says nothing; the reader wants
 * to know whether the thing that writes is the thing currently running. Falls
 * back to a generic label rather than guessing at an unknown route.
 */
function labelForAction(fnUrl: string): string {
  if (fnUrl.includes('/gmail/save')) return 'Analysing and saving to InboxPulse…';
  if (fnUrl.includes('/gmail/analyse')) return 'Reading this thread…';
  if (fnUrl.includes('/gmail/triage')) return 'Prioritising your inbox…';
  if (fnUrl.includes('/consent/')) return 'Updating your reading setting…';
  return 'Working…';
}

interface CardViewProps {
  /** Gmail's id for the open message, if one is open. */
  providerMessageId?: string | null;
  /** Gmail's id for the open conversation, if one is open. */
  providerThreadId?: string | null;
  /**
   * The signed-in Gmail address. Without it the add-on cannot scope the two
   * entitlement-scoped sections and drops them silently — see lib/viewer-store.ts.
   */
  viewerEmail?: string | null;
}

interface CardState {
  sections: CardSection[];
  /**
   * Chart specs riding beside the card, for the runs this renderer can draw
   * properly. Empty is the normal state for the contextual card and for any
   * add-on that predates them — the card's own block bars stand in.
   */
  charts: ChartSpec[];
  error: string | null;
}

const EMPTY: CardState = { sections: [], charts: [], error: null };

export function CardView({
  providerMessageId = null,
  providerThreadId = null,
  viewerEmail = null,
}: CardViewProps): React.ReactElement {
  const [thread, setThread] = useState<CardState>(EMPTY);
  const [home, setHome] = useState<CardState>(EMPTY);
  const [loading, setLoading] = useState(true);
  /** Non-null while a card action is in flight; the text names which one. */
  const [acting, setActing] = useState<string | null>(null);
  /** The add-on's own words about what just happened, including refusals. */
  const [notice, setNotice] = useState<string | null>(null);

  /**
   * Refresh the homepage card alone.
   *
   * Split out because an action's reply REPLACES the thread card, and reloading
   * both would immediately overwrite it — see handleAction. The homepage still
   * needs refreshing after an action, because some of them (the reading switch,
   * clearing marks) change what it says.
   */
  const loadHome = useCallback(async (): Promise<void> => {
    const hp = await fetchHomepageCard(viewerEmail);
    setHome({
      sections: cardSections(hp.json),
      charts: cardCharts(hp.json),
      error: hp.ok ? null : (hp.error ?? `Add-on returned ${hp.status}`),
    });
  }, [viewerEmail]);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);

    // A failed fetch and an empty card render identically unless the failure is
    // stated, and only one of them is fixed by starting the add-on. Keep the
    // reason and show it.
    const [ctx, hp] = await Promise.all([
      providerThreadId || providerMessageId
        ? fetchContextualCard(
            providerMessageId,
            providerThreadId,
            viewerEmail,
            openThreadMessages(),
          )
        : Promise.resolve(null),
      fetchHomepageCard(viewerEmail),
    ]);

    setThread(
      ctx === null
        ? EMPTY
        : {
            sections: cardSections(ctx.json),
            charts: cardCharts(ctx.json),
            error: ctx.ok ? null : (ctx.error ?? `Add-on returned ${ctx.status}`),
          },
    );
    setHome({
      sections: cardSections(hp.json),
      charts: cardCharts(hp.json),
      error: hp.ok ? null : (hp.error ?? `Add-on returned ${hp.status}`),
    });
    setLoading(false);
  }, [providerMessageId, providerThreadId, viewerEmail]);

  useEffect(() => {
    void load();
  }, [load]);

  // Card action buttons (for example "Turn on reading") return a replacement
  // card. Re-fetch afterwards so the whole panel reflects the new state rather
  // than just the card that happened to carry the button.
  const handleAction = useCallback(
    async (fnUrl: string, parameters?: Record<string, string>): Promise<void> => {
      // The ids and the thread text travel WITH the press. Google puts them in
      // the event it sends; nothing else here would, and an action that arrives
      // without them cannot tell which message it was pressed for.
      // SAY THAT SOMETHING IS HAPPENING.
      //
      // "Analyse and save" spends 1-5s in a model call before it can answer, and
      // for that whole time the panel was inert — no spinner, no disabled
      // button, nothing. A control that looks identical while working and while
      // broken teaches the reader to press it again, which on a control that
      // WRITES is the worst possible lesson.
      setActing(labelForAction(fnUrl));
      setNotice(null);
      const res = await invokeCardAction(fnUrl, viewerEmail, {
        parameters,
        messageId: providerMessageId,
        threadId: providerThreadId,
        messages: openThreadMessages(),
      }).finally(() => setActing(null));

      // A refusal that arrives as a toast has nowhere to render on this surface,
      // so it is lifted out and shown. See cardNotification — the add-on's
      // reasons for NOT writing are almost all delivered this way.
      const toast = cardNotification(res.json);
      if (toast) setNotice(toast);
      else if (!res.ok) setNotice(res.error ?? `The add-on returned ${res.status}.`);

      // THE REPLY IS THE RESULT. DO NOT REFRESH IT AWAY.
      //
      // The response used to be discarded outright, which threw away the only
      // thing that reports what an action did — "Saved to InboxPulse", "Not
      // saved: the API returned 500". The refresh then rendered a card that
      // looks much like the one before the press, so a write and a failed write
      // were indistinguishable, which is the failure this panel keeps
      // producing.
      //
      // Painted first, then reconciled: the reply is what happened, the refresh
      // is what is now true, and on this path they agree.
      //
      // A saved NEUTRAL message is the case that forced this. The refreshed card
      // surfaces stored analysis through the Flagged-messages section, and
      // neutral mail is not flagged — so after a successful save the panel
      // re-rendered the identical pre-press card, buttons and all, and the write
      // was invisible. Two real saves were confirmed in the database while the
      // sidebar showed nothing at all.
      //
      // So the reply stands, and only the homepage is reconciled beneath it.
      const replied = cardSections(res.json);
      if (replied.length) {
        setThread({ sections: replied, charts: cardCharts(res.json), error: null });
        await loadHome();
      } else {
        await load();
      }
    },
    [load, loadHome, viewerEmail, providerMessageId, providerThreadId],
  );

  const failure = thread.error ?? home.error;
  const nothing = !thread.sections.length && !home.sections.length;

  return (
    <div className="p-4">
      <div className="flex items-center justify-between pb-2">
        <h1 className="text-sm font-semibold text-foreground">InboxPulse</h1>
        <button
          onClick={() => void load()}
          className="rounded-md p-1 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          title="Refresh"
        >
          <RefreshCw size={14} />
        </button>
      </div>

      {/* An action in flight outranks the ordinary card refresh: it is the one
          the reader started, it is the slow one, and it is the one that writes. */}
      {acting && (
        <div
          className="mb-3 flex items-center gap-2 rounded-md border border-primary/30 bg-primary/10 p-3"
          role="status"
          aria-live="polite"
        >
          <Loader2 size={14} className="shrink-0 animate-spin text-primary" />
          <div className="space-y-0.5">
            <p className="text-xs font-medium text-foreground">{acting}</p>
            <p className="text-xs text-muted-foreground">
              This runs a model over the conversation and can take a few seconds.
            </p>
          </div>
        </div>
      )}

      {/* What the add-on said. In Gmail this is a toast the host pops; here it
          would otherwise be dropped entirely — see cardNotification. */}
      {!acting && notice && (
        <div className="mb-3 flex items-start justify-between gap-2 rounded-md border border-border bg-muted/50 p-3">
          <p className="text-xs text-foreground">{notice}</p>
          <button
            onClick={() => setNotice(null)}
            className="shrink-0 text-xs text-muted-foreground hover:text-foreground"
            title="Dismiss"
          >
            ✕
          </button>
        </div>
      )}

      {loading && !acting && (
        <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
          <Loader2 size={16} className="animate-spin" />
          <span>Loading cards…</span>
        </div>
      )}

      {!loading && failure && (
        <div className="mb-3 flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3">
          <AlertTriangle size={14} className="mt-0.5 shrink-0 text-destructive" />
          <div className="space-y-1">
            <p className="text-xs font-medium text-destructive">Couldn’t reach the add-on</p>
            <p className="text-xs text-destructive/90">{failure}</p>
            <p className="text-xs text-muted-foreground">
              Start it with <code>pnpm --filter @crm/addon dev</code>, and check
              WXT_ADDON_URL matches the port it logs.
            </p>
          </div>
        </div>
      )}

      {!loading && !failure && nothing && (
        <p className="py-6 text-sm text-muted-foreground">
          The add-on returned no sections for this view.
        </p>
      )}

      {!loading && (
        // Inert while an action runs. The save is idempotent on the natural keys
        // so a double press cannot duplicate a row, but it would spend a second
        // model call and race the refresh — and a button that still looks
        // pressable during a multi-second write invites exactly that.
        <div className={`space-y-4 ${acting ? 'pointer-events-none opacity-50' : ''}`}>
          {thread.sections.length > 0 && (
            <CardRenderer sections={thread.sections} charts={thread.charts} onAction={handleAction} />
          )}
          {thread.sections.length > 0 && home.sections.length > 0 && (
            <div className="border-t border-border" />
          )}
          {home.sections.length > 0 && (
            <CardRenderer sections={home.sections} charts={home.charts} onAction={handleAction} />
          )}
        </div>
      )}
    </div>
  );
}
