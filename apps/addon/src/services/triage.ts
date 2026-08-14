import type { ThreadMode } from './live-analysis';

/**
 * Ordering an inbox by what it asks of you.
 *
 * The panel cannot see which rows you have ticked — Gmail gives add-ons exactly
 * two triggers, compose and message-open, and neither carries a selection. So
 * rather than acting on threads the user picks, this picks the threads: read the
 * top of the inbox, classify each, and put them in the order a competent person
 * would work them.
 *
 * That is a better answer than the row button anyway. The row button makes the
 * user decide what matters and then click; this decides, and the user disagrees
 * where it is wrong. Raising the floor means the default order is good, not that
 * the tools for reordering are good.
 */

/**
 * What each mode is worth in a queue, highest first.
 *
 * Not the same order as the card's MODE_SPEC, and deliberately so: that orders
 * by how much the panel can SAY about a thread, this orders by how much the
 * thread costs you to leave. A complaint left overnight gets worse on its own.
 * A scheduling thread expires — a meeting you answer tomorrow is a meeting
 * someone else has already rearranged. Working is the bulk of real work but
 * rarely time-critical. Opportunity decays slowly. FYI never decays because
 * nothing is owed.
 */
const WEIGHT: Record<ThreadMode, number> = {
  complaint: 100,
  scheduling: 80,
  working: 50,
  opportunity: 40,
  fyi: 0,
};

/** Plain-language reason the item sits where it does. */
const WHY: Record<ThreadMode, string> = {
  complaint: 'Someone is unhappy — gets worse if it waits',
  scheduling: 'A time is being arranged — expires if you leave it',
  working: 'Live work, waiting on you',
  opportunity: 'An opening — decays slowly, but it decays',
  fyi: 'Nothing needed from you',
};

export interface TriageItem {
  threadId: string;
  subject: string;
  from: string;
  mode: ThreadMode;
  why: string;
  /** Age of the newest message, in hours. */
  ageHours: number;
}

export function rankTriage(
  items: Array<{ threadId: string; subject: string; from: string; mode: ThreadMode; at: number }>,
  now: number,
): TriageItem[] {
  return items
    .map((i) => ({
      threadId: i.threadId,
      subject: i.subject,
      from: i.from,
      mode: i.mode,
      why: WHY[i.mode],
      ageHours: i.at ? Math.max(0, Math.round((now - i.at) / 3_600_000)) : 0,
    }))
    .sort((a, b) => {
      const w = WEIGHT[b.mode] - WEIGHT[a.mode];
      if (w !== 0) return w;
      // Within a mode, oldest first — the thing that has been waiting longest is
      // the thing most likely to have been forgotten.
      return b.ageHours - a.ageHours;
    });
}

/** Threads that need nothing, separated out rather than ranked last. */
export function splitQuiet(items: TriageItem[]): { work: TriageItem[]; quiet: TriageItem[] } {
  return {
    work: items.filter((i) => i.mode !== 'fyi'),
    quiet: items.filter((i) => i.mode === 'fyi'),
  };
}
