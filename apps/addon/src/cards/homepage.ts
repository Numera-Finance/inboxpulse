import { type Card, type CardSection, text, deco, buttons, linkButton, heading, separated } from './widgets';
import type { EmailStats } from '../services/api-client';

/**
 * The add-on homepage (shown when InboxPulse is opened without a message context).
 *
 * Neither the card header nor the first section names the product: Gmail's add-on
 * toolbar already says "InboxPulse" directly above, and repeating it two more
 * times just pushes the actual content down the panel.
 */
/**
 * The working set is the reason to open this panel without a message.
 *
 * Nothing was written to Gmail — a real label needs gmail.modify, whose consent
 * screen asks for the whole mailbox — so this list is the ONLY place a marked
 * thread is visible. That makes the thread link load-bearing rather than a
 * convenience: without one click back to the conversation, a working set is a
 * list of things to go and find.
 */
/** Card text is an HTML subset, so subjects taken from mail must be escaped. */
function escapeText(v: string): string {
  return v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export interface WorkingSetView {
  entries: Array<{
    label: { key: string; name: string; means: string };
    threadId: string;
    subject: string;
    minutesLeft: number;
  }>;
  viewerEmail?: string;
  threadUrl: (threadId: string, viewerEmail?: string) => string;
}

export function buildHomepageCard(stats: EmailStats | null, working?: WorkingSetView): Card {
  const sections: CardSection[] = [
    {
      widgets: [
        text('Client-email sentiment, escalations, and account context — right inside Gmail.'),
        // The compute-provenance row used to read "Gemini 2.5 Flash". It was
        // removed because we cannot evidence it: across 139,642 rows in
        // email_analyses, exactly 6 record a model_used, and NONE of the 34,600
        // sentiment rows do. Naming a model there asserted provenance for
        // classifications whose provenance was never written.
        //
        // Restore this only once model + prompt version are stamped at analysis
        // write time, and read it from the data rather than hard-coding it.
      ],
    },
  ];
  // Leads the card when present. Someone opening the panel with no message
  // open is almost always coming back to what they marked.
  if (working?.entries.length) {
    sections.unshift({
      header: heading('Working set'),
      widgets: working.entries.map((e) =>
        deco({
          topLabel: `${e.label.name.split('/')[1]} · ${e.minutesLeft}m left`,
          text: escapeText(e.subject),
          wrapText: true,
          button: {
            text: 'Open',
            onClick: { openLink: { url: working.threadUrl(e.threadId, working.viewerEmail) } },
          },
        }),
      ),
    });
  }


  if (stats) {
    sections.push({
      header: heading('This workspace'),
      widgets: [
        deco({ topLabel: 'Emails ingested', text: stats.total.toLocaleString() }),
        deco({ topLabel: 'Analyzed', text: stats.analyzed.toLocaleString() }),
      ],
    });
  } else {
    sections.push({
      widgets: [
        text(
          'Preview mode — not connected to the InboxPulse API. Set SERVICE_API_KEY (and ADDON_DEV_TENANT_ID for local clone data) to show live stats.',
        ),
      ],
    });
  }

  sections.push({
    widgets: [buttons(linkButton('Open web dashboard', 'https://emailsentiment.mystartupcfo.com'))],
  });

  return { sections: separated(sections) };
}
