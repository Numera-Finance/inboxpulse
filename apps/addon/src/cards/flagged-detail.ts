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
import { explain } from '@crm/shared';

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

  // What the WORDING means, which is a different question from why it was
  // flagged and the one that outlasts this email.
  //
  // The reader is fluent in English and not in American business register. Of 20
  // complaints a native reader identified, only 5 used explicit failure wording;
  // the rest arrived as understatement, a repeated ask, or a courteous question
  // that is really a challenge. Telling someone "this is a complaint" moves one
  // email. Telling them "'not good to have so many iterations' is understatement
  // — read it as 'this is bad'" moves every future email, including the ones we
  // never flag.
  //
  // `explain()` renders only patterns that name something literally written; on
  // 250 held-out emails those fired 11 times and were right 11 times. Patterns
  // that infer what the writer MEANT scored 6 of 10 and are deliberately silent
  // here — a confident wrong explanation teaches the wrong lesson, which is
  // worse than saying nothing.
  //
  // Absent on most mail, by design. Roughly 6% of emails carry one.
  const lessons = body ? explain(body).slice(0, 3) : [];
  if (lessons.length) {
    sections.push({
      header: heading('What the wording means'),
      widgets: lessons.map((l) =>
        deco({
          topLabel: `"${l.quote}"`,
          text: l.means,
          bottomLabel: `reads as: ${l.readsAs}`,
          wrapText: true,
        }),
      ),
    });
  }

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
