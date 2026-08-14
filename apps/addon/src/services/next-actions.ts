import type { ThreadMode } from './live-analysis';
import type { Participant } from './participants';

/**
 * What to do next, in another app, chosen by what the thread is.
 *
 * The card's actions were mode-blind: a scheduling thread and a complaint
 * offered the same buttons. But the mode is precisely a statement about what
 * the reader is going to do next, and the action is where that becomes useful
 * rather than descriptive — knowing a thread is about arranging a time is worth
 * very little; landing in a calendar draft with the right people already on it
 * is worth the panel.
 *
 * EVERY ACTION HERE IS A URL.
 *
 * That is a hard constraint, not a shortcut. A Google Calendar event created
 * through the API needs `calendar.events`, a RESTRICTED scope that drags the
 * whole add-on through security review and blocks the install every user has to
 * approve. A template URL needs nothing, works on day one, and leaves the user
 * looking at a pre-filled form they can edit or abandon — which is also the
 * honest default for something writing to a personal calendar.
 *
 * The same reasoning rules out anything that would silently create records in
 * someone else's system. These open a prepared screen; the human presses save.
 */

export interface NextAction {
  label: string;
  url: string;
  /** Shown under the button, so the user knows where they will land. */
  hint: string;
}

const pad = (n: number): string => String(n).padStart(2, '0');
const stamp = (d: Date): string =>
  `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}00`;

/**
 * A Google Calendar draft with the thread's people already invited.
 *
 * `add` takes the attendees. This is the single most useful cross-app action on
 * a scheduling thread: the alternative is the user retyping four addresses they
 * are already looking at.
 *
 * Times are a proposal, not a commitment — the next hour boundary, one hour
 * long. Guessing the time from the thread would be worse than not guessing:
 * wrong is expensive here and the user is about to pick anyway.
 */
export function calendarInviteUrl(opts: {
  title: string;
  attendees: string[];
  details?: string;
  now: Date;
}): string {
  const start = new Date(opts.now);
  start.setHours(start.getHours() + 1, 0, 0, 0);
  const end = new Date(start);
  end.setHours(end.getHours() + 1);

  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: opts.title.slice(0, 120),
    dates: `${stamp(start)}/${stamp(end)}`,
  });
  if (opts.attendees.length) params.set('add', opts.attendees.slice(0, 10).join(','));
  if (opts.details) params.set('details', opts.details.slice(0, 500));
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

/** A new Google Doc, titled. Where a proposal or a summary actually gets written. */
export function newDocUrl(title: string): string {
  return `https://docs.google.com/document/create?title=${encodeURIComponent(title.slice(0, 120))}`;
}

/**
 * The actions for this thread, in the order they are worth taking.
 *
 * Deliberately short. Three buttons is a decision; six is a menu, and a menu is
 * what the user came to the panel to avoid.
 */
export function nextActionsFor(input: {
  mode: ThreadMode | undefined;
  subject?: string;
  participants?: Participant[];
  now?: Date;
}): NextAction[] {
  const now = input.now ?? new Date();
  const subject = (input.subject ?? 'this thread').replace(/^(re|fwd|fw):\s*/i, '');
  const externals = (input.participants ?? []).filter((p) => p.external).map((p) => p.address);
  const everyone = (input.participants ?? []).map((p) => p.address);

  switch (input.mode) {
    case 'scheduling':
      // The whole thread is about finding a time. Land them in the invite with
      // the people already on it.
      return [
        {
          label: 'Draft the invite',
          url: calendarInviteUrl({
            title: subject,
            attendees: everyone,
            details: `From the Gmail thread: ${subject}`,
            now,
          }),
          hint: everyone.length
            ? `Calendar, with ${everyone.length} ${everyone.length === 1 ? 'person' : 'people'} already invited`
            : 'Opens a calendar draft',
        },
        {
          label: 'Start a Meet',
          url: 'https://meet.google.com/new',
          hint: 'New meeting link to paste into your reply',
        },
      ];

    case 'opportunity':
      // An opening is worth writing down before it cools. A doc is where the
      // proposal actually gets made.
      return [
        {
          label: 'Start a proposal',
          url: newDocUrl(`Proposal — ${subject}`),
          hint: 'New Google Doc, titled from this thread',
        },
        {
          label: 'Draft the invite',
          url: calendarInviteUrl({
            title: `Intro call — ${subject}`,
            attendees: externals.length ? externals : everyone,
            details: `From the Gmail thread: ${subject}`,
            now,
          }),
          hint: 'Calendar, with the external participants invited',
        },
      ];

    case 'complaint':
      // The reply matters most here and lives elsewhere on the card. The one
      // cross-app action worth offering is getting the right people in a room,
      // which is what "escalate" means in practice.
      return [
        {
          label: 'Get them on a call',
          url: calendarInviteUrl({
            title: `Follow-up — ${subject}`,
            attendees: everyone,
            details: `From the Gmail thread: ${subject}`,
            now,
          }),
          hint: 'Calendar, everyone on the thread invited',
        },
      ];

    // `working` is served by the commitment reminders and the task button that
    // already sit on the card, and `fyi` is owed nothing by definition. Adding
    // buttons here would be adding buttons for the sake of symmetry.
    default:
      return [];
  }
}
