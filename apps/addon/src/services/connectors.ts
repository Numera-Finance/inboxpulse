import type { ThreadMode } from './live-analysis';

/**
 * Systems we could triangulate against, and the ONE fact worth pulling from each.
 *
 * This is the stack MyStartupCFO actually runs: Streak and Canopy for CRM and
 * practice management, Google Chat rather than Slack, QuickBooks Online for
 * client books. No Jira, no Stripe, no HubSpot -- an earlier version of this
 * file listed those, which made it a catalogue of a generic SaaS company rather
 * than a spec for this one.
 *
 * None are connected. `integrations.source` is an enum of exactly four values --
 * gmail, outlook, slack, other -- and only gmail has rows (15, of which 2
 * active). Every connector below needs that enum extended before it can even be
 * stored, which is a migration, so this is a specification rather than an
 * integration. It lives in code because the shape of what we ask for is the
 * design decision and it should be reviewable.
 *
 * THE DISCIPLINE: one fact per system.
 *
 * The temptation with a connector is to pull the object -- the whole engagement,
 * the whole ledger, the whole box -- because the API returns it and it is free.
 * That turns the panel into a dashboard, and a dashboard is the thing the user
 * already has in six other tabs. It is also how the panel becomes something you
 * scroll rather than something you read, and a panel you scroll has already lost
 * to the reply box six inches away.
 *
 * So the bar for each field is: WOULD KNOWING THIS CHANGE THE REPLY? Not "is it
 * interesting", not "is it available". A field that does not change what the
 * user writes, or whether they write at all, has no claim on the space.
 *
 * The second bar is that it must be a fact the person cannot see from the thread.
 * Gemini reads the same thread we do; anything derivable from the open messages
 * is a point it already makes for free. These systems are the part it
 * structurally cannot reach.
 *
 * ACCESS: every one of these inherits the rule in account-context.ts -- a signal
 * is only shown to a viewer entitled to that customer. Cross-system data makes
 * leakage worse, not better: a client's close status or AR position is a more
 * sensitive fact than an email subject, and pulling it through a panel keyed on
 * a sender domain is exactly how someone reads a company's finances because they
 * received one email from them.
 */

export interface Connector {
  /** Stable key; would need adding to the integrations.source enum. */
  key: string;
  /** How the user refers to the system. */
  name: string;
  /**
   * The single fact to pull. Deliberately narrow -- this is the contract, and a
   * connector that grows past one fact should be challenged, not extended.
   */
  pull: string;
  /** The line it would produce on the card, written as the user would read it. */
  example: string;
  /** Why knowing it changes the reply. This is the field that justifies the rest. */
  changesTheReply: string;
  /**
   * Which threads it is worth suggesting on. A close-status fact is noise on a
   * scheduling thread, and a suggestion that arrives when it cannot help is how
   * users learn to stop reading a section.
   */
  modes: ThreadMode[];
  /** What it costs to build -- the honest part of any roadmap line. */
  cost: string;
}

/**
 * Ordered by how often the fact changes the reply, because `suggestConnector`
 * takes the first match.
 */
export const CONNECTORS: Connector[] = [
  {
    key: 'canopy',
    name: 'Canopy',
    pull: 'open client requests and how long they have been outstanding',
    example: '3 documents requested, oldest 12 days',
    // For a firm doing outsourced finance, the overwhelming majority of friction
    // is one question: whose turn is it? "We are waiting on you" and "you are
    // waiting on us" produce opposite emails, and the thread almost never says
    // which is true. Getting this backwards is the reply that costs a client.
    changesTheReply: 'whether the ball is with us or with them',
    modes: ['complaint', 'working', 'scheduling'],
    cost: 'Canopy API + OAuth; needs a customer↔client mapping and an enum migration',
  },
  {
    key: 'qbo',
    name: 'QuickBooks Online',
    pull: 'how far the books are closed for this client',
    example: 'Books closed through June; July in progress',
    // "Where are my financials" is answerable in one line or not at all. Close
    // status is also the fact that decides whether to commit to a date, which is
    // the promise most likely to be made carelessly and remembered precisely.
    changesTheReply: 'whether you can promise a date, and which one',
    modes: ['complaint', 'working'],
    cost: 'Intuit OAuth per client realm; read-only; enum migration',
  },
  {
    key: 'streak',
    name: 'Streak',
    pull: 'the pipeline and stage this contact sits in',
    example: 'Onboarding — Docs collected, 9 days in stage',
    // The cheapest connector on this list by a distance: Streak is Gmail-native,
    // so the box is already attached to the thread the user is reading. It is
    // also the only one whose data is arguably already on screen, which caps how
    // much it can add -- worth building first because it is easy, not because it
    // is the most valuable.
    changesTheReply: 'what stage the relationship is at, so the tone matches it',
    modes: ['opportunity', 'working', 'complaint'],
    cost: 'Streak API key; simplest of the five; enum migration',
  },
  {
    key: 'gchat',
    name: 'Google Chat',
    pull: 'whether this client was discussed internally in the last 7 days',
    example: 'Dolly raised this in Client — Blitzz yesterday',
    // Stops two people answering the same client differently within an hour,
    // which is the failure that makes a firm look disorganised in a way no
    // individual reply can undo. Same Google identity the add-on already holds,
    // so it is the least awkward OAuth ask here.
    changesTheReply: 'whether to reply at all, or check with whoever is already on it',
    modes: ['complaint', 'working', 'opportunity'],
    cost: 'chat.messages.readonly + a space↔client map; already same Google identity',
  },
  {
    key: 'calendar',
    name: 'Google Calendar',
    pull: 'the next meeting already booked with anyone on this thread',
    example: 'You already meet Sean on Thursday 2pm',
    // Turns three paragraphs into one sentence. Also prevents the specific
    // embarrassment of proposing times to someone you are seeing in two days.
    changesTheReply: 'whether to write a long reply at all, or just say "Thursday"',
    modes: ['scheduling', 'complaint', 'opportunity'],
    cost: 'calendar.readonly — RESTRICTED tier, so it needs security review',
  },
];

/**
 * The one connector worth suggesting on this thread.
 *
 * One, not a list. A list of things you have not connected is a nag bar, and a
 * nag bar in a panel that is asking for trust is a bad trade.
 *
 * Returns nothing when we do not know the customer: suggesting a Canopy lookup
 * for a client we cannot identify promises something we could not deliver even
 * if it were connected.
 */
export function suggestConnector(opts: {
  mode: ThreadMode | undefined;
  /** Sources with rows in `integrations` -- never suggest what is already on. */
  connected: string[];
  /** Whether the thread resolves to a customer we can key a lookup on. */
  hasCustomer: boolean;
}): Connector | null {
  if (!opts.hasCustomer || !opts.mode) return null;
  const on = new Set(opts.connected);
  return (
    CONNECTORS.find((c) => c.modes.includes(opts.mode as ThreadMode) && !on.has(c.key)) ?? null
  );
}
