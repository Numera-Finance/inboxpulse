import { type Card, type CardSection, deco, heading, separated } from './widgets';
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
}): Card {
  const sections: CardSection[] = [];

  if (input.work.length) {
    sections.push({
      header: heading(`Do these first — ${input.work.length}`),
      widgets: input.work.map((i, n) =>
        deco({
          topLabel: `${n + 1}.  ${i.why} · ${age(i.ageHours)}`,
          text: `<b>${escapeText(who(i.from))}</b> — ${escapeText(i.subject)}`,
          wrapText: true,
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
