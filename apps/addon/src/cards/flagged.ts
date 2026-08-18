import { type CardSection, type Widget, deco, text, heading } from './widgets';

/**
 * "Flagged messages" — design §6. Lists the thread's flagged messages in
 * chronological order (earliest at the top, most recent at the bottom), each
 * showing its flag(s), the "why flagged" reason, and provenance ("Keyword rule
 * match" vs "AI · N%").
 *
 * Each row deep-links into the message it describes, so clicking drills down to
 * the email in Gmail.
 *
 * The design's remaining interactive affordances (Close/Reopen, Not an
 * escalation, Share to Chat) need task-mutation endpoints + CardService actions
 * and are deliberately out of this first pass.
 */

export interface FlaggedFlag {
  type: string;
  label: string;
  detail?: string;
  provenance: string;
}

export interface FlaggedMessage {
  messageId: string;
  fromEmail: string;
  fromName: string | null;
  receivedAt: string;
  subject: string;
  severity: number;
  flags: FlaggedFlag[];
}

/**
 * Colour by flag TYPE, not by the message's severity score — a message carries
 * one severity but can carry several flags, so scoring the row would paint an
 * upsell the same red as the escalation sitting next to it.
 *
 * Upsell and kudos are good news and must not look like alarms; that is the
 * whole reason this is per-flag.
 */
function flagColor(f: FlaggedFlag): string {
  const t = f.type;
  if (t === 'escalation' || t === 'competitor') return '#c5221f';
  if (t === 'churn') return /critical|high/i.test(f.label) ? '#c5221f' : '#b06000';
  if (t === 'upsell' || t === 'kudos') return '#137333';
  return '#b06000';
}

/** `text` is an HTML subset, so model-authored strings must be escaped. */
function escapeText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s;
}

function day(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
}

/**
 * Gmail deep link to a single message. `#all/<id>` searches All Mail rather than
 * assuming the message is still in the inbox.
 *
 * Account targeting goes through `?authuser=<email>`, NOT the `/u/<n>/` path
 * segment: that segment takes an account INDEX (0, 1, 2…), so putting an email
 * there makes Gmail fail to resolve the account and serve its "Temporary Error
 * (404) — your account is temporarily unavailable" page before it ever looks for
 * the message. With no known viewer we fall back to the default account, `u/0`.
 *
 * Caveat: `messageId` is the provider id of the mailbox that INGESTED the thread.
 * If that was a teammate's mailbox, the id won't resolve in the viewer's Gmail —
 * the same per-mailbox id problem `fetchMessageHeaders`' RFC Message-ID solves on
 * the resolution path (flagged rows don't carry that id today).
 */
export function gmailMessageUrl(messageId: string, viewerEmail?: string): string {
  const target = viewerEmail
    ? `?authuser=${encodeURIComponent(viewerEmail)}`
    : 'u/0/';
  return `https://mail.google.com/mail/${target}#all/${encodeURIComponent(messageId)}`;
}

export interface FlaggedSectionOptions {
  /** Signed-in user's email — targets the right account in Gmail deep links. */
  viewerEmail?: string;
  /**
   * Public base URL of this add-on. When set, rows expand IN THE PANEL via an
   * action callback; without it (unit tests, no ADDON_BASE_URL) they fall back to
   * opening the message in Gmail, since Google can only call back an absolute URL.
   */
  baseUrl?: string;
  /** InboxPulse thread id, echoed back so the callback can re-read the flags. */
  threadId?: string;
  /** How many messages to list. */
  max?: number;
}

/**
 * Build the Flagged-messages section, or null when nothing is flagged.
 *
 * `max` caps how many messages are listed. The cap keeps the MOST SEVERE ones
 * (the input arrives severity-sorted), but the rendered list is then ordered
 * oldest → newest so it reads as the thread's timeline.
 */
export function buildFlaggedSection(
  messages: FlaggedMessage[],
  options: FlaggedSectionOptions = {},
): CardSection | null {
  const { viewerEmail, baseUrl, threadId, max = 5 } = options;
  if (!messages || messages.length === 0) return null;

  const shown = [...messages]
    .sort((a, b) => b.severity - a.severity)
    .slice(0, max)
    .sort((a, b) => new Date(a.receivedAt).getTime() - new Date(b.receivedAt).getTime());

  const widgets: Widget[] = shown.map((m) => {
    // Colour the flag labels by severity. <font color> is the only formatting
    // CardService offers and it costs nothing, so a list of flags should not
    // render as undifferentiated grey text — the severity IS the point.
    // DecoratedText's topLabel and bottomLabel are PLAIN TEXT — only `text`
    // renders the HTML subset. Colouring the labels therefore means moving them
    // into `text`, or the <font> tag prints literally on the card.
    const labels = m.flags
      .slice(0, 3)
      .map((f) => `<font color="${flagColor(f)}"><b>${escapeText(f.label)}</b></font>`)
      .join(' · ');
    const primary = m.flags[0];
    const who = m.fromName || m.fromEmail;
    const why = primary?.detail ? truncate(primary.detail, 160) : truncate(m.subject, 80);
    return deco({
      topLabel: [who, day(m.receivedAt)].filter(Boolean).join(' · '),
      text: `${labels}<br>${escapeText(why)}`,
      bottomLabel: primary?.provenance,
      wrapText: true,
      // Expand in the panel rather than navigating: the add-on can't move Gmail's
      // thread pane, but it CAN push a detail card of its own. Falls back to
      // opening Gmail (as an overlay where supported) when there's no base URL for
      // Google to call back.
      onClick: baseUrl
        ? {
            action: {
              function: `${baseUrl.replace(/\/$/, '')}/gmail/flagged/detail`,
              parameters: [
                { key: 'messageId', value: m.messageId },
                ...(threadId ? [{ key: 'threadId', value: threadId }] : []),
              ],
            },
          }
        : { openLink: { url: gmailMessageUrl(m.messageId, viewerEmail), openAs: 'OVERLAY' } },
    });
  });

  if (messages.length > shown.length) {
    widgets.push(text(`+ ${messages.length - shown.length} more flagged message${messages.length - shown.length > 1 ? 's' : ''} in this thread.`));
  }

  return { header: heading('Flagged messages'), widgets };
}
