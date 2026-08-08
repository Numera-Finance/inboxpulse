import { revealMessage, type MessageDescriptor } from './message-registry';

/**
 * Taking the reader to a single message from the panel.
 *
 * This is the extension's one real advantage over the Gmail add-on that
 * preceded it: an add-on is sandboxed beside Gmail and can only hand it a URL,
 * so its drill-downs had to be rendered inside the add-on itself. A content
 * script runs *in* the Gmail page and can open the message's own row.
 *
 * There is deliberately no URL fallback. Setting `location.hash` was the first
 * approach and it is not a worse version of this one — it does something else:
 * Gmail resolves `#all/<id>` as a *conversation* and re-opens it in its default
 * state with the newest message expanded. Kept as a fallback, it fired whenever
 * the reveal came up short and undid it a moment after it worked — the thread
 * opened, then snapped back to the latest message. Every caller here names a
 * message in the conversation already on screen, so when we cannot open it,
 * doing nothing and saying why is the correct outcome.
 *
 * Pass as much of the descriptor as the caller has. The id alone fails whenever
 * the CRM stored the message under a colleague's mailbox id — see
 * `MessageDescriptor`.
 */
export function jumpToMessage(target: MessageDescriptor): void {
  // A failure is reported by revealMessage itself, which can say what it looked
  // at as well as what it wanted — the only useful form of that message.
  void revealMessage(target);
}
