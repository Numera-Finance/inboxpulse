/**
 * Merging what the CRM stored with what Gmail has rendered, into the one list
 * the picker shows.
 *
 * The CRM is the base. It holds a row per message of the thread whether or not
 * Gmail has shipped that message to the page, which is the only way the picker
 * can offer a message hidden inside a super-collapsed run ("N more messages") —
 * those have no DOM row and no MessageView until the run is opened, so a
 * DOM-sourced list is silently short by however many are in them.
 *
 * Gmail is the fallback, and covers the opposite gap: the sync drops most
 * outbound mail, so the reader's own replies are real messages in the
 * conversation with no stored row at all. Those join the list as Gmail renders
 * them.
 *
 * Neither source alone is the thread. Both together are.
 *
 * ── Why matching is not just `id === id` ────────────────────────────────────
 *
 * Gmail message ids are per-mailbox. The same email carries a different id in
 * every participant's mailbox, and the CRM stores one row per message bearing
 * the id of whichever mailbox ingested it first — so in a thread that reached
 * the CRM through several colleagues, some stored rows carry ids this reader's
 * Gmail has never heard of. Matching on id alone would then show those messages
 * twice: once as a stored row believed to be missing, and once as the DOM row
 * that is in fact the same email.
 *
 * So an id match is tried first, and what it leaves over is matched on
 * resemblance — same sender, within a few minutes — which is the same test
 * message-registry uses to find a row to open, for the same reason.
 */

import type { ActiveMessage } from './active-message-store';
import type { ThreadMessageEntry } from './thread-messages-store';

/**
 * A stored message, as the thread messages API returns it. Declared
 * structurally rather than imported from the hook so this stays a pure module
 * with no React in its dependency graph.
 */
export interface StoredMessage {
  messageId: string;
  fromEmail: string;
  fromName: string | null;
  receivedAt: string;
  subject: string;
  bodyPreview?: string;
}

export interface ListEntry {
  /**
   * Identity for React, and what the reader is choosing. Prefers the DOM's id
   * when the message is on screen: that one is this mailbox's, so revealing it
   * takes the registry fast path instead of falling back to resemblance.
   */
  id: string;
  /** What gets handed to the selection store when this row is picked. */
  selection: ActiveMessage;
  /** The stored row, when the CRM ingested this message. */
  stored: StoredMessage | null;
  /**
   * False when the CRM knows about this message but Gmail has not put it in the
   * page — it is inside an unopened run. Still selectable; reaching it just
   * costs a run being opened first.
   */
  loaded: boolean;
  sender: string;
  subject: string;
  /** Epoch ms, or null when neither source could give a usable time. */
  receivedAt: number | null;
}

/** How close two timestamps must be to be the same message. Matches findRow. */
const MATCH_WINDOW_MS = 5 * 60 * 1000;

export function buildMessageList(
  dom: ThreadMessageEntry[],
  stored: StoredMessage[],
): ListEntry[] {
  const times = fillTimes(dom);
  const takenStored = new Set<string>();
  const pairs = new Map<string, StoredMessage>();

  // Pass one: exact id. Correct whenever the stored row came from this mailbox,
  // which is the common case and the cheap one.
  const byId = new Map(stored.map((message) => [message.messageId, message]));
  for (const entry of dom) {
    const match = byId.get(entry.message.id);
    if (!match) continue;
    pairs.set(entry.message.id, match);
    takenStored.add(match.messageId);
  }

  // Pass two: resemblance, for the rows whose id belongs to a colleague's
  // mailbox. Nearest in time wins among that sender's unclaimed messages, so
  // two emails from one person minutes apart don't swap.
  for (const entry of dom) {
    if (pairs.has(entry.message.id)) continue;
    const match = closestUnclaimed(entry, times, stored, takenStored);
    if (!match) continue;
    pairs.set(entry.message.id, match);
    takenStored.add(match.messageId);
  }

  const entries: ListEntry[] = dom.map((entry) => {
    const match = pairs.get(entry.message.id) ?? null;
    return {
      id: entry.message.id,
      selection: entry.message,
      stored: match,
      loaded: true,
      sender: senderOf(match?.fromName, entry.message.fromName, match?.fromEmail, entry.message.fromEmail),
      subject: match?.subject || entry.message.subject || '(no subject)',
      receivedAt: parseIso(match?.receivedAt) ?? times.get(entry.message.id) ?? null,
    };
  });

  // Whatever the CRM holds that never matched a rendered message. These are the
  // rows the picker exists to surface — before this, they were unreachable
  // without guessing which run to unfold.
  for (const message of stored) {
    if (takenStored.has(message.messageId)) continue;
    entries.push({
      id: message.messageId,
      selection: asActiveMessage(message),
      stored: message,
      loaded: false,
      sender: senderOf(message.fromName, null, message.fromEmail, null),
      subject: message.subject || '(no subject)',
      receivedAt: parseIso(message.receivedAt),
    });
  }

  // Oldest first, the order Gmail lays the thread out in and the order the
  // flagged list already uses. Undated rows keep their relative position at the
  // end rather than being scattered through a list they can't be placed in.
  return entries
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => {
      const at = a.entry.receivedAt;
      const bt = b.entry.receivedAt;
      if (at !== null && bt !== null && at !== bt) return at - bt;
      if (at === null && bt !== null) return 1;
      if (at !== null && bt === null) return -1;
      return a.index - b.index;
    })
    .map(({ entry }) => entry);
}

/**
 * A usable timestamp for every rendered message.
 *
 * Gmail writes the full date into the title of a row's date cell, which is what
 * the store scrapes — but not on every row, and not always before the panel
 * first reads it. A row that comes back without one inherits the previous row's
 * time plus a millisecond: the thread pane is laid out oldest-first, so its
 * neighbour is the best available estimate, and it keeps the row adjacent to
 * where it actually sits instead of sending it to the bottom of the list.
 */
function fillTimes(dom: ThreadMessageEntry[]): Map<string, number> {
  const times = new Map<string, number>();
  let previous: number | null = null;

  for (const entry of dom) {
    const known = entry.receivedAt;
    if (known !== null) {
      previous = known;
      times.set(entry.message.id, known);
    } else if (previous !== null) {
      previous += 1;
      times.set(entry.message.id, previous);
    }
  }

  return times;
}

/**
 * The unclaimed stored message that best resembles a rendered one.
 *
 * Sender is required and exact — it is the one field both sources agree on
 * character for character. Time then separates that sender's messages from each
 * other, and bounds the whole thing: without the window, a thread where the CRM
 * holds three messages from someone and Gmail shows two would pair the leftover
 * with whichever was nearest, however far away that was.
 */
function closestUnclaimed(
  entry: ThreadMessageEntry,
  times: Map<string, number>,
  stored: StoredMessage[],
  taken: Set<string>,
): StoredMessage | null {
  const sender = entry.message.fromEmail?.toLowerCase();
  const at = times.get(entry.message.id);
  if (!sender || at === undefined) return null;

  let best: StoredMessage | null = null;
  let bestGap = MATCH_WINDOW_MS;

  for (const message of stored) {
    if (taken.has(message.messageId)) continue;
    if (message.fromEmail.toLowerCase() !== sender) continue;
    const storedAt = parseIso(message.receivedAt);
    if (storedAt === null) continue;
    const gap = Math.abs(storedAt - at);
    if (gap <= bestGap) {
      best = message;
      bestGap = gap;
    }
  }

  return best;
}

/**
 * A stored row, in the shape the selection store speaks.
 *
 * Recipients are left empty rather than invented: the thread messages API does
 * not return them, and the "Selected" block reads to/cc from its own stored
 * envelope anyway — an empty list there means "we have nothing", which is true,
 * where a fabricated one would mean something false.
 */
function asActiveMessage(message: StoredMessage): ActiveMessage {
  return {
    id: message.messageId,
    fromName: message.fromName,
    fromEmail: message.fromEmail,
    recipients: [],
    dateString: null,
    subject: message.subject,
  };
}

function senderOf(
  ...candidates: Array<string | null | undefined>
): string {
  for (const candidate of candidates) {
    if (candidate) return candidate;
  }
  return 'Unknown sender';
}

function parseIso(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}
