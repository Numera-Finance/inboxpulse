import { type Card, type CardSection, text, deco, buttons, linkButton, actionButton, heading, separated, fold, image } from './widgets';
import { privacyBlock } from './privacy';
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
/**
 * The card's palette, and the reasoning behind each entry.
 *
 * Cards v2 gives no background, no border, no box. Two devices carry color: the
 * `<font color>` tag inside text, and an IMAGE, which renders whatever we serve
 * — so a colored band is a picture of one (see assets/bar.ts).
 *
 * Three colors, each earning its place:
 *
 *   FIRE   #d93025  A client waiting. The only red on the card, so red always
 *                   means the same thing: somebody outside the firm is unhappy
 *                   and nobody has answered. Used on the band above the client
 *                   group and on the unanswered counts.
 *   MINE   #1a73e8  The reader's own mailbox. Blue is inert here — it marks
 *                   territory rather than urgency, which is exactly right for a
 *                   half of the card containing no client at all.
 *   QUIET  #5f6368  Caveats, sample sizes, the sentence explaining what a
 *                   number excludes. Deliberately recessive: these must be
 *                   readable when looked for and invisible when scanning.
 *
 * Gmail's own hairline is left to do nothing. It cannot be styled, so the bands
 * carry the structure and the rule is simply what remains between two sections.
 */
const FIRE = 'd93025';
const MINE = '1a73e8';

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
  /** Angry clients who waited more than five days for a first reply. */
  overFiveDays: number;
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
 * Two durations side by side, in ONE unit.
 *
 * `hrs` picks a unit per value, which is right in isolation and wrong for a
 * comparison: the row rendered "5d median · firm 12.8h" and asked the reader to
 * convert mid-line to see whether 5d was bad. It is the same defect the headline
 * multiple was introduced to remove, left sitting directly underneath it.
 *
 * The larger value chooses the unit for both, so the pair is always legible at a
 * glance — "5.0d median · firm 0.5d".
 */
function pair(a: number | null, b: number | null): { a: string; b: string } {
  if (a === null || b === null) return { a: hrs(a), b: hrs(b) };
  const days = Math.max(a, b) >= 48;
  const fmt = (v: number): string => (days ? `${(v / 24).toFixed(1)}d` : `${v.toFixed(1)}h`);
  return { a: fmt(a), b: fmt(b) };
}

export interface FiresView {
  /**
   * The window the fires were counted over, so the deep link can match it.
   *
   * Not a detail. The escalations page defaults to `subDays(new Date(), 30)`,
   * and this section counts 90 days — so a link that omitted the range landed
   * on a filter that excluded most of what the row had just claimed. Falconx
   * showed "5 unanswered, oldest 50d" and the page said "No analyzed emails
   * found", which reads as the panel making things up.
   */
  windowDays: number;
  /**
   * The viewer can see no customers at all — not an admin, and nothing in
   * user_accessible_customers.
   *
   * Without this the section simply does not render, and an absent section is
   * indistinguishable from "nothing is on fire". That is the most reassuring
   * possible reading of a permissions problem, and it is exactly what happened:
   * the panel showed no fires and no waiting clients for a viewer with role
   * `User` and zero accessible customers, while the tenant-wide sections beside
   * them displayed real data. It looked like the feature was missing.
   */
  restricted?: boolean;
  fires: Array<{
    customerId: string | null;
    customer: string;
    negative: number;
    unanswered: number;
    oldestDays: number;
    owner: string | null;
    /** Their role — an Accountant is a different call than an Account manager. */
    ownerRole?: string | null;
    /** People sharing that role here; 2+ means this row names one of several. */
    ownerPeers?: number;
    /** Complaint rate per month, oldest first, whole percents. */
    arc?: number[];
    /**
     * Whether we are in a live back-and-forth with this client right now.
     *
     * The strongest predictor of escalation measured anywhere in this panel:
     * within the fires list, engaged clients complain again next week 24.7% of
     * the time against 13.0% for the rest. It also decides the sort order, so
     * showing it is what lets a reader see WHY a row is at the top.
     */
    engaged?: boolean;
  }>;
  webUrl: string;
}

export interface SlowRespondersView {
  people: Array<{ name: string; userId?: string | null; threads: number; medianH: number }>;
  /** Where the escalations view lives, for the per-person link. */
  webUrl?: string;
  /** Window the medians cover, so the link cannot drift from the number. */
  windowDays?: number;
  /** The firm's own median, so a person's number means something. */
  firmMedianH: number | null;
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

export interface PrivacyView {
  /** Whether this viewer has turned reading on. */
  readingOn: boolean;
  /** Whether this install holds gmail.modify — see privacy.ts. */
  canWrite?: boolean;
}

/**
 * One word for where a client sits, from their monthly complaint rates.
 *
 * THREE STATES, NOT TWO. Rising and Cooling alone mislabel the clients who need
 * the most care: one sitting steady at 15% for six months rendered as "Cooling
 * 16%→15%", which reads as improving. Measured, that client is nothing of the
 * sort — crossing 10% holds a client at ~4x base for at least three months and
 * they do not drift back out.
 *
 * Entrenched and Rising are different jobs. Rising is someone newly slipping and
 * early contact is the whole point. Entrenched is a relationship already in the
 * state, where early is months ago and the answer is senior involvement rather
 * than a faster reply. The two lists barely overlap: of the clients escalating
 * now and the clients carrying five or more complaints at under a week apart,
 * exactly one appears on both.
 */
export function arcWord(arc: number[]): string {
  if (arc.every((p) => p >= 10)) return 'Entrenched';
  return arc[arc.length - 1] > arc[0] ? 'Rising' : 'Cooling';
}

export function buildHomepageCard(
  stats: EmailStats | null,
  working?: WorkingSetView,
  baseUrl?: string,
  waiting?: WaitingView,
  pulse?: PulseView,
  fires?: FiresView,
  slow?: SlowRespondersView,
  privacy?: PrivacyView,
  /** Clients talking twice as much as usual, who have not complained. */
  stirring?: Array<{ customer: string; customerId: string | null; recent: number; usual: number; owner: string | null }>,
): Card {
  // No lead-in section.
  //
  // It held a one-line product description, which the add-on toolbar already
  // says two inches above, and once that went the section was an empty widget
  // list rendering as a stray gap at the top of the panel. The card should open
  // on the most urgent client, not on furniture.
  // TWO GROUPS, ONE RULE.
  //
  // Gmail draws a hairline between every card section and Cards v2 gives no
  // control over it, so six sections meant six identical rules: the break
  // between two client metrics looked exactly like the break between the firm's
  // data and the reader's own mailbox. Every boundary shouting equally means
  // none of them says anything.
  //
  // So the card is built as two groups and folded at the end. Everything about
  // the FIRM'S CLIENTS collapses into one section; everything about THIS
  // PERSON'S MAIL into another. One rule, at the only boundary that carries
  // meaning. Inside each group the sub-headings stay bold and a blank line does
  // the separating, which is the one typographic lever this surface has.
  const firm: CardSection[] = [];
  const personal: CardSection[] = [];
  const footer: CardSection[] = [];
  // "Angry and unanswered" USED TO BE HERE, and it has been removed.
  //
  // It listed the same population as "Where the fires are" -- angry clients
  // nobody has answered -- one row per THREAD instead of one per client. Two
  // renderings of one fact read as two facts, and in a 300px panel they cost
  // fifteen rows to say one thing. The per-client version wins because it
  // carries what a manager acts on: how many are waiting, how old the oldest
  // is, and who owns the account.
  //
  // WaitingClientsService still backs the deep links and the "See them" button,
  // so nothing was deleted server-side; only the duplicate rendering is gone.

  // WHO TO INVESTIGATE WITH.
  //
  // DangerPulse gives the firm's median (12.9h) and its tail (p90 139h), which
  // says something is wrong somewhere and not where. This resolves it to a
  // person, which is the only form in which the number starts a conversation.
  //
  // The spread is the finding. Against a firm median of 12.9h the slowest
  // account manager sits at 79.3h over ten threads and the next at 50.1h over
  // twenty-two — six times and four times the firm. That is not a rounding
  // difference in an average.
  //
  // The sample size is always shown beside the figure. A median over five
  // threads is thin, the person it names cannot argue with a number they cannot
  // see the basis of, and a panel pointing at a conversation owes the reader
  // enough to discount it themselves.
  if (slow?.people.length) {
    firm.unshift({
      header: heading('Slowest to answer angry mail'),
      widgets: [
        ...slow.people.map((p) => {
          // A MULTIPLE, not two durations.
          //
          // This read "3d vs 12.9h firm-wide" and asked the reader to convert
          // units mid-sentence to find out whether 3d was bad. "5x the firm"
          // needs no arithmetic and no units at all, and it is the comparison
          // that carries the meaning — the absolute number is context, so it
          // moves to the small line underneath.
          const mult =
            slow.firmMedianH && slow.firmMedianH > 0
              ? Math.round((p.medianH / slow.firmMedianH) * 10) / 10
              : null;
          return deco({
            // THE NAME ALONE ON THE MEDIUM LINE.
            //
            // This carried the name, the multiplier and the words "the firm" on
            // one line, above a grey topLabel and below a PERSON icon, in a
            // 250px column. Real names here are "Meghana Muralidhar Murthy" and
            // "Gourish Jagadish Hegde", so every row wrapped three and four deep
            // and the red "3.7×" landed orphaned on a line of its own. Four rows
            // of that is not a list, it is a wall.
            //
            // Same shape as the fire row, and for the same reason: one short
            // claim on the medium line, everything that qualifies it on the grey
            // line below. The icon goes because four identical PERSON glyphs are
            // decoration costing ~40px of a column that has none to spare, and
            // the topLabel goes because a grey qualifier ABOVE the name puts fog
            // in front of the only word being scanned for.
            text: `<b>${escapeText(p.name)}</b>`,
            // Multiplier first, because it is the reason the row is here, and it
            // is the one number that needs no context to read.
            bottomLabel: (() => {
              const lead = mult
                ? `<font color="#c5221f"><b>${mult}×</b> the firm</font> · `
                : '';
              if (!slow.firmMedianH) return `${lead}${hrs(p.medianH)} median · ${p.threads} answered`;
              const { a, b } = pair(p.medianH, slow.firmMedianH);
              return `${lead}${a} vs ${b} · ${p.threads} answered`;
            })(),
            wrapText: true,
            // "Their queue", NOT "see these N".
            //
            // The median is computed over threads on the clients they own by
            // the allocation sheet; the escalations page can only filter by
            // TASK ASSIGNEE, and the two disagree — Ganesh Shankar has 22
            // negative threads on his clients and 12 with a task assigned to
            // him. A button promising the row's own population would land on a
            // smaller one, which is the contradiction the fires link just had.
            //
            // So the button names the destination instead of the number. A row
            // with nowhere honest to go keeps no button at all.
            ...(p.userId && slow.webUrl
              ? {
                  button: {
                    text: 'Their queue',
                    onClick: {
                      openLink: {
                        url:
                          `${slow.webUrl}/escalations?signal=negative&status=all` +
                          `&assigned=${encodeURIComponent(p.userId)}` +
                          `&from=${sinceDays(slow.windowDays ?? 90)}`,
                      },
                    },
                  },
                }
              : {}),
          });
        }),
        // Stated, not buried. Only ANSWERED threads have a duration, so someone
        // who never replies at all cannot appear here and looks better than
        // someone who replies slowly. That case lives in the fires list above,
        // and the two sections are only correct read together.
        // Short enough to read, because a caveat nobody finishes is a caveat
        // nobody has. The full reasoning lives in SlowRespondersService.
        text('<font color="#5f6368">Answered mail only. Ignored mail has no reply time.</font>'),
      ],
    });
  }

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
          ? `<font color="#c5221f">only ${hrs(Math.abs(faster))} faster than routine mail. Sentiment is not changing behaviour</font>`
          : `<font color="#188038">${hrs(faster)} faster than routine mail</font>`;

    // THE TAIL LEADS, the median follows.
    //
    // This opened with the median, and the median is the part that is already
    // fine: 12.9h against 15.1h for routine mail, so half of unhappy clients
    // hear back the same working day. A lead reading it concluded things were
    // acceptable, which was true and useless — optimising an acceptable average
    // changes nothing anyone would notice.
    //
    // The damage is entirely in the tail. 56 of 505 answered negative threads
    // waited over five days, and those are the clients who leave. So the count
    // of PEOPLE who waited too long is the headline, and the median moves below
    // it as context.
    //
    // A count of people, not a percentile. Nobody can picture "p90", and a
    // percentile shifts when the population changes, so it cannot be tracked
    // month to month by a human. "56 clients waited more than five days" can be
    // carried into a meeting and checked again next month, which is the only
    // form in which a number gets acted on.
    firm.unshift({
      header: heading('Unhappy clients left waiting'),
      widgets: [
        deco({
          startIcon: { knownIcon: 'CLOCK' },
          topLabel: `of ${pulse.negativeCount} unhappy clients who got a reply`,
          text:
            `<b><font color="#c5221f">${pulse.overFiveDays}</font></b> waited more than <b>5 days</b> to hear back`,
          wrapText: true,
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
        // No second button. Two identical "See them" accessories stacked on
        // consecutive rows read as a rendering fault, not as two links — and
        // they went to the same place. The headline keeps the action; this row
        // is context for it.
        deco({
          topLabel: `median over ${pulse.negativeCount} replies`,
          text: `<b>${hrs(pulse.negativeMedianH)}</b> to first reply${verdict ? `, ${verdict}` : ''}`,
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
        // The p90 row is gone. It said the same thing as the headline in a
        // form nobody can act on, and two ways of stating one fact reads as
        // two facts.

        // THE TREND AS TWO NUMBERS, NOT EIGHT BLOCK GLYPHS.
        //
        // This was a sparkline built from ▁▂▃▄▅▆▇█ and coloured blue. Gmail's
        // font has no glyph for most of that range, so it renders them as solid
        // filled boxes at a uniform height — and a row of black rectangles above
        // the words "lower is faster" reads as a redaction bar, not a trend.
        // The colour did not survive either.
        //
        // Four monthly points do not need a chart. First against last, with the
        // direction named, is the whole of what "is this getting better" asks,
        // and it renders in any font.
        ...(pulse.trend.length >= 2
          ? [
              (() => {
                const first = pulse.trend[0];
                const last = pulse.trend[pulse.trend.length - 1];
                const better = last.medianH < first.medianH;
                const { a, b } = pair(first.medianH, last.medianH);
                return deco({
                  topLabel: `first reply, by month · ${first.month} → ${last.month}`,
                  text:
                    `${a} → <b>${b}</b> ` +
                    `<font color="${better ? '#188038' : '#c5221f'}">` +
                    `${better ? 'faster' : 'slower'}</font>`,
                  wrapText: true,
                });
              })(),
            ]
          : []),
        // The apology that used to sit here — "Per-person breakdown needs reply
        // attribution: 12% of replies currently identify who sent them" — is
        // gone, because the per-person breakdown now exists. It was true about
        // the route it assumed: first_reply_by_id is 7-12% populated, since
        // replies are matched for a timestamp and then discarded, so nothing
        // could be attributed by AUTHORSHIP.
        //
        // "Slowest to answer angry mail" answers the same question through the
        // allocation sheet instead, which names one accountable person per
        // client at ~100% coverage. Telling a reader a section is unavailable
        // while rendering it two rows above is worse than saying nothing.
      ],
    });
  }

  // WHERE THE FIRES ARE — by client, not by thread.
  //
  // "Angry and unanswered" lists individual threads, which is right for someone
  // about to reply and wrong for someone deciding where to spend an afternoon.
  // A manager does not want twelve rows that turn out to be four clients; they
  // want to know Deserve has eighteen unhappy threads and eight nobody touched.
  //
  // ONE ANGRY EMAIL IS NOISE. Over 90 days, 135 clients have exactly one
  // negative thread and 51 have three or more. Ranking the tail alongside a
  // client with nine open complaints is what makes a review unreadable.
  //
  // This REPLACED "Account managers carrying it", which counted threads per
  // person and had stopped saying anything — its top real manager carried two.
  // Every fact that section carried survives here in a more useful shape: the
  // owner is named on each row, and an unallocated client shows as "no account
  // manager" against its actual damage rather than pooled into one bucket.
  // Say so, rather than rendering nothing.
  //
  // An empty section and a forbidden section look identical once they are both
  // absent, and only one of them is good news. This is the same failure that
  // hid a crashing /waiting endpoint for weeks — silence reading as "all
  // clear".
  if (fires && !fires.fires.length && fires.restricted) {
    firm.unshift({
      header: heading('Where the fires are'),
      widgets: [
        deco({
          startIcon: { knownIcon: 'PERSON' },
          text: '<b>No client access on your account</b>',
          bottomLabel: 'Ask an admin to assign you customers',
          wrapText: true,
        }),
        text(
          '<font color="#5f6368">This section shows only clients you are assigned. ' +
            'The figures below are firm-wide and are not restricted.</font>',
        ),
      ],
    });
  }

  // BEFORE anyone complains. Placed after the fires so it does not outrank a
  // client who is already unhappy, and kept separate because these two lists
  // need opposite responses: a fire wants a call today, a stirring client wants
  // someone to notice a conversation getting heavier than usual.
  //
  // Measured over 265 clients who eventually complained: median daily mail 0.21
  // in the prior month, 0.43 in the final week, rising in 68% of them. It costs
  // nothing to compute and it is the only signal here that precedes the label.
  //
  // The row states volume and does not assert a mood. Causation is unsettled — a
  // busy month makes both more mail and more chances for friction — so "Hinlab,
  // 20 this week against 5 usual" is a fact a reader can act on, where "Hinlab
  // is getting frustrated" would be a guess.
  if (stirring?.length) {
    firm.push({
      header: heading('Talking more than usual'),
      widgets: stirring.map((sc) =>
        deco({
          text: `<b>${escapeText(sc.customer)}</b> <font color="#9a6f33">${sc.recent} this week</font>`,
          bottomLabel:
            `usually ${sc.usual} a week` +
            (sc.owner ? ` · ${escapeText(sc.owner)}` : ' · not on the allocation sheet'),
          wrapText: true,
        }),
      ),
    });
  }

  if (fires?.fires.length) {
    firm.unshift({
      header: heading('Where the fires are'),
      widgets: fires.fires.map((f) =>
        deco({
          // TWO SLOTS, AND THE MEDIUM LINE LEADS.
          //
          // This row carried topLabel + text + bottomLabel + a PHONE icon + an
          // "Open" button, six rows deep in a 250px column, and read as a warren
          // of fonts. decoratedText has three fixed type sizes and no CSS, so
          // the only lever is which slots a row spends.
          //
          // topLabel is small grey and comes FIRST, which put a fog of
          // qualifiers ahead of every client name before the eye reached one.
          // Dropping it leaves medium-then-small down the whole section, and the
          // scanning eye rides the bold names like a column.
          //
          // The icon went because six identical PHONE glyphs are decoration
          // costing ~40px of the width. The "Open" button went because
          // decoratedText.onClick makes the whole row the link — same
          // destination, no six identical pills.
          // ONE SHORT CLAIM ON THE MEDIUM LINE. Client names here run to
          // "Ctruh Technologies Private Limited", so anything appended to the
          // name wraps and the count lands orphaned on its own line — "— 4"
          // then "unanswered". Age moves down to the grey line; the number that
          // decides whether to call stays up with the name.
          text:
            `<b>${escapeText(f.customer)}</b>` +
            (f.unanswered > 0
              ? ` <font color="#c5221f"><b>${f.unanswered} unanswered</b></font>`
              : ''),
          // THE TRAJECTORY AS A WORD, then the numbers behind it.
          //
          // "Rising" and "Cooling" do the triage; "9%→25%" lets a reader check
          // the claim. Numbers alone made a client climbing from nothing look
          // like one coming down from a peak — opposite situations that need
          // opposite calls.
          //
          // Measured across 693 client-months: under 10% behaves exactly like
          // zero (2.0% complaints next month either way); crossing 10% runs 7.9%
          // next month and is still 5.9% three months later against 1.6% for
          // those who never crossed. So the word is earned, not decoration.
          //
          // Owner follows. A fire without a name attached is an observation, and
          // a blank always means "absent from the allocation sheet" rather than
          // "assigned to someone else" — measured, every matched client has an
          // Account manager.
          //
          // "In conversation" LEADS when it is there, because it is both the
          // strongest predictor in the panel and the reason the row sorted
          // where it did. A reader who cannot see why the order changed will
          // read the order as arbitrary. Only rendered when true — a marker
          // that appears on every row is a column heading, not a signal.
          bottomLabel:
            (f.engaged ? 'In conversation · ' : '') +
            (f.arc && f.arc.length >= 2
              ? `${arcWord(f.arc)} ${f.arc[0]}%→${f.arc[f.arc.length - 1]}% · `
              : '') +
            `${f.oldestDays}d · ` +
            (f.owner
              ? (f.ownerRole && f.ownerRole !== 'Account manager'
                  ? `${f.owner} · ${f.ownerRole}`
                  : f.owner) +
                (f.ownerPeers && f.ownerPeers > 1 ? ` +${f.ownerPeers - 1}` : '')
              : 'not on the allocation sheet'),
          wrapText: true,
          // The WHOLE ROW is the link, not a pill at the end of it. Six
          // identical "Open" buttons were six identical accessories saying the
          // same thing; decoratedText.onClick reaches the same destination and
          // gives the width back to the client name.
          ...(f.customerId && fires.webUrl
            ? {
                onClick: {
                    openLink: {
                      // Every filter here must match what the ROW claims, or
                      // the destination contradicts the panel.
                      //
                      // `customer`, NOT `customerId` — that is the param name
                      // apps/web/app/escalations/page.tsx reads. A wrong name
                      // does not error; the page just loads unfiltered, so the
                      // link looks like it works and quietly shows everything.
                      //
                      // `from` is required, not optional: the page defaults to
                      // 30 days and this section counts 90, so without it the
                      // link dropped every thread older than a month. Falconx
                      // read "5 unanswered, oldest 50d" and the page answered
                      // "No analyzed emails found".
                      //
                      // `status=all`, not `open`. On that page "open" means an
                      // open TASK; this section means "nobody replied". They
                      // are different populations, and asserting the wrong one
                      // hides rows the row itself counted. Showing all negative
                      // mail for the client is a superset the reader can scan.
                      url:
                        `${fires.webUrl}/escalations?signal=negative&status=all` +
                        `&customer=${encodeURIComponent(f.customerId)}` +
                        `&from=${sinceDays(fires.windowDays)}`,
                    },
                  },
              }
            : {}),
        }),
      ),
    });
  }


  // ---------------------------------------------------------------------
  // YOUR INBOX — everything below is about the reader's own mailbox.
  // ---------------------------------------------------------------------
  //
  // The panel was two products interleaved with no boundary. Above this line
  // the sections are about THE FIRM'S CLIENTS: who is angry, who is waiting,
  // who is slow. Below it they are about THIS PERSON'S MAIL: order my inbox,
  // clear my marks. They answer different questions for different reasons, and
  // rendered at equal weight in one column they read as one undifferentiated
  // list — a manager scanning for a client hit a button that relabels their own
  // mailbox.
  //
  // Cards v2 gives no grouping primitive: no nesting, no background, no rule
  // with a label. A section header is the only device available, so the split
  // is carried by one — "Your inbox" — and by putting every personal tool after
  // it rather than scattered through the data.
  if (baseUrl) {
    personal.push({
      widgets: [
        buttons(actionButton('Prioritise my inbox', `${baseUrl}/gmail/triage`, {})),
        deco({
          text: '<font color="#5f6368">Reads the top of your inbox and orders it by what each thread costs you to leave.</font>',
          wrapText: true,
        }),
      ],
    });
  }

  // A personal tool, so it sits below the divide rather than leading the card.
  //
  // It used to unshift to the very top, which put "what I marked in the last
  // thirty minutes" above every client in the firm who is waiting on an answer.
  if (working?.entries.length) {
    personal.push({
      header: heading('Your marked threads'),
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
    personal.push({
      widgets: [
        buttons(actionButton('Clear all my marks', `${baseUrl}/gmail/clear-marks`, {})),
        deco({
          text: '<font color="#5f6368">Removes every InboxPulse ⚡ label from your mailbox. Use this if a mark outlived its 30 minutes: timed expiry needs the service to stay running, and a deploy or restart loses it.</font>',
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
  // "Not connected" must mean NOTHING came back, not that one call failed.
  //
  // This keyed off `stats` alone — the result of /api/internal/emails/stats,
  // whose display block was removed above. So the only thing that call still
  // decided was whether to tell the reader the panel was disconnected, and when
  // it failed on its own the panel printed "not connected to the InboxPulse
  // API" directly above a live median of 12.9h over 505 real replies. Seen in
  // production, and it undermines every number on the card: a reader who is
  // told the panel is in preview mode has no reason to trust the figures beside
  // the message.
  //
  // Connected is therefore decided by whether ANY live view arrived. Each of
  // these comes from a different endpoint, so the banner now appears only when
  // the whole internal API is unreachable — which is the state it describes.
  const connected =
    Boolean(stats) ||
    pulse !== undefined ||
    Boolean(fires?.fires.length) ||
    Boolean(slow?.people.length) ||
    Boolean(waiting?.clients.length);

  if (!connected) {
    footer.push({
      widgets: [
        text(
          'Preview mode. Not connected to the InboxPulse API. Set SERVICE_API_KEY (and ADDON_DEV_TENANT_ID for local clone data) to show live stats.',
        ),
      ],
    });
  }

  footer.push({
    widgets: [buttons(linkButton('Open web dashboard', 'https://emailsentiment.mystartupcfo.com'))],
  });

  // One section per GROUP, so Gmail draws one rule per real boundary. Empty
  // groups are dropped rather than folded into an empty section, which would
  // render as a rule with nothing under it.
  // The footer folds into the personal group rather than standing alone. A
  // dashboard link behind its own rule reads as a third kind of content; at the
  // foot of the reader's own half it reads as what it is — the way out to the
  // full view. That leaves exactly ONE rule on the card, at the only boundary
  // that carries meaning.
  // A BAND, not a heavier rule.
  //
  // Gmail's hairline is fixed and identical everywhere, so it cannot say which
  // boundary matters. A colored band can: red above the clients, blue above the
  // reader's own tools. It reads instantly at a glance, survives both Gmail
  // themes, and needs no typography — which this surface does not have.
  //
  // The band sits INSIDE the group it introduces, directly above its first
  // heading, so it reads as a label for what follows rather than as a gap
  // between two things.
  const card: CardSection[] = [];
  if (firm.length && baseUrl) {
    firm.unshift({ widgets: [image(`${baseUrl}/bar.png?c=${FIRE}&h=6`, 'Clients')] });
  }
  if (firm.length) card.push(fold(firm));

  // The promise sits in the reader's own half, directly above the tools that
  // act on their mailbox — where someone asking "what does this do with my
  // mail" is already looking. Not buried in a footer, and not at the top where
  // it would push the clients below the fold for the eight people who never
  // think about it.
  if (privacy) {
    personal.push({ widgets: privacyBlock({ on: privacy.readingOn, baseUrl, canWrite: privacy.canWrite }) });
  }

  const below = [...personal, ...footer];
  if (below.length && baseUrl) {
    below.unshift({ widgets: [image(`${baseUrl}/bar.png?c=${MINE}&h=6`, 'Your inbox')] });
  }
  if (below.length) card.push(fold(below, heading('Your inbox')));

  return { sections: separated(card) };
}
