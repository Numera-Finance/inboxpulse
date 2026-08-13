import { type Card, type CardSection, type Widget, text, deco, heading, separated, buttons, linkButton, actionButton } from './widgets';
import { buildTrendSection, type TrendPoint } from './trend';
import { buildFlaggedSection, type FlaggedMessage } from './flagged';
import type { MessageHeaders } from '../gmail/gmail-api';
import { resolveWhen, calendarUrl } from '../services/when';
import type { LiveAnalysis, ThreadDigest, ThreadMode, ReplyOption } from '../services/live-analysis';
import type { Participant } from '../services/participants';
import type { AccountContext } from '../services/api-client';

export type ThreadStatus =
  | 'preview'
  | 'unverified'
  | 'unidentified'
  | 'untracked'
  /**
   * Gmail refused the read of the open message — the token carried no Gmail
   * scope. Distinct from `untracked`, which means we DID read the message and
   * found nothing tracked. Conflating them made the panel confidently explain
   * the wrong problem.
   */
  | 'unreadable'
  | 'resolved';

export interface ThreadTask {
  done: boolean;
  assignee?: string;
  problem?: string;
  resolution?: string;
}

export interface ThreadCardInput {
  messageId?: string;
  status: ThreadStatus;
  accountName?: string;
  flags?: string[];
  subject?: string;
  fromEmail?: string;
  receivedAt?: string;
  task?: ThreadTask | null;
  /** Envelope headers of the open message, read from Gmail. */
  headers?: MessageHeaders;
  /** Per-message sentiment trend for the whole thread (oldest→newest). */
  trend?: TrendPoint[];
  /** Flagged messages across the thread (most-severe first). */
  flagged?: FlaggedMessage[];
  /** InboxPulse thread id, echoed into flagged-row actions. */
  threadId?: string;
  /**
   * Public base URL of the add-on. Receives the flagged-row action callbacks that
   * expand a message in the panel.
   */
  baseUrl?: string;
  /** Signed-in user's email — targets the right account in Gmail deep links. */
  viewerEmail?: string;
  /**
   * Ephemeral analysis of the OPEN message, computed in-request and never
   * stored. Only ever set for threads InboxPulse does not track.
   */
  live?: LiveAnalysis | null;
  /** Renders the "Share to Chat" button when a webhook is configured. */
  chatShareEnabled?: boolean;
  /** Everyone on the thread, most-involved first. */
  participants?: Participant[];
  /** Commitments and unanswered questions extracted from the thread. */
  digest?: ThreadDigest | null;
  /** A generated reply, carried into Gmail's compose window by URL. */
  draft?: string | null;
  /** Ways to answer, recommended first. */
  replyOptions?: ReplyOption[];
  /** Reference date for resolving commitment deadlines; injected so it's testable. */
  now?: Date;
  /**
   * Nothing has been analysed yet — render instantly with what is free and
   * offer analysis as an action. See buildThreadCard.
   */
  analysisPending?: boolean;
  /** Echoed back into the analyse action so the callback can re-fetch. */
  providerThreadId?: string;
  /** How many messages the reading actually covered, for the provenance line. */
  analysedMessages?: number;
  /** History for the sender's company — the part Gemini cannot know. */
  account?: AccountContext | null;
  /**
   * Points drawn from that history which are NOT in the thread. The single most
   * differentiated thing on the card, so it leads.
   */
  historyPoints?: string[];
  /** What kind of thread this is. Drives which sections render at all. */
  mode?: ThreadMode;
}

/**
 * Copy for every state where we have no analysis to show.
 *
 * These are not edge cases. For anyone whose mailbox is not the one that
 * ingested a thread — which includes every leadership inbox, since internal mail
 * is excluded from ingestion by design — `untracked` is the state they will see
 * on nearly every message they open. A single flat sentence there reads as a
 * broken panel.
 *
 * So each state says what is true, why, and what would change it. The panel
 * stays honest without going blank.
 */
const NON_RESOLVED_COPY: Record<Exclude<ThreadStatus, 'resolved'>, string> = {
  preview: 'Preview mode — InboxPulse API not configured, so no live flags are shown.',
  unverified: 'Could not verify this request came from Google, so no data is shown.',
  unidentified:
    "Your Google account isn't linked to an InboxPulse workspace yet, so account context can't be loaded. Linking happens when a mailbox is connected to InboxPulse.",
  untracked:
    "Not a tracked client thread — so there's nothing analysed to show. InboxPulse only analyses mail with an external customer participant; internal and automated mail is skipped on purpose.",
  unreadable:
    "InboxPulse couldn't read this message. Gmail declined the request because the add-on hasn't been granted access to your mail yet.",
};

/** Extra guidance per state, shown under the headline. */
const NON_RESOLVED_HINT: Partial<Record<Exclude<ThreadStatus, 'resolved'>, string>> = {
  untracked: 'Open a thread with a customer to see sentiment, flags and account context.',
  unidentified: 'Workspace-wide figures are still available from the add-on homepage.',
  unreadable: 'Remove and re-add the add-on, then accept the access prompt.',
};

function toDay(iso?: string): string | undefined {
  if (!iso) return undefined;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toISOString().slice(0, 10);
}

/**
 * The "Open message" section: what the message IS — its title, who sent it and
 * who it went to — rather than an internal Gmail id nobody reads.
 *
 * Values come from the message's own Gmail headers when we could read them, and
 * fall back to the InboxPulse-side subject/sender otherwise. Recipient fields are
 * omitted when absent (a received message has no Bcc header — the sender's MTA
 * strips it, so it only appears on the sender's own copy in Sent).
 */
function buildOpenMessageSection(input: ThreadCardInput): CardSection {
  const h = input.headers;
  const widgets: Widget[] = [];
  const add = (topLabel: string, value: string | undefined): void => {
    if (value) widgets.push(deco({ topLabel, text: value, wrapText: true }));
  };

  add('Title', h?.subject ?? input.subject);
  add('From', h?.from ?? input.fromEmail);
  add('To', h?.to);
  add('Cc', h?.cc);
  add('Bcc', h?.bcc);
  const day = toDay(input.receivedAt);
  if (day) widgets.push(deco({ topLabel: 'Received', text: day }));

  if (!widgets.length) widgets.push(text('No details available for the open message.'));

  return { header: heading('Open message'), widgets };
}

/**
 * The contextual sidebar card for the open message.
 *
 * The card carries NO header of its own: Gmail's add-on toolbar already shows
 * "InboxPulse" directly above the card, so a header title just prints the product
 * name twice.
 *
 * NOTE: provenance (keyword-rule vs AI %) and interactive Close/Reopen + Assign
 * are follow-ups — they need new internal API endpoints (analyses + task
 * mutations aren't exposed on /api/internal yet).
 */
/**
 * "Is this person angry?" — answered above the fold, in one line, before any
 * detail. Derived from the thread's own trend and flags rather than a new
 * field, so it needs no API change.
 *
 * Severity is carried by the words, never by colour alone: CardService cannot
 * set a background on text, and a colour-only signal fails anyone who cannot
 * distinguish it.
 */
function deriveState(
  trend: TrendPoint[],
  flagged: FlaggedMessage[],
): { headline: string; detail: string } {
  const negatives = trend.filter((p) => p.sentiment === 'negative').length;
  const latest = trend.length ? trend[trend.length - 1] : undefined;

  if (negatives > 0 || flagged.length > 0) {
    const falling =
      trend.length > 1 && SENTIMENT_RANK[trend[trend.length - 1].sentiment] < SENTIMENT_RANK[trend[0].sentiment];
    const detail = negatives
      ? `${negatives} of the last ${trend.length} messages ${negatives === 1 ? 'was' : 'were'} negative.`
      : `${flagged.length} message${flagged.length === 1 ? '' : 's'} flagged on this thread.`;
    return {
      headline: falling
        ? `<b><font color="${LIVE_COLOR.negative}">Needs attention — getting worse</font></b>`
        : `<b><font color="${LIVE_COLOR.negative}">Needs attention</font></b>`,
      detail,
    };
  }

  if (!trend.length)
    return {
      headline: `<b><font color="${LIVE_COLOR.neutral}">No signal yet</font></b>`,
      detail: 'This thread has not been analysed.',
    };
  return {
    headline: `<b><font color="${LIVE_COLOR.positive}">Looks fine</font></b>`,
    detail: latest?.sentiment === 'positive' ? 'Most recent message was positive.' : 'Nothing negative recently.',
  };
}

/** Card text is an HTML subset, so model-authored strings must be escaped. */
function escapeText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Pull a bare address out of `Name <addr@host>` or a plain address. */
function addressOf(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const angled = raw.match(/<([^>]+)>/);
  const addr = (angled ? angled[1] : raw).trim();
  return addr.includes('@') ? addr.toLowerCase() : undefined;
}

const STOPWORDS = new Set([
  're','fwd','fw','the','and','for','with','this','that','from','your','about','you','are','our','was',
  'has','have','will','can','into','they','their','there','here','when','what','been','were','not',
  // Subject-line filler. These are words that appear in every third subject and
  // narrow a search by nothing: "Another revenue reporting tool" produced
  // (another OR revenue OR reporting OR tool), which matches most of an inbox.
  // A search that returns everything is the same as no search, except the user
  // paid a click to find that out.
  'another','again','update','updates','question','questions','quick','follow','following','followup',
  'meeting','call','chat','sync','touch','base','info','information','note','notes','new','next',
  'please','thanks','thank','hello','team','regarding','request','some','need','needs','help',
]);

/**
 * A Gmail search built from the open message alone — sender domain plus the
 * meaningful words of the subject. No stored data, no analysis: available even
 * on a thread InboxPulse has never seen, which is exactly when the panel would
 * otherwise have nothing to offer.
 */
export function deriveSearch(
  headers: MessageHeaders | undefined,
  viewerEmail?: string,
): { query: string; terms: string[] } | null {
  const from = addressOf(headers?.from);
  const domain = from?.split('@')[1];
  const viewerDomain = viewerEmail?.split('@')[1]?.toLowerCase();

  // Scoping a search to your OWN domain is not a filter -- on an internal thread
  // it matches nearly everything you have ever been sent.
  const useful = domain && domain !== viewerDomain ? domain : undefined;

  const terms = (headers?.subject ?? '')
    .split(/[^A-Za-z0-9-]+/)
    .map((w) => w.toLowerCase())
    .filter((w) => w.length > 3 && !STOPWORDS.has(w))
    .filter((w, i, a) => a.indexOf(w) === i)
    .slice(0, 4);

  // An external sender narrows on its own. Subject words only narrow when there
  // are enough of them to be specific -- one generic noun is not a search, and
  // offering it as one spends the user's click to teach them the button is
  // useless. Better to show no button than a bad one.
  if (!useful && terms.length < 2) return null;

  const parts: string[] = [];
  if (useful) parts.push(`from:(${useful})`);
  if (terms.length) parts.push(`(${terms.map((t) => `"${t}"`).join(' OR ')})`);
  return { query: parts.join(' '), terms };
}

/**
 * Gmail's compose window, pre-filled. This is the no-scope route to a draft —
 * see draftReplyLive() for why the compose-action API was not used. The trade is
 * that it opens a NEW message: a URL cannot set References headers, so the reply
 * will not thread into the conversation.
 */
function gmailComposeUrl(input: ThreadCardInput, body: string): string {
  const to = input.headers?.from ?? '';
  const subject = input.headers?.subject ?? '';
  const re = /^re:/i.test(subject) ? subject : `Re: ${subject}`;
  const params = new URLSearchParams({ view: 'cm', fs: '1', to, su: re, body });
  const auth = input.viewerEmail ? `?authuser=${encodeURIComponent(input.viewerEmail)}` : '';
  return `https://mail.google.com/mail/u/0/${auth}${auth ? '&' : '?'}${params.toString()}`;
}

function gmailSearchUrl(query: string, viewerEmail?: string): string {
  const target = viewerEmail ? `?authuser=${encodeURIComponent(viewerEmail)}` : '';
  return `https://mail.google.com/mail/u/0/${target}#search/${encodeURIComponent(query)}`;
}

/**
 * Severity colour. <font color> is the ONLY formatting CardService offers, and
 * it costs nothing — no stored data, no extra call. Paired with the label text
 * below so the signal never rides on colour alone.
 */
const LIVE_COLOR: Record<LiveAnalysis['sentiment'], string> = {
  negative: '#c5221f',
  neutral: '#5f6368',
  positive: '#137333',
};

/**
 * What each mode actually shows.
 *
 * One card for every email is why ordinary mail read as flat: a calendar invite
 * got a sentiment verdict, an account history and a churn trend, none of which
 * it deserved. The panel now spends its space on what the thread is FOR.
 *
 * `fyi` is the important one. Most mail needs nothing, and a panel that admits
 * that in one line is more useful — and more trustworthy — than one that
 * manufactures four sections of analysis to look busy.
 */
interface ModeSpec {
  /** Replaces the sentiment headline. Sentiment is only the answer for complaints. */
  headline: (r: { sentiment: LiveAnalysis['sentiment']; commitments: number; unanswered: number }) => string;
  showHistory: boolean;
  showAccount: boolean;
  showCommitments: boolean;
  showUnanswered: boolean;
  showDraft: boolean;
  showLoopIn: boolean;
}

const MODE_SPEC: Record<ThreadMode, ModeSpec> = {
  // Someone is unhappy. History is the differentiated signal and leads; the
  // draft matters most here because getting the wording wrong is expensive.
  complaint: {
    headline: () => 'Needs a careful reply',
    showHistory: true,
    showAccount: true,
    showCommitments: true,
    showUnanswered: true,
    showDraft: true,
    showLoopIn: true,
  },
  // Arranging a time. Nobody needs a sentiment verdict on a calendar invite —
  // they need to know who owes the next move.
  scheduling: {
    headline: (r) => (r.commitments ? 'Who owes the next move' : 'Times being arranged'),
    showHistory: false,
    showAccount: false,
    showCommitments: true,
    showUnanswered: true,
    showDraft: true,
    showLoopIn: false,
  },
  // Interest in more work. Account history is what tells you whether to lean in.
  opportunity: {
    headline: () => 'Possible opening',
    showHistory: true,
    showAccount: true,
    showCommitments: true,
    showUnanswered: true,
    showDraft: true,
    showLoopIn: true,
  },
  // Live work. Commitments and unanswered questions are the whole point.
  working: {
    headline: (r) =>
      r.unanswered ? `${r.unanswered} question${r.unanswered === 1 ? '' : 's'} unanswered` : 'Work in progress',
    showHistory: true,
    showAccount: false,
    showCommitments: true,
    showUnanswered: true,
    showDraft: true,
    showLoopIn: false,
  },
  // Nothing is owed. Say so and stop. The panel earns trust by being short when
  // short is the truth.
  fyi: {
    headline: () => 'Nothing needed from you',
    showHistory: true,
    showAccount: false,
    showCommitments: false,
    showUnanswered: false,
    showDraft: false,
    showLoopIn: false,
  },
};

/** Plain-language headline per live sentiment. Words, never colour alone. */
const LIVE_LABEL: Record<LiveAnalysis['sentiment'], string> = {
  negative: 'Needs attention',
  neutral: 'Nothing concerning',
  positive: 'Positive',
};

const SENTIMENT_RANK: Record<TrendPoint['sentiment'], number> = {
  positive: 1,
  neutral: 0,
  negative: -1,
};

/**
 * "Loop in", shared by the instant first paint and the analysed card — it needs
 * no model call, only headers we already hold.
 */
/**
 * The one control on a commitment — a reminder, a task, or nothing.
 * See the comment at the call site for why the order is date-first.
 */
function commitmentButton(
  c: { who: string; what: string; when?: string },
  ctx: { canTrack: boolean; today: Date; input: ThreadCardInput },
): Record<string, unknown> {
  const day = resolveWhen(c.when, ctx.today);
  if (day) {
    return {
      button: {
        text: 'Remind me',
        onClick: {
          openLink: {
            url: calendarUrl(`${c.who}: ${c.what}`, day, ctx.input.subject ?? undefined),
          },
        },
      },
    };
  }
  if (ctx.canTrack) {
    return {
      button: actionButton('Track', `${ctx.input.baseUrl}/gmail/task`, {
        customerId: ctx.input.account!.customerId!,
        title: `${c.who}: ${c.what}`.slice(0, 200),
      }),
    };
  }
  return {};
}

function loopInSections(input: ThreadCardInput): CardSection[] {
  const people = input.participants ?? [];
  if (!people.length) return [];

  const dropped = people.filter((p) => !p.onLatest);

  // Nobody dropped off means this section has nothing to say. Listing everyone
  // on the thread reproduces Gmail's own "to me, Sandeep, Vigneshwar" header
  // two inches to the left -- a section that costs space and tells the reader
  // something they are already looking at. The only reason this section exists
  // is the person who was part of the conversation and is NOT on the latest
  // reply, because that one is genuinely invisible.
  if (!dropped.length) return [];

  const widgets: Widget[] = dropped.map((p) =>
    deco({
      text: p.name ?? p.address,
      bottomLabel: [
        p.sent ? `wrote ${p.sent}` : `copied on ${p.messages}`,
        p.external ? 'external' : 'internal',
        'not on latest reply',
      ].join(' · '),
      wrapText: true,
    }),
  );

  return [{ header: heading('Loop in'), widgets }];
}

export function buildThreadCard(input: ThreadCardInput): Card {
  const { status } = input;

  // The panel opens with the ANSWER, not with the envelope.
  //
  // "Open message" used to be the first section, printing Title / From / To /
  // Cc — every one of which Gmail is already showing, larger, a few inches to
  // the left. It pushed the only non-redundant thing on the card below the
  // fold. It now appears last, and only when it adds something Gmail does not
  // already have on screen.
  const sections: CardSection[] = [];

  // Sentiment trend (§5) + flagged messages (§6) are THREAD-level, so they show
  // whenever the thread is known — even when the open message itself isn't a
  // tracked customer email (e.g. an internal reply in a tracked client thread).
  const trendSection = buildTrendSection(input.trend ?? []);
  const flaggedSection = buildFlaggedSection(input.flagged ?? [], {
    viewerEmail: input.viewerEmail,
    baseUrl: input.baseUrl,
    threadId: input.threadId,
  });

  // `|| input.analysisPending` so a TRACKED thread also reaches the pending
  // branch below. Gating the analysis behind "not resolved" meant a thread
  // InboxPulse knows about could not be read at all — no commitments, no Track,
  // no draft — while an unknown one could. Backwards.
  if (status !== 'resolved' || input.analysisPending) {
    // A live, in-request reading of the open message. Shown INSTEAD of the
    // "nothing here" copy, because it answers the same question with real
    // content. Labelled as not-stored so nobody mistakes it for the analysed
    // record a tracked thread would have.
    // Reading the thread costs a model call — 6s on local hardware — and Gmail
    // renders nothing until the response arrives. So the first paint uses only
    // what is FREE (participants and a derived search, both from headers already
    // in hand) and offers the analysis as a button. The panel appears instantly
    // and the expensive work happens when asked for.
    if (input.analysisPending) {
      sections.push({
        widgets: [
          buttons(
            actionButton('Read this thread', `${input.baseUrl}/gmail/analyse`, {
              threadId: input.providerThreadId ?? '',
              messageId: input.messageId ?? '',
            }),
          ),
          deco({
            text: 'Sentiment, commitments and a draft reply — read on your machine, not stored.',
            wrapText: true,
          }),
        ],
      });

      const search = deriveSearch(input.headers, input.viewerEmail);
      if (search) {
        sections.push({
          header: heading('Do next'),
          widgets: [buttons(linkButton('Find related emails', gmailSearchUrl(search.query, input.viewerEmail)))],
        });
      }
      sections.push(...loopInSections(input));
      return { sections: separated(sections) };
    }

    if (input.live) {
      // 0. What history says that the thread does not.
      //
      // This leads the card, above even the account counts. Every other section
      // is derived from the open thread, and Gemini reads that same thread from
      // three inches away — so thread-derived content is content the user can
      // already get. These points cannot be got anywhere else, and a design that
      // buries or collapses them is a design that competes on Gemini's terms.
      const spec = MODE_SPEC[input.mode ?? 'working'];

      if (spec.showHistory && input.historyPoints?.length) {
        sections.push({
          header: heading('You should know'),
          widgets: input.historyPoints.map((p) =>
            deco({
              text: `<font color="${LIVE_COLOR.negative}">${escapeText(p)}</font>`,
              wrapText: true,
            }),
          ),
        });
      }

      // 0b. The account. This goes ABOVE the summary on purpose: a summary of the
      // open thread is what Gmail's own Gemini button already gives, so it is
      // not what makes this panel worth opening. What Gemini structurally
      // CANNOT know is history — how long this customer has been writing, what
      // they have complained about before, what is still open. That is the
      // reason to look here rather than there, so it leads.
      const acct = input.account;
      if (spec.showAccount && acct?.found) {
        const widgets: Widget[] = [
          deco({
            text: `<b>${escapeText(acct.name ?? 'Customer')}</b>`,
            bottomLabel: [
              acct.scope === 'viewer'
                ? `${acct.messages.toLocaleString()} messages you are on`
                : `${acct.messages.toLocaleString()} messages`,
              `${acct.threads} threads`,
              acct.firstSeen ? `since ${acct.firstSeen}` : null,
            ]
              .filter(Boolean)
              .join(' · '),
            wrapText: true,
          }),
        ];

        if (acct.openTasks > 0) {
          widgets.push(
            deco({
              text: `<font color="${LIVE_COLOR.negative}">${acct.openTasks} open task${acct.openTasks === 1 ? '' : 's'}</font>`,
              wrapText: true,
            }),
          );
        }

        if (acct.priorConcerns.length) {
          widgets.push(
            deco({
              topLabel: `Raised before — ${acct.negativeCount} negative message${acct.negativeCount === 1 ? '' : 's'}`,
              text: acct.priorConcerns
                .map((p) => `<b>${p.when}</b> ${escapeText(p.reason)}`)
                .join('<br>'),
              wrapText: true,
            }),
          );
        }

        sections.push({ header: heading('This account'), widgets });
      }

      // 1. State — but the headline is the MODE's question, not a sentiment
      // verdict. "Nothing concerning" on a calendar invite answers a question
      // nobody asked; "Who owes the next move" answers the one they have.
      sections.push({
        widgets: [
          deco({
            text: `<b><font color="${LIVE_COLOR[input.live.sentiment]}">${escapeText(
              spec.headline({
                sentiment: input.live.sentiment,
                commitments: input.digest?.commitments.length ?? 0,
                unanswered: input.digest?.openQuestions.length ?? 0,
              }),
            )}</font></b>`,
            bottomLabel: input.live.reason,
            wrapText: true,
          }),
        ],
      });

      if (trendSection) sections.push(trendSection);
      if (flaggedSection) sections.push(flaggedSection);

      // 2. What the thread actually commits people to. This is the part that is
      // invisible at a glance and does not depend on anything being WRONG —
      // which is why it earns space on a benign thread where sentiment does not.
      const digest = input.digest;
      if (spec.showCommitments && digest?.commitments.length) {
        // Every commitment gets an action that is NOT writing an email, because
        // writing the email is the one thing Gmail already does for you. The
        // failure this section exists to prevent is a promise being made and
        // then dropped, and no draft prevents that.
        //
        // Which action depends on what we can honestly offer:
        //   a resolvable date -> a calendar reminder, because a dated promise is
        //     precisely the droppable one, and a template URL needs no OAuth
        //     scope so it works for every user on day one;
        //   no date but a known account -> a tracked task, so an open-ended
        //     promise lands somewhere durable instead of in this thread.
        // Neither is available -> no button, rather than a control that lies.
        const canTrack = Boolean(input.account?.customerId && input.baseUrl);
        const today = input.now ?? new Date();
        sections.push({
          header: heading('Who owes what'),
          widgets: digest.commitments.map((c) =>
            deco({
              // The quote is the point: a paraphrase is a claim to trust, a
              // quote is one the reader can check against the thread on screen.
              text: `<b>${escapeText(c.who)}</b> — ${escapeText(c.what)}${
                c.quote ? `<br><i>&ldquo;${escapeText(c.quote)}&rdquo;</i>` : ''
              }`,
              bottomLabel: c.when,
              wrapText: true,
              ...commitmentButton(c, { canTrack, today, input }),
            }),
          ),
        });
      }
      if (spec.showUnanswered && digest?.openQuestions.length) {
        sections.push({
          header: heading('Unanswered'),
          widgets: digest.openQuestions.map((q) => deco({ text: q, wrapText: true })),
        });
      }

      // 3. Do next — real actions, all derived from the message alone.
      const search = deriveSearch(input.headers, input.viewerEmail);
      const doNext: Widget[] = [];
      const btns = [];
      // Stance choice, not a menu. The first is recommended and gets the FILLED
      // button; alternates are OUTLINED. Three equal buttons would be three
      // decisions, and the median user does the default — so there has to be
      // one, and it has to be the right one.
      const options = spec.showDraft ? input.replyOptions ?? [] : [];
      if (options.length) {
        // The recommended stance arrives written; the alternatives arrive as a
        // choice. Writing all three costs ~7s more and two of them were always
        // going to be discarded — see ReplyOption.text.
        // The draft goes in `text`, which wraps and renders in full. It was in
        // bottomLabel, truncated at 147 characters -- so the user was asked to
        // choose between approaches while being shown half of one of them.
        // A choice you cannot read is not a choice.
        const widgets: Widget[] = options.map((o, i) =>
          deco({
            topLabel: `${o.stance}${i === 0 ? '  ·  recommended' : ''}${
              o.rationale ? ` — ${o.rationale}` : ''
            }`,
            text: o.text ? escapeText(o.text) : '<i>Pick this approach to have it written</i>',
            wrapText: true,
            button: o.text
              ? {
                  text: 'Use this',
                  onClick: { openLink: { url: gmailComposeUrl(input, o.text) } },
                }
              : actionButton('Write this', `${input.baseUrl}/gmail/stance`, {
                  stance: o.stance,
                  threadId: input.providerThreadId ?? '',
                  messageId: input.messageId ?? '',
                }),
          }),
        );
        sections.push({ header: heading('How to answer'), widgets });
      } else if (spec.showDraft && input.draft) {
        btns.push(linkButton('Draft a reply', gmailComposeUrl(input, input.draft)));
      }
      if (search) btns.push(linkButton('Find related emails', gmailSearchUrl(search.query, input.viewerEmail)));
      if (input.chatShareEnabled && input.baseUrl) {
        btns.push(
          actionButton('Share to Chat', `${input.baseUrl}/gmail/share/chat`, {
            subject: input.headers?.subject ?? '',
            from: input.headers?.from ?? '',
            sentiment: LIVE_LABEL[input.live.sentiment],
            reason: input.live.reason,
            messageId: input.messageId ?? '',
          }),
        );
      }
      if (btns.length) doNext.push(buttons(...btns));
      if (search) {
        doNext.push(
          deco({
            text: `Opens a new Gmail tab searching ${search.terms.join(', ') || 'this sender'}.`,
            wrapText: true,
          }),
        );
      }
      if (doNext.length) sections.push({ header: heading('Do next'), widgets: doNext });

      // 4. Loop in — answered from the whole chain, not the open message.
      // Anyone who was on the conversation but is off the latest reply leads,
      // because that is the name the open message cannot show you.
      sections.push(...loopInSections(input));

      // Provenance sits at the bottom: it matters for trust, but nobody opens
      // the panel to read it. Quiet, and unambiguous that nothing was written.
      // Say how many messages were actually read. Claiming "the open message"
      // while the trend above shows four is a small lie the user can see.
      const analysed = input.analysedMessages ?? input.trend?.length ?? 0;
      sections.push({
        widgets: [
          deco({
            topLabel: 'How this was read',
            text:
              analysed > 1
                ? `Analysed live from ${analysed} messages on this thread. Not stored.`
                : 'Analysed live from the open message. Not stored.',
            wrapText: true,
          }),
        ],
      });
      return { sections: separated(sections) };
    }

    // Reachable with status 'resolved' now that the pending branch is hoisted —
    // but only when analysis is off, since pending returns above.
    if (status === 'resolved') return { sections: separated(sections) };

    const hint = NON_RESOLVED_HINT[status];
    sections.push({
      widgets: [deco({ text: NON_RESOLVED_COPY[status], bottomLabel: hint, wrapText: true })],
    });
    // Only worth showing the envelope when we have nothing else to say.
    sections.push(buildOpenMessageSection(input));
    // Trend and flags are THREAD-level, so show them if we have them even when
    // the open message itself isn't tracked — an internal reply inside a tracked
    // client thread still has thread context worth seeing.
    if (trendSection) sections.push(trendSection);
    if (flaggedSection) sections.push(flaggedSection);
    return { sections: separated(sections) };
  }

  // Section order follows the questions a CSM actually asks, in order:
  //   state → what's wrong → background → who to loop in.
  // The previous order (Account, trend, flagged, flags) was organised by data
  // type, which buries the one thing that decides whether to act at all.
  const state = deriveState(input.trend ?? [], input.flagged ?? []);
  sections.push({ widgets: [deco({ text: state.headline, bottomLabel: state.detail, wrapText: true })] });

  if (flaggedSection) sections.push(flaggedSection);

  const flags = input.flags ?? [];
  const backgroundWidgets: Widget[] = [
    deco({ topLabel: 'Customer', text: input.accountName || 'Unknown customer' }),
  ];
  if (flags.length) {
    backgroundWidgets.push(
      deco({
        topLabel: `${flags.length} signal${flags.length > 1 ? 's' : ''} on this message`,
        text: flags.join(', '),
        wrapText: true,
      }),
    );
  }
  sections.push({ header: heading('Background'), widgets: backgroundWidgets });

  if (trendSection) sections.push(trendSection);

  if (input.task) {
    const t = input.task;
    const widgets: Widget[] = [
      deco({
        topLabel: 'Escalation',
        text: t.done ? '✓ Resolved' : 'Open',
        bottomLabel: t.assignee ? `Assigned to ${t.assignee}` : 'Unassigned',
      }),
    ];
    if (t.problem) widgets.push(deco({ topLabel: 'Problem', text: t.problem, wrapText: true }));
    if (t.resolution) widgets.push(deco({ topLabel: 'Resolution', text: t.resolution, wrapText: true }));
    sections.push({ header: heading('Escalation'), widgets });
  }

  // The tracked card had no actions at all — every button lived on the untracked
  // branch. A thread InboxPulse knows about deserves them more, not less.
  const trackedSearch = deriveSearch(input.headers, input.viewerEmail);
  const trackedBtns = [];
  if (input.draft) trackedBtns.push(linkButton('Draft a reply', gmailComposeUrl(input, input.draft)));
  if (trackedSearch)
    trackedBtns.push(linkButton('Find related emails', gmailSearchUrl(trackedSearch.query, input.viewerEmail)));
  if (trackedBtns.length) {
    sections.push({ header: heading('Do next'), widgets: [buttons(...trackedBtns)] });
  }

  sections.push(...loopInSections(input));

  // Envelope last, as reference. Gmail already shows subject and sender in the
  // thread pane; the only genuinely additive fields here are the full To/Cc/Bcc
  // lists, which Gmail keeps collapsed.
  sections.push(buildOpenMessageSection(input));

  return { sections: separated(sections) };
}
