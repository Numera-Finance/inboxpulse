import { type Card, type CardSection, text, deco, buttons, linkButton, actionButton, heading, separated } from './widgets';
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

export interface PulseView {
  /** Days the median is computed over — the deep link must match it. */
  windowDays: number;
  negativeMedianH: number | null;
  otherMedianH: number | null;
  negativeP90H: number | null;
  negativeCount: number;
  trend: Array<{ month: string; medianH: number }>;
  attributionPct: number;
}

/** ISO date N days ago — the `from` filter the escalations route reads. */
function sinceDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

/** Hours as something a person reads without converting. */
function hrs(h: number | null): string {
  if (h === null) return '—';
  if (h < 1) return `${Math.round(h * 60)}m`;
  if (h < 48) return `${h.toFixed(1)}h`;
  return `${Math.round(h / 24)}d`;
}

/**
 * A trend drawn in block characters.
 *
 * CardService has no canvas and no SVG, so a chart is not available at any
 * price. Eight block glyphs are — and for "is this getting better", eight
 * glyphs is the entire question. Lower is better here, so the bars are
 * INVERTED: a falling line means faster replies, which is what the reader
 * expects a good trend to look like.
 */
function sparkline(values: number[]): string {
  if (values.length < 2) return '';
  const blocks = '▁▂▃▄▅▆▇█';
  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = max - min || 1;
  return values
    .map((v) => blocks[Math.round(((max - v) / span) * (blocks.length - 1))])
    .join('');
}

export interface OwnerLoadView {
  owners: Array<{ name: string; threads: number; oldestDays: number; unassigned: boolean }>;
  webUrl: string;
}

export interface WaitingView {
  clients: Array<{
    customerId: string | null;
    customer: string;
    subject: string;
    daysWaiting: number;
  }>;
  webUrl: string;
}

export function buildHomepageCard(
  stats: EmailStats | null,
  working?: WorkingSetView,
  baseUrl?: string,
  waiting?: WaitingView,
  pulse?: PulseView,
  ownerLoad?: OwnerLoadView,
): Card {
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
  // The number this product exists to move, and the comparison that gives it
  // meaning.
  //
  // Reported ALONGSIDE the same figure for everything else, because the number
  // alone says nothing. On the current data that comparison IS the finding:
  // negative 12.9h against other 15.1h. Angry mail is answered barely faster
  // than routine mail, so sentiment is not currently changing anyone's
  // behaviour — and a lead reading "12.9h" by itself would conclude things were
  // fine.
  //
  // p90 sits next to it because the median hides the cases that matter. Half of
  // angry clients hear back inside 13 hours; a tenth wait nearly six days, and
  // those are the ones that leave.
  if (pulse?.negativeMedianH !== null && pulse !== undefined) {
    const faster =
      pulse.otherMedianH !== null && pulse.negativeMedianH !== null
        ? pulse.otherMedianH - pulse.negativeMedianH
        : null;
    const verdict =
      faster === null
        ? ''
        : faster < 2
          ? `<font color="#c5221f">only ${hrs(Math.abs(faster))} faster than routine mail — sentiment is not changing behaviour</font>`
          : `<font color="#188038">${hrs(faster)} faster than routine mail</font>`;
    const spark = sparkline(pulse.trend.map((t) => t.medianH));

    sections.unshift({
      header: heading('Reply time to unhappy clients'),
      widgets: [
        deco({
          topLabel: `median over ${pulse.negativeCount} replies`,
          text: `<b>${hrs(pulse.negativeMedianH)}</b> to first reply${verdict ? ` — ${verdict}` : ''}`,
          wrapText: true,
          // Land on exactly the population the median was computed over:
          // negative, still open, same window. A headline number you cannot
          // click into is a number you have to take on trust — and the whole
          // argument for the panel is that its claims are checkable.
          //
          // `signal` and `status` are what apps/web/app/escalations/page.tsx
          // reads, and it already defaults to signal=negative; passing it
          // explicitly means the link keeps working if that default changes.
          ...(waiting?.webUrl
            ? {
                button: {
                  text: 'See them',
                  onClick: {
                    openLink: {
                      url:
                        `${waiting.webUrl}/escalations?signal=negative&status=open` +
                        `&from=${sinceDays(pulse.windowDays)}`,
                    },
                  },
                },
              }
            : {}),
        }),
        deco({
          topLabel: 'the tail',
          text: `1 in 10 waits <b>${hrs(pulse.negativeP90H)}</b> or more`,
          wrapText: true,
        }),
        ...(spark
          ? [
              deco({
                topLabel: `by month · ${pulse.trend[0]?.month ?? ''} → ${pulse.trend[pulse.trend.length - 1]?.month ?? ''}`,
                text: `<font color="#1a73e8">${spark}</font>  <font color="#5f6368">lower is faster</font>`,
                wrapText: false,
              }),
            ]
          : []),
        ...(pulse.attributionPct < 50
          ? [
              deco({
                text: `<font color="#5f6368">Per-person breakdown needs reply attribution: ${pulse.attributionPct}% of replies currently identify who sent them.</font>`,
                wrapText: true,
              }),
            ]
          : []),
      ],
    });
  }

  // Who is carrying it.
  //
  // Attributed by TASK ASSIGNEE — the only source with one owner per thread.
  // Reply attribution covers 7% of this population because replies are never
  // stored, and customer ownership assigns four to five people per account with
  // no role to distinguish them, which turned 188 threads into 379
  // person-thread pairs.
  //
  // Unassigned is shown as a row rather than dropped. It is the largest single
  // group at 43%, and a management review that silently omits its biggest
  // bucket is worse than no review — it reports on the work that already has an
  // owner and stays quiet about the work that has none.
  if (ownerLoad?.owners.length) {
    sections.unshift({
      header: heading('Who is carrying it'),
      widgets: ownerLoad.owners.map((o) =>
        deco({
          topLabel: `${o.threads} thread${o.threads === 1 ? '' : 's'} · oldest ${o.oldestDays}d`,
          text: o.unassigned
            ? `<b><font color="#c5221f">Nobody assigned</font></b>`
            : `<b>${escapeText(o.name)}</b>`,
          wrapText: false,
          ...(o.unassigned
            ? {
                button: {
                  text: 'Open',
                  onClick: {
                    openLink: {
                      url: `${ownerLoad.webUrl}/escalations?signal=negative&status=open&assigned=unassigned`,
                    },
                  },
                },
              }
            : {}),
        }),
      ),
    });
  }

  // The team-lead question, answered directly and put first.
  //
  // "Is there an angry client nobody is answering?" is the thing a lead opens a
  // dashboard to work out, and every existing surface answers it INDIRECTLY —
  // sentiment distributions, escalation counts, turnaround charts — leaving the
  // reader to do the join. Three conditions do it outright: negative sentiment,
  // no first reply, inbound.
  //
  // Longest wait first: the one ignored longest is the one most likely to have
  // been forgotten, which is the whole question.
  if (waiting?.clients.length) {
    sections.unshift({
      header: heading(`Angry and unanswered — ${waiting.clients.length}`),
      widgets: waiting.clients.map((w) =>
        deco({
          topLabel: `${w.daysWaiting}d waiting`,
          text: `<b>${escapeText(w.customer)}</b> — ${escapeText(
            w.subject.length > 52 ? `${w.subject.slice(0, 49)}…` : w.subject,
          )}`,
          wrapText: false,
          ...(w.customerId
            ? {
                button: {
                  text: 'Open',
                  onClick: {
                    openLink: {
                      // Deep link, so the tab next door opens ON this customer
                      // rather than on a landing page they then have to search.
                      url: `${waiting.webUrl}/escalations?customer=${encodeURIComponent(
                        w.customerId,
                      )}&status=open`,
                    },
                  },
                },
              }
            : {}),
        }),
      ),
    });
  }

  // The one button worth pressing from the inbox, so it leads.
  //
  // Gmail add-ons cannot see which rows you selected — there are two triggers,
  // compose and message-open, and neither carries a selection. So instead of
  // acting on threads the user ticks, this reads the top of the inbox and puts
  // it in order. Better shape anyway: the value is that the DEFAULT order is
  // good, not that the reordering tools are.
  if (baseUrl) {
    sections.unshift({
      widgets: [
        buttons(
          actionButton('Prioritise my inbox', `${baseUrl}/gmail/triage`, {}),
        ),
        deco({
          text: '<font color="#5f6368">Reads the top of your inbox and orders it by what each thread costs you to leave.</font>',
          wrapText: true,
        }),
      ],
    });
  }

  // Leads the card when present. Someone opening the panel with no message
  // open is almost always coming back to what they marked.
  if (working?.entries.length) {
    sections.unshift({
      header: heading('Working set'),
      widgets: [
        ...working.entries.map((e) =>
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
      ],
    });
  }

  // The removal path that cannot fail. Shown whenever the panel can act, not
  // only when the panel remembers something — the case it exists for is
  // precisely the one where memory was lost and the list above is empty while
  // the mailbox still carries labels.
  if (baseUrl) {
    sections.push({
      widgets: [
        buttons(actionButton('Clear all my marks', `${baseUrl}/gmail/clear-marks`, {})),
        deco({
          text: '<font color="#5f6368">Removes every InboxPulse ⚡ label from your mailbox. Use this if a mark outlived its 30 minutes — timed expiry needs the service to stay running, and a deploy or restart loses it.</font>',
          wrapText: true,
        }),
      ],
    });
  }


  // "Emails ingested 264,437 / Analyzed 82,782" used to sit here. Removed: it is
  // a fact about our pipeline, not about the reader's day. Nobody opens this
  // panel to learn how much mail we have processed, and it cannot change what
  // anyone does next — the same test the label policy applies. It was also
  // taking the space directly under the numbers that CAN be acted on.
  if (!stats) {
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
