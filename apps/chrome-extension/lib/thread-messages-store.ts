/**
 * Every message of the open conversation that Gmail has actually rendered.
 *
 * This is the picker's SECOND source, not its first. The CRM's stored rows are
 * the base list — they cover the whole thread, including the messages sitting
 * inside a super-collapsed run that Gmail has not shipped to the page — and what
 * this store adds is the messages the CRM never ingested: the reader's own
 * replies, most often, which are real messages in the conversation and have no
 * row anywhere. Those cannot be known about until Gmail renders them, so they
 * join the list when they do. See lib/thread-message-list.ts for the merge.
 *
 * Entries carry the envelope content.ts already reads off InboxSDK, plus the
 * message's true timestamp scraped from its row. The timestamp is what lets a
 * DOM message be matched against a stored one whose id came from a different
 * mailbox, and what lets both sources sort into one conversation order.
 *
 * Same hand-rolled store shape as thread-store and active-message-store, and for
 * the same reason: the publisher is an InboxSDK callback outside the React tree.
 */

import type { ActiveMessage } from './active-message-store';

export interface ThreadMessageEntry {
  message: ActiveMessage;
  /**
   * When Gmail says it arrived, in epoch ms, or null when the row's date could
   * not be read. Not `ActiveMessage.dateString`, which is the visible rendering
   * and carries no day for recent mail.
   */
  receivedAt: number | null;
}

interface Registration {
  entry: ThreadMessageEntry;
  /**
   * The message's row in Gmail's DOM. Used ONLY to order the list, and never
   * handed to React — the snapshot is plain data.
   */
  element: HTMLElement | null;
  /** Arrival order. The tiebreak for rows we cannot place in the document. */
  seq: number;
}

const registry = new Map<string, Registration>();
const listeners = new Set<() => void>();

let nextSeq = 0;
/**
 * useSyncExternalStore compares snapshots by reference, so the ordered array is
 * built on mutation and handed out unchanged in between. Rebuilding it per call
 * would re-render the picker forever.
 */
let snapshot: ThreadMessageEntry[] = [];

function emit(): void {
  snapshot = ordered();
  for (const fn of listeners) {
    try {
      fn();
    } catch (err) {
      console.warn('[InboxPulse] thread-messages listener failed:', err);
    }
  }
}

/**
 * The thread's messages in the order Gmail shows them.
 *
 * By document position, not by date: `getDateString()` is Gmail's localized
 * rendering — precision varies with how old the message is, and "9:14 AM" for
 * today's mail carries no day at all — so parsing it back into something
 * sortable fails on exactly the threads long enough to need a picker. The rows
 * are already laid out in conversation order, and asking the DOM where they sit
 * relative to each other is exact.
 *
 * Rows we cannot place go last in arrival order rather than being dropped or
 * interleaved on a guess: a comparator that mixes "known position" with "no
 * position" is not a total order, and Array.sort is entitled to do anything
 * with one.
 */
function ordered(): ThreadMessageEntry[] {
  const placed: Registration[] = [];
  const unplaced: Registration[] = [];

  for (const registration of registry.values()) {
    const element = registration.element;
    if (element && element.isConnected) placed.push(registration);
    else unplaced.push(registration);
  }

  placed.sort((a, b) => {
    const relation = a.element!.compareDocumentPosition(b.element!);
    if (relation & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
    if (relation & Node.DOCUMENT_POSITION_PRECEDING) return 1;
    return a.seq - b.seq;
  });
  unplaced.sort((a, b) => a.seq - b.seq);

  return [...placed, ...unplaced].map((registration) => registration.entry);
}

function sameEntry(a: ThreadMessageEntry, b: ThreadMessageEntry): boolean {
  return (
    a.receivedAt === b.receivedAt &&
    a.message.id === b.message.id &&
    a.message.fromName === b.message.fromName &&
    a.message.fromEmail === b.message.fromEmail &&
    a.message.dateString === b.message.dateString &&
    a.message.subject === b.message.subject &&
    a.message.recipients.length === b.message.recipients.length &&
    a.message.recipients.every((recipient, i) => recipient === b.message.recipients[i])
  );
}

/**
 * Record a message, or refresh what we know about one.
 *
 * Re-publishing is expected, not exceptional: Gmail fills a message header in
 * progressively, so the first read of a row can come back with a sender and no
 * date. The row element is worth re-recording too — Gmail swaps nodes as a
 * message expands, and a stale reference silently demotes the row to "unplaced"
 * and sends it to the bottom of the list.
 */
export function putThreadMessage(
  entry: ThreadMessageEntry,
  element: HTMLElement | null,
): void {
  const id = entry.message.id;
  const existing = registry.get(id);
  if (existing && sameEntry(existing.entry, entry) && existing.element === element) {
    return;
  }
  registry.set(id, {
    entry,
    element,
    seq: existing?.seq ?? nextSeq++,
  });
  emit();
}

export function dropThreadMessage(id: string): void {
  if (!registry.delete(id)) return;
  emit();
}

/** Called when the reader leaves the conversation. */
export function clearThreadMessages(): void {
  if (registry.size === 0) return;
  registry.clear();
  emit();
}

export function getThreadMessagesSnapshot(): ThreadMessageEntry[] {
  return snapshot;
}

export function subscribeThreadMessages(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
