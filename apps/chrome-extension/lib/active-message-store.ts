/**
 * Which message in the open thread the reader is currently looking at, and the
 * envelope Gmail shows for it.
 *
 * Splits the panel into two scopes, matching the add-on's behaviour:
 *   - THREAD scope (sentiment trend, flagged list, customer) stays fixed while
 *     the reader moves around inside one conversation.
 *   - MESSAGE scope (the "Selected" and "Analysis" blocks) follows whichever
 *     message is selected, so choosing a different email in the thread swaps
 *     those sections without disturbing anything else.
 *
 * The envelope carried here is read off Gmail's own DOM, and is a FALLBACK: the
 * stored row (fetched with the thread) is preferred because it keeps `to` and
 * `cc` apart, which InboxSDK does not — `getRecipientEmailAddresses()` is one
 * flat list. What the DOM does cover is messages the CRM never ingested (the
 * reader's own sent replies, most often), where the stored row simply doesn't
 * exist and the block would otherwise be blank.
 *
 * Two things set the selection, with equal standing: expanding a message in
 * Gmail, and picking one from the panel's message list. Nothing clears it but
 * leaving the conversation.
 *
 * That last part is the whole design. Selection used to be *derived* from
 * expansion — expand sets, collapse clears — which broke as soon as a reader had
 * two messages open at once: clicking an already-expanded message fires no view
 * state change, so there was no way to move the selection back to it, and the
 * flagged list and search box created that state every time they were used.
 * Deriving also forced a guard on the clear, because Gmail expands the next
 * message before collapsing the previous one, and an unconditional clear wiped
 * the selection the reader had just made. Both problems are the same problem,
 * and neither exists once selection is something the reader sets rather than
 * something inferred from what happens to be open.
 *
 * The visible consequence: collapsing every message leaves the last selection
 * standing instead of emptying the message-scoped sections. The list shows which
 * message that is, so nothing is ambiguous — and the alternative is a panel that
 * goes blank while the reader is still reading about that email.
 *
 * Fed by content.ts from InboxSDK's per-message events, and by MessageList.
 * Same hand-rolled store shape as thread-store, and for the same reason: the
 * publisher is an InboxSDK callback outside the React tree.
 */

export interface ActiveMessage {
  /** Gmail (provider) message id. */
  id: string;
  fromName: string | null;
  fromEmail: string | null;
  /** Flat — Gmail's DOM exposes no to/cc split. See the note above. */
  recipients: string[];
  /** Gmail's own rendering of the date, e.g. "Jul 20, 2026, 9:14 AM". */
  dateString: string | null;
  subject: string | null;
}

let activeMessage: ActiveMessage | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const fn of listeners) {
    try {
      fn();
    } catch (err) {
      console.warn('[InboxPulse] active-message listener failed:', err);
    }
  }
}

function sameMessage(a: ActiveMessage | null, b: ActiveMessage): boolean {
  return (
    a !== null &&
    a.id === b.id &&
    a.fromName === b.fromName &&
    a.fromEmail === b.fromEmail &&
    a.dateString === b.dateString &&
    a.subject === b.subject &&
    a.recipients.length === b.recipients.length &&
    a.recipients.every((r, i) => r === b.recipients[i])
  );
}

/**
 * Called when a message expands in Gmail.
 *
 * Re-publishing the same id with a fuller envelope is allowed and expected:
 * Gmail fills the header in after the view-state event, so the first read can
 * come back with a sender but no date. Bailing on id alone would freeze that
 * first partial read in place.
 */
export function setActiveMessage(message: ActiveMessage): void {
  if (sameMessage(activeMessage, message)) return;
  activeMessage = message;
  emit();
}

/**
 * Called when the reader picks a message from the panel's list.
 *
 * Identical to setActiveMessage today, and separate anyway: these are different
 * events that happen to agree, and the reason the list exists at all is that the
 * expansion-driven path cannot express "this one" for a message already open.
 * Collapsing them would invite the next change to reintroduce that coupling.
 */
export function selectMessage(message: ActiveMessage): void {
  setActiveMessage(message);
}

/** Called when the thread changes, so the selection doesn't leak across threads. */
export function resetActiveMessage(): void {
  if (activeMessage === null) return;
  activeMessage = null;
  emit();
}

export function getActiveMessageSnapshot(): ActiveMessage | null {
  return activeMessage;
}

export function subscribeActiveMessage(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
