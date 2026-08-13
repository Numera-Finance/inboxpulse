import { type Card, type CardSection, type Widget, text, deco, heading, separated } from './widgets';
import { buildTrendSection, type TrendPoint } from './trend';
import { buildFlaggedSection, type FlaggedMessage } from './flagged';
import type { MessageHeaders } from '../gmail/gmail-api';
import type { LiveAnalysis } from '../services/live-analysis';

export type ThreadStatus =
  | 'preview'
  | 'unverified'
  | 'unidentified'
  | 'untracked'
  /**
   * Gmail refused the read of the open message — the token carried no Gmail
   * scope. Distinct from `untracked`, which means we DID read the message and
   * found nothing tracked. Conflating them made the panel confidently explain
   * the wrong problem.
   */
  | 'unreadable'
  | 'resolved';

export interface ThreadTask {
  done: boolean;
  assignee?: string;
  problem?: string;
  resolution?: string;
}

export interface ThreadCardInput {
  messageId?: string;
  status: ThreadStatus;
  accountName?: string;
  flags?: string[];
  subject?: string;
  fromEmail?: string;
  receivedAt?: string;
  task?: ThreadTask | null;
  /** Envelope headers of the open message, read from Gmail. */
  headers?: MessageHeaders;
  /** Per-message sentiment trend for the whole thread (oldest→newest). */
  trend?: TrendPoint[];
  /** Flagged messages across the thread (most-severe first). */
  flagged?: FlaggedMessage[];
  /** InboxPulse thread id, echoed into flagged-row actions. */
  threadId?: string;
  /**
   * Public base URL of the add-on. Receives the flagged-row action callbacks that
   * expand a message in the panel.
   */
  baseUrl?: string;
  /** Signed-in user's email — targets the right account in Gmail deep links. */
  viewerEmail?: string;
  /**
   * Ephemeral analysis of the OPEN message, computed in-request and never
   * stored. Only ever set for threads InboxPulse does not track.
   */
  live?: LiveAnalysis | null;
}

/**
 * Copy for every state where we have no analysis to show.
 *
 * These are not edge cases. For anyone whose mailbox is not the one that
 * ingested a thread — which includes every leadership inbox, since internal mail
 * is excluded from ingestion by design — `untracked` is the state they will see
 * on nearly every message they open. A single flat sentence there reads as a
 * broken panel.
 *
 * So each state says what is true, why, and what would change it. The panel
 * stays honest without going blank.
 */
const NON_RESOLVED_COPY: Record<Exclude<ThreadStatus, 'resolved'>, string> = {
  preview: 'Preview mode — InboxPulse API not configured, so no live flags are shown.',
  unverified: 'Could not verify this request came from Google, so no data is shown.',
  unidentified:
    "Your Google account isn't linked to an InboxPulse workspace yet, so account context can't be loaded. Linking happens when a mailbox is connected to InboxPulse.",
  untracked:
    "Not a tracked client thread — so there's nothing analysed to show. InboxPulse only analyses mail with an external customer participant; internal and automated mail is skipped on purpose.",
  unreadable:
    "InboxPulse couldn't read this message. Gmail declined the request because the add-on hasn't been granted access to your mail yet.",
};

/** Extra guidance per state, shown under the headline. */
const NON_RESOLVED_HINT: Partial<Record<Exclude<ThreadStatus, 'resolved'>, string>> = {
  untracked: 'Open a thread with a customer to see sentiment, flags and account context.',
  unidentified: 'Workspace-wide figures are still available from the add-on homepage.',
  unreadable: 'Remove and re-add the add-on, then accept the access prompt.',
};

function toDay(iso?: string): string | undefined {
  if (!iso) return undefined;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toISOString().slice(0, 10);
}

/**
 * The "Open message" section: what the message IS — its title, who sent it and
 * who it went to — rather than an internal Gmail id nobody reads.
 *
 * Values come from the message's own Gmail headers when we could read them, and
 * fall back to the InboxPulse-side subject/sender otherwise. Recipient fields are
 * omitted when absent (a received message has no Bcc header — the sender's MTA
 * strips it, so it only appears on the sender's own copy in Sent).
 */
function buildOpenMessageSection(input: ThreadCardInput): CardSection {
  const h = input.headers;
  const widgets: Widget[] = [];
  const add = (topLabel: string, value: string | undefined): void => {
    if (value) widgets.push(deco({ topLabel, text: value, wrapText: true }));
  };

  add('Title', h?.subject ?? input.subject);
  add('From', h?.from ?? input.fromEmail);
  add('To', h?.to);
  add('Cc', h?.cc);
  add('Bcc', h?.bcc);
  const day = toDay(input.receivedAt);
  if (day) widgets.push(deco({ topLabel: 'Received', text: day }));

  if (!widgets.length) widgets.push(text('No details available for the open message.'));

  return { header: heading('Open message'), widgets };
}

/**
 * The contextual sidebar card for the open message.
 *
 * The card carries NO header of its own: Gmail's add-on toolbar already shows
 * "InboxPulse" directly above the card, so a header title just prints the product
 * name twice.
 *
 * NOTE: provenance (keyword-rule vs AI %) and interactive Close/Reopen + Assign
 * are follow-ups — they need new internal API endpoints (analyses + task
 * mutations aren't exposed on /api/internal yet).
 */
/**
 * "Is this person angry?" — answered above the fold, in one line, before any
 * detail. Derived from the thread's own trend and flags rather than a new
 * field, so it needs no API change.
 *
 * Severity is carried by the words, never by colour alone: CardService cannot
 * set a background on text, and a colour-only signal fails anyone who cannot
 * distinguish it.
 */
function deriveState(
  trend: TrendPoint[],
  flagged: FlaggedMessage[],
): { headline: string; detail: string } {
  const negatives = trend.filter((p) => p.sentiment === 'negative').length;
  const latest = trend.length ? trend[trend.length - 1] : undefined;

  if (negatives > 0 || flagged.length > 0) {
    const falling =
      trend.length > 1 && SENTIMENT_RANK[trend[trend.length - 1].sentiment] < SENTIMENT_RANK[trend[0].sentiment];
    const detail = negatives
      ? `${negatives} of the last ${trend.length} messages ${negatives === 1 ? 'was' : 'were'} negative.`
      : `${flagged.length} message${flagged.length === 1 ? '' : 's'} flagged on this thread.`;
    return {
      headline: falling ? '<b>Needs attention — getting worse</b>' : '<b>Needs attention</b>',
      detail,
    };
  }

  if (!trend.length) return { headline: '<b>No signal yet</b>', detail: 'This thread has not been analysed.' };
  return {
    headline: '<b>Looks fine</b>',
    detail: latest?.sentiment === 'positive' ? 'Most recent message was positive.' : 'Nothing negative recently.',
  };
}

/** Plain-language headline per live sentiment. Words, never colour alone. */
const LIVE_LABEL: Record<LiveAnalysis['sentiment'], string> = {
  negative: 'Needs attention',
  neutral: 'Nothing concerning',
  positive: 'Positive',
};

const SENTIMENT_RANK: Record<TrendPoint['sentiment'], number> = {
  positive: 1,
  neutral: 0,
  negative: -1,
};

export function buildThreadCard(input: ThreadCardInput): Card {
  const { status } = input;

  // The panel opens with the ANSWER, not with the envelope.
  //
  // "Open message" used to be the first section, printing Title / From / To /
  // Cc — every one of which Gmail is already showing, larger, a few inches to
  // the left. It pushed the only non-redundant thing on the card below the
  // fold. It now appears last, and only when it adds something Gmail does not
  // already have on screen.
  const sections: CardSection[] = [];

  // Sentiment trend (§5) + flagged messages (§6) are THREAD-level, so they show
  // whenever the thread is known — even when the open message itself isn't a
  // tracked customer email (e.g. an internal reply in a tracked client thread).
  const trendSection = buildTrendSection(input.trend ?? []);
  const flaggedSection = buildFlaggedSection(input.flagged ?? [], {
    viewerEmail: input.viewerEmail,
    baseUrl: input.baseUrl,
    threadId: input.threadId,
  });

  if (status !== 'resolved') {
    // A live, in-request reading of the open message. Shown INSTEAD of the
    // "nothing here" copy, because it answers the same question with real
    // content. Labelled as not-stored so nobody mistakes it for the analysed
    // record a tracked thread would have.
    if (input.live) {
      // 1. State — the answer, first, with the evidence under it.
      sections.push({
        widgets: [
          deco({
            text: `<b>${LIVE_LABEL[input.live.sentiment]}</b>`,
            bottomLabel: input.live.reason,
            wrapText: true,
          }),
        ],
      });

      if (trendSection) sections.push(trendSection);
      if (flaggedSection) sections.push(flaggedSection);

      // Provenance sits at the bottom: it matters for trust, but nobody opens
      // the panel to read it. Quiet, and unambiguous that nothing was written.
      sections.push({
        widgets: [
          deco({
            topLabel: 'How this was read',
            text: 'Analysed live from the open message. Not stored.',
            wrapText: true,
          }),
        ],
      });
      return { sections: separated(sections) };
    }

    const hint = NON_RESOLVED_HINT[status];
    sections.push({
      widgets: [deco({ text: NON_RESOLVED_COPY[status], bottomLabel: hint, wrapText: true })],
    });
    // Only worth showing the envelope when we have nothing else to say.
    sections.push(buildOpenMessageSection(input));
    // Trend and flags are THREAD-level, so show them if we have them even when
    // the open message itself isn't tracked — an internal reply inside a tracked
    // client thread still has thread context worth seeing.
    if (trendSection) sections.push(trendSection);
    if (flaggedSection) sections.push(flaggedSection);
    return { sections: separated(sections) };
  }

  // Section order follows the questions a CSM actually asks, in order:
  //   state → what's wrong → background → who to loop in.
  // The previous order (Account, trend, flagged, flags) was organised by data
  // type, which buries the one thing that decides whether to act at all.
  const state = deriveState(input.trend ?? [], input.flagged ?? []);
  sections.push({ widgets: [deco({ text: state.headline, bottomLabel: state.detail, wrapText: true })] });

  if (flaggedSection) sections.push(flaggedSection);

  const flags = input.flags ?? [];
  const backgroundWidgets: Widget[] = [
    deco({ topLabel: 'Customer', text: input.accountName || 'Unknown customer' }),
  ];
  if (flags.length) {
    backgroundWidgets.push(
      deco({
        topLabel: `${flags.length} signal${flags.length > 1 ? 's' : ''} on this message`,
        text: flags.join(', '),
        wrapText: true,
      }),
    );
  }
  sections.push({ header: heading('Background'), widgets: backgroundWidgets });

  if (trendSection) sections.push(trendSection);

  if (input.task) {
    const t = input.task;
    const widgets: Widget[] = [
      deco({
        topLabel: 'Escalation',
        text: t.done ? '✓ Resolved' : 'Open',
        bottomLabel: t.assignee ? `Assigned to ${t.assignee}` : 'Unassigned',
      }),
    ];
    if (t.problem) widgets.push(deco({ topLabel: 'Problem', text: t.problem, wrapText: true }));
    if (t.resolution) widgets.push(deco({ topLabel: 'Resolution', text: t.resolution, wrapText: true }));
    sections.push({ header: heading('Escalation'), widgets });
  }

  // Envelope last, as reference. Gmail already shows subject and sender in the
  // thread pane; the only genuinely additive fields here are the full To/Cc/Bcc
  // lists, which Gmail keeps collapsed.
  sections.push(buildOpenMessageSection(input));

  return { sections: separated(sections) };
}
