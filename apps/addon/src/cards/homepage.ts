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
        deco({ topLabel: 'Compute', text: 'Gemini 2.5 Flash', bottomLabel: 'Classification provenance' }),
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
