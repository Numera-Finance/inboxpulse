import { type Card, type CardSection, text, deco, buttons, linkButton, heading, separated } from './widgets';
import type { EmailStats } from '../services/api-client';

/**
 * The add-on homepage (shown when InboxPulse is opened without a message context).
 *
 * Neither the card header nor the first section names the product: Gmail's add-on
 * toolbar already says "InboxPulse" directly above, and repeating it two more
 * times just pushes the actual content down the panel.
 */
export function buildHomepageCard(stats: EmailStats | null): Card {
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
