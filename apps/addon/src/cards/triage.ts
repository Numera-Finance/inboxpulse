import { type Card, type CardSection, deco, buttons, actionButton, heading, separated } from './widgets';
import type { TriageItem } from '../services/triage';
import { gmailThreadUrl } from '../services/instant-labels';

function escapeText(v: string): string {
  return v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** "Sean Barrett <sean@x.com>" -> "Sean Barrett" */
function who(from: string): string {
  const m = from.match(/^(.*?)</);
  return (m ? m[1] : from).trim().replace(/^"|"$/g, '') || from;
}

function age(hours: number): string {
  if (hours < 1) return 'just now';
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

/**
 * The inbox in the order it should be worked.
 *
 * Numbered, because the entire value is that there IS an order — an unnumbered
 * list is just the inbox again with different sorting. The number is the claim.
 *
 * Threads that need nothing are separated rather than ranked last. A queue that
 * trails off into twelve notifications is a queue people stop reading before
 * they reach the end, which costs exactly the items the ordering was for.
 */
export function buildTriageCard(input: {
  work: TriageItem[];
  quiet: TriageItem[];
  viewerEmail?: string;
  baseUrl?: string;
  /** Set after labelling, so the card can say what it did. */
  labelled?: number;
}): Card {
  const sections: CardSection[] = [];

  // Carry the order into the inbox itself.
  //
  // An ordering that exists only in this panel makes the user hold it in their
  // head while they work a list that is still in date order. Labelling the top
  // few puts the decision where the scanning happens.
  //
  // Only the top FIVE, and only the work items. A label on everything is the
  // same as a label on nothing, and this is a model's opinion being written
  // into a mailbox — the smallest write that carries the point is the right
  // one. It clears itself in 30 minutes like every other instant label.
  const top = input.work.slice(0, 5);
  if (input.baseUrl && top.length) {
    sections.push({
      widgets: [
        buttons(
          actionButton(
            input.labelled ? `Labelled ${input.labelled}` : `Label the top ${top.length}`,
            `${input.baseUrl}/gmail/triage/label`,
            { threadIds: top.map((t) => t.threadId).join(','), subjects: top.map((t) => t.subject.slice(0, 40)).join('|') },
          ),
          // Colour the whole list by what each thread needs, using the
          // classification the triage already did — so this costs no model
          // calls. fyi is excluded server-side; see modeLabelFor.
          actionButton('Label by type', `${input.baseUrl}/gmail/triage/label-types`, {
            byMode: input.work.map((t) => `${t.threadId}:${t.mode}`).join(','),
          }),
        ),
        deco({
          text: '<font color="#5f6368"><b>Label the top</b> flags the first few as Focus. <b>Label by type</b> colours each row by what it needs: Unhappy, Needs a time, Waiting on you, Opening. Threads needing nothing get no label. <b>Refresh Gmail to see them.</b> An add-on cannot repaint the message list. Both clear in 30 minutes.</font>',
          wrapText: true,
        }),
      ],
    });
  }

  if (input.work.length) {
    sections.push({
      header: heading(`Do these first: ${input.work.length}`),
      widgets: input.work.map((i, n) =>
        deco({
          topLabel: `${n + 1}.  ${i.why} · ${age(i.ageHours)}`,
          // Subject truncated, not wrapped. A calendar invite's subject runs to
          // three lines of attendee names and timezone, and nine of those turn
          // a ranked list into a wall the user has to scroll to see the ranking
          // — which defeats the only thing this card is for.
          text: `<b>${escapeText(who(i.from))}</b> ${escapeText(
            i.subject.length > 60 ? `${i.subject.slice(0, 57)}…` : i.subject,
          )}`,
          wrapText: false,
          button: {
            text: 'Open',
            onClick: { openLink: { url: gmailThreadUrl(i.threadId, input.viewerEmail) } },
          },
        }),
      ),
    });
  }

  if (input.quiet.length) {
    sections.push({
      header: heading('Nothing needed'),
      widgets: [
        deco({
          text: `<font color="#5f6368">${input.quiet.length} thread${
            input.quiet.length === 1 ? '' : 's'
          } need nothing from you: ${escapeText(
            input.quiet.slice(0, 4).map((q) => who(q.from)).join(', '),
          )}${input.quiet.length > 4 ? '…' : ''}</font>`,
          wrapText: true,
        }),
      ],
    });
  }

  if (!sections.length) {
    sections.push({
      widgets: [deco({ text: 'Nothing in the inbox to prioritise.', wrapText: true })],
    });
  }

  sections.push({
    widgets: [
      deco({
        topLabel: 'How this was ordered',
        text:
          '<font color="#5f6368">By what each thread costs you to leave: complaints get worse, ' +
          'scheduling expires, live work waits. Oldest first within each. Read live, not stored.</font>',
        wrapText: true,
      }),
    ],
  });

  return { sections: separated(sections) };
}
