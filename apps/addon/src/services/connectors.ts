import type { ThreadMode } from './live-analysis';

/**
 * Systems we could triangulate against, and the ONE fact worth pulling from each.
 *
 * None of these are connected. `integrations.source` is an enum of exactly four
 * values -- gmail, outlook, slack, other -- and only gmail has rows (15, of which
 * 2 active). So this is a specification, not an integration, and it is written
 * down in code rather than a doc because the shape of what we ask for is the
 * design decision, and it should be reviewable.
 *
 * THE DISCIPLINE: one fact per system.
 *
 * The temptation with a connector is to pull the object -- the whole deal, the
 * whole invoice, the whole issue -- because the API returns it and it is free.
 * That turns the panel into a dashboard, and a dashboard is the thing the user
 * already has in six other tabs. It is also how the panel becomes something you
 * scroll rather than something you read, and a panel you scroll has already lost
 * to the reply box six inches away.
 *
 * So the bar for each field below is: WOULD KNOWING THIS CHANGE THE REPLY? Not
 * "is it interesting", not "is it available". A field that does not change what
 * the user writes or whether they write at all has no claim on the space.
 *
 * The second bar is that it must be a fact the person cannot see from the thread.
 * Gemini reads the same thread we do; anything derivable from the open messages
 * is a point it already makes for free. These systems are the part it structurally
 * cannot reach.
 *
 * ACCESS: every one of these inherits the rule in account-context.ts -- a signal
 * is only shown to a viewer entitled to that customer. Cross-system data makes
 * leakage easier, not harder: an unpaid invoice total is a more sensitive fact
 * than an email subject, and pulling it through a panel keyed on a sender domain
 * is exactly how someone reads a company's finances because they got one email
 * from them.
 */

export interface Connector {
  /** Stable key; matches integrations.source where one exists. */
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
   * Which threads it is worth suggesting on. A payments fact is noise on a
   * scheduling thread, and a suggestion that arrives when it cannot help is how
   * users learn to stop reading a section.
   */
  modes: ThreadMode[];
  /** What it costs to build -- the honest part of any roadmap line. */
  cost: string;
}

export const CONNECTORS: Connector[] = [
  {
    key: 'issues',
    name: 'Jira',
    pull: 'status of the open issues raised by this customer',
    example: 'WEBHOOK-441 — in progress since Jul 28',
    // The most common lie in support email is "we're working on it" written by
    // someone with no way to check. This makes it checkable in one glance, and
    // it is the difference between an apology that lands and one that burns the
    // last of the customer's patience.
    changesTheReply: 'whether "we are working on it" is true, and since when',
    modes: ['complaint', 'working'],
    cost: 'OAuth app + issue-read scope; needs a customer↔project mapping',
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
  {
    key: 'payments',
    name: 'Stripe',
    pull: 'unpaid invoice count and the oldest due date',
    example: '2 invoices unpaid, oldest 41 days',
    // Money changes tone in both directions: you do not offer a goodwill credit
    // to someone 60 days overdue, and you do not chase someone who paid
    // yesterday. Both mistakes are expensive and both are invisible in Gmail.
    changesTheReply: 'how much goodwill to extend, and whether to raise billing at all',
    modes: ['complaint', 'opportunity'],
    cost: 'API key + customer id mapping; read-only, no user OAuth',
  },
  {
    key: 'crm',
    name: 'HubSpot',
    pull: 'open deal stage, amount, and expected close date',
    example: 'Renewal £48k closes in 3 weeks',
    // A complaint three weeks before renewal is a different email from the same
    // complaint the week after signing. The words barely change; the stakes do.
    changesTheReply: 'how much the thread is worth, and how fast it has to be handled',
    modes: ['complaint', 'opportunity'],
    cost: 'OAuth app + deal-read scope; needs a customer↔company mapping',
  },
  {
    key: 'slack',
    name: 'Slack',
    pull: 'whether this customer has been discussed internally in the last 7 days',
    example: 'Dolly raised this in #cs-escalations yesterday',
    // Stops two people answering the same customer differently within an hour,
    // which is the failure that makes a company look disorganised in a way no
    // individual reply can undo. Already in the integrations enum, so this is
    // the least speculative of the five.
    changesTheReply: 'whether to reply at all, or check with whoever is already on it',
    modes: ['complaint', 'working', 'opportunity'],
    cost: 'already in the integrations enum; needs search:read and a channel map',
  },
];

/**
 * The one connector worth suggesting on this thread.
 *
 * One, not a list. A list of things you have not connected is a nag bar, and a
 * nag bar in a panel that is asking for trust is a bad trade. Ordered by the
 * catalogue above, which is ordered by how often the fact changes the reply.
 *
 * Returns nothing when we do not know the customer: suggesting a Stripe lookup
 * for a company we cannot identify promises something we could not deliver even
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
