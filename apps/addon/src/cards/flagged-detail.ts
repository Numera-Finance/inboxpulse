import {
  type Card,
  type CardSection,
  type Widget,
  text,
  deco,
  buttons,
  linkButton,
  heading,
  separated,
} from './widgets';
import { gmailMessageUrl, type FlaggedMessage } from './flagged';

/**
 * The expanded view of one flagged message, pushed onto the add-on's own card
 * stack when a row in "Flagged messages" is clicked.
 *
 * This is the in-panel alternative to navigating: a Workspace Add-on cannot move
 * Gmail's thread pane (its actions only navigate its own panel), but every
 * flagged message is by definition in the thread already open, so we can simply
 * show it here. Google renders a back arrow for pushed cards, so no custom
 * "back" affordance is needed.
 */

export interface FlaggedDetailInput {
  message: FlaggedMessage;
  /** Body text read from Gmail; omitted when it couldn't be fetched. */
  body?: string;
  /** Signed-in user's email, for the "Open in Gmail" escape hatch. */
  viewerEmail?: string;
}

const BODY_LIMIT = 1200;

function when(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toISOString().slice(0, 10);
}

export function buildFlaggedDetailCard(input: FlaggedDetailInput): Card {
  const { message: m, body, viewerEmail } = input;
  const sections: CardSection[] = [];

  // Why it was flagged comes first — it's the reason the reader clicked.
  const flagWidgets: Widget[] = m.flags.length
    ? m.flags.map((f) =>
        deco({
          topLabel: f.label,
          text: f.detail ?? 'No reason recorded.',
          bottomLabel: f.provenance,
          wrapText: true,
        }),
      )
    : [text('No signals recorded on this message.')];
  sections.push({ header: heading('Why this was flagged'), widgets: flagWidgets });

  sections.push({
    header: heading('Message'),
    widgets: [
      deco({ topLabel: 'Title', text: m.subject || '(no subject)', wrapText: true }),
      deco({ topLabel: 'From', text: m.fromName ? `${m.fromName} <${m.fromEmail}>` : m.fromEmail, wrapText: true }),
      deco({ topLabel: 'Received', text: when(m.receivedAt) }),
    ],
  });

  const trimmed = body?.trim();
  sections.push({
    header: heading('Content'),
    widgets: [
      text(
        trimmed
          ? trimmed.length > BODY_LIMIT
            ? `${trimmed.slice(0, BODY_LIMIT).trimEnd()}…`
            : trimmed
          : "Couldn't load this message's content. Open it in Gmail to read the full email.",
      ),
    ],
  });

  // Kept as an escape hatch: opening Gmail is now a choice, not the only path.
  sections.push({
    widgets: [buttons(linkButton('Open in Gmail', gmailMessageUrl(m.messageId, viewerEmail)))],
  });

  // No card header — Gmail's add-on toolbar already names InboxPulse above it.
  return { sections: separated(sections) };
}
