/**
 * The text of each message in the open conversation, read off Gmail's own DOM.
 *
 * WHY THE EXTENSION HAS TO DO THIS AT ALL. The add-on reads bodies from the
 * Gmail API using the token Google hands it. The extension has no Gmail
 * credential of any kind — no `identity` permission, no OAuth client, and
 * `gmail.googleapis.com` is not in host_permissions — so on this path there is
 * nothing to fetch with. What it does have is the rendered conversation, in a
 * content script, which InboxSDK already gives it a handle on.
 *
 * So the panel supplies the text instead of the add-on fetching it. That is a
 * narrower capability than it sounds: it is the same conversation the reader has
 * open on screen, and it never leaves the machine — the only consumer is the
 * add-on on localhost.
 *
 * NOT A CACHE, and deliberately not persisted. It holds the open thread and is
 * cleared when the reader leaves it, so it never accumulates mail. Same
 * reasoning as the add-on's analysis cache: the panel's claim is that it does
 * not keep your mail, and a store that outlived the thread would make that
 * false in the ordinary case rather than the exceptional one.
 *
 * Plain module state rather than a subscribable store: nothing renders from
 * this. It is read once, at the moment a card is fetched or a button pressed.
 */

/** Belt and braces against a runaway thread — the add-on truncates as well. */
const MAX_CHARS = 40_000;

const bodies = new Map<string, string>();

/**
 * Record a message's visible text.
 *
 * Re-publishing is expected: Gmail renders a message collapsed, then fills it in
 * on expand, so the first read of a row is often empty. An empty read must never
 * replace text we already have — that is the difference between "not loaded yet"
 * and "this message is blank", and only the second one is a fact.
 */
export function putMessageBody(id: string, text: string | null | undefined): void {
  const trimmed = (text ?? '').trim();
  if (!trimmed) return;
  bodies.set(id, trimmed.slice(0, MAX_CHARS));
}

export function dropMessageBody(id: string): void {
  bodies.delete(id);
}

/** Called when the reader leaves the conversation. */
export function clearMessageBodies(): void {
  bodies.clear();
}

export function getMessageBody(id: string): string | undefined {
  return bodies.get(id);
}

export function messageBodyCount(): number {
  return bodies.size;
}
