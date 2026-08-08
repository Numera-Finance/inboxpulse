import { type Card, type CardSection, type Widget, text, deco, heading, separated } from './widgets';
import { buildTrendSection, type TrendPoint } from './trend';
import { buildFlaggedSection, type FlaggedMessage } from './flagged';
import type { MessageHeaders } from '../gmail/gmail-api';

export type ThreadStatus = 'preview' | 'unverified' | 'unidentified' | 'untracked' | 'resolved';

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
}

const NON_RESOLVED_COPY: Record<Exclude<ThreadStatus, 'resolved'>, string> = {
  preview: 'Preview mode — InboxPulse API not configured, so no live flags are shown.',
  unverified: 'Could not verify this request came from Google, so no data is shown.',
  unidentified: "Couldn't match your Google account to an InboxPulse workspace.",
  untracked:
    "This message isn't a tracked client thread in InboxPulse (internal mail, or not from a known customer).",
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
export function buildThreadCard(input: ThreadCardInput): Card {
  const { status } = input;
  const sections: CardSection[] = [buildOpenMessageSection(input)];

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
    sections.push({ widgets: [text(NON_RESOLVED_COPY[status])] });
    if (trendSection) sections.push(trendSection);
    if (flaggedSection) sections.push(flaggedSection);
    return { sections: separated(sections) };
  }

  sections.push({
    header: heading('Account'),
    widgets: [deco({ topLabel: 'Customer', text: input.accountName || 'Unknown customer' })],
  });

  if (trendSection) sections.push(trendSection);
  if (flaggedSection) sections.push(flaggedSection);

  const flags = input.flags ?? [];
  sections.push({
    header: heading('Flags on this message'),
    widgets: [
      flags.length
        ? deco({
            topLabel: `${flags.length} signal${flags.length > 1 ? 's' : ''}`,
            text: flags.join(', '),
            wrapText: true,
          })
        : text('No signals flagged on this message.'),
    ],
  });

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

  // (Subject / From / Received used to repeat in a trailing "Message" section —
  // they now live in "Open message" at the top, alongside To / Cc / Bcc.)
  return { sections: separated(sections) };
}
