import { logger } from '../utils/logger';
import type { InstantLabel } from '../services/instant-labels';

/**
 * Writing instant labels into the user's own Gmail.
 *
 * This is the one place the add-on modifies a mailbox, and it needs
 * `gmail.modify` — a RESTRICTED scope whose consent screen reads "Read,
 * compose, send, and permanently delete all your email". We ask for it because
 * a working set that is invisible in the inbox list is not a working set: the
 * whole value is seeing the tag while you scan. See docs/ADDON_SCOPES.md for
 * what that costs and why the in-panel version was not enough.
 *
 * Everything here is bounded by two rules:
 *
 *   1. Only labels under the `InboxPulse ⚡/` prefix are ever created, added or
 *      removed. A bug in this file must not be able to touch a label the user
 *      made, or the analysis labels under `InboxPulse/`.
 *   2. Every write is reversible by the same code path that made it. Removal is
 *      not a separate feature to build later — an instant label that cannot be
 *      taken off is exactly the accretion the expiry exists to prevent.
 */

/**
 * Raised when Gmail refuses for want of a scope rather than failing.
 *
 * Distinct from a null return so the caller can say "this install cannot do
 * that" instead of "that did nothing", which are different sentences to a user
 * and only one of them is true.
 */
export class MissingScopeError extends Error {
  constructor() {
    super('This install does not have permission to change labels');
    this.name = 'MissingScopeError';
  }
}

const GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me';

async function gapi(
  path: string,
  token: string,
  init?: RequestInit,
): Promise<Record<string, unknown> | null> {
  const controller = new AbortController();
  // Bounded like every other outbound call in a render path: a slow Gmail must
  // cost the user a missing tag, not a hung panel.
  const timer = setTimeout(() => controller.abort(), 4000);
  try {
    const res = await fetch(`${GMAIL}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        ...(init?.headers ?? {}),
      },
    });
    if (!res.ok) {
      const detail = await res.text().then((t) => t.slice(0, 180)).catch(() => '');
      logger.warn({ status: res.status, path, detail }, 'gmail label call non-OK');
      // A missing scope is not a failure to fix, it is a fact to report.
      //
      // The reduced-scope install (deployment.live.json, for people who should
      // not be asked for gmail.modify) can render these buttons and cannot
      // perform them. Collapsing that into null made "Clear all my marks"
      // answer "0 marks cleared" — indistinguishable from a clean mailbox, and
      // the reader concludes the feature works and they had nothing to clear.
      if (res.status === 401 || res.status === 403) throw new MissingScopeError();
      return null;
    }
    return (await res.json()) as Record<string, unknown>;
  } catch (err) {
    logger.warn({ err: String(err), path }, 'gmail label call failed');
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The Gmail id for one of our labels, creating it on first use.
 *
 * Created with `labelListVisibility: labelShow` and `messageListVisibility:
 * show` because the entire point is that it appears in the inbox list. A label
 * that exists but is hidden would be the in-panel version with extra steps.
 */
export async function ensureLabel(label: InstantLabel, token: string): Promise<string | null> {
  const list = await gapi('/labels', token);
  const existing = (list?.labels as Array<{ id: string; name: string }> | undefined)?.find(
    (l) => l.name === label.name,
  );
  if (existing) return existing.id;

  const created = await gapi('/labels', token, {
    method: 'POST',
    body: JSON.stringify({
      name: label.name,
      labelListVisibility: 'labelShow',
      messageListVisibility: 'show',
      color: { backgroundColor: label.bg, textColor: label.text },
    }),
  });
  const id = created?.id as string | undefined;
  if (!id) logger.warn({ name: label.name }, 'could not create instant label');
  return id ?? null;
}


/**
 * Does a label with this exact name exist in the mailbox?
 *
 * Used for the consent record (services/consent.ts), where the EXISTENCE of a
 * label is the state — it is never attached to a thread. Reads rather than
 * creates, so asking the question can never answer it by accident.
 *
 * Returns false when Gmail refuses. On the reduced-scope install this call has
 * no permission, and false means "not consented", which is the safe direction:
 * the panel reads nothing rather than assuming yes.
 */
export async function labelExists(name: string, token: string): Promise<boolean> {
  const list = await gapi('/labels', token);
  const labels = list?.labels as Array<{ name: string }> | undefined;
  return Boolean(labels?.some((l) => l.name === name));
}

/** Put the label on the thread. */
export async function addLabel(threadId: string, labelId: string, token: string): Promise<boolean> {
  const r = await gapi(`/threads/${threadId}/modify`, token, {
    method: 'POST',
    body: JSON.stringify({ addLabelIds: [labelId] }),
  });
  return r !== null;
}

/**
 * Take it off.
 *
 * Removes from the THREAD, matching how it was applied. Applying to a thread
 * and removing per message would leave stragglers on any message that arrived
 * in between, which is how a label nobody can get rid of comes about.
 */
export async function removeLabel(
  threadId: string,
  labelId: string,
  token: string,
): Promise<boolean> {
  const r = await gapi(`/threads/${threadId}/modify`, token, {
    method: 'POST',
    body: JSON.stringify({ removeLabelIds: [labelId] }),
  });
  return r !== null;
}

/**
 * Which of our labels are on this thread, according to GMAIL.
 *
 * Gmail is the truth, not our in-memory state. The state lives in a process
 * that Cloud Run scales to zero, so it is forgotten routinely rather than
 * exceptionally — and a toggle that consults a forgotten memory re-applies a
 * label that is already there, tells the user "clears in 30 min", and changes
 * nothing they can see. That is exactly what happened.
 *
 * So on/off is decided by asking Gmail. Memory is only good for WHEN something
 * expires, which Gmail cannot tell us.
 */
export async function labelsOnThread(
  threadId: string,
  token: string,
): Promise<Set<string>> {
  const t = await gapi(`/threads/${threadId}?format=minimal`, token);
  const messages = (t?.messages as Array<{ labelIds?: string[] }> | undefined) ?? [];
  const ids = new Set<string>();
  for (const m of messages) for (const id of m.labelIds ?? []) ids.add(id);
  return ids;
}

export interface ThreadSummary {
  id: string;
  subject: string;
  from: string;
  /** Gmail's own snippet — enough text to classify without fetching bodies. */
  snippet: string;
  /** Epoch ms of the latest message, for tie-breaking by age. */
  at: number;
}

/**
 * Recent threads, for marking without opening each one.
 *
 * Gmail add-ons cannot see what you have SELECTED in the inbox list. There are
 * exactly two Gmail triggers — compose, and contextual (a message is open) —
 * and neither carries a selection. The checkbox column is not addressable by an
 * add-on at all, so "press Focus on the row I ticked" is not a thing that can
 * be built, however the panel is arranged.
 *
 * What can be done is the other way round: let the PANEL list threads and mark
 * them from there. The user never opens the conversation, which is most of what
 * they wanted from the row-level button.
 *
 * Capped hard. Bulk labelling is precisely the failure the whole labels policy
 * exists to prevent, and a list long enough to need scrolling is a list long
 * enough to mark something by accident.
 */
export async function recentThreads(
  token: string,
  query: string,
  max = 8,
): Promise<ThreadSummary[]> {
  const list = await gapi(
    `/threads?maxResults=${max}&q=${encodeURIComponent(query)}`,
    token,
  );
  const ids = ((list?.threads as Array<{ id: string }> | undefined) ?? []).map((t) => t.id);
  const out: ThreadSummary[] = [];
  for (const id of ids) {
    const t = await gapi(`/threads/${id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From`, token);
    const msgs = (t?.messages as Array<{ payload?: { headers?: Array<{ name: string; value: string }> } }>) ?? [];
    const headers = msgs[msgs.length - 1]?.payload?.headers ?? [];
    const pick = (n: string) => headers.find((h) => h.name.toLowerCase() === n)?.value ?? '';
    // Snippets rather than bodies: classification needs the gist, and fetching
    // full bodies for a dozen threads would make the button feel like a report.
    const snippet = msgs.map((m) => (m as { snippet?: string }).snippet ?? '').join(' ').slice(0, 600);
    const at = Number((msgs[msgs.length - 1] as { internalDate?: string })?.internalDate ?? 0);
    out.push({ id, subject: pick('subject') || '(no subject)', from: pick('from'), snippet, at });
  }
  return out;
}

/**
 * Remove one of our labels from every thread carrying it.
 *
 * The reliable removal path, and the reason it exists is worth stating: the
 * timed expiry depends on a process staying alive to remember WHEN each mark
 * was made, and that process does not survive a deploy or a restart. Marks made
 * before one are orphaned — the label sits in the mailbox with nothing left
 * that knows it should come off.
 *
 * This needs no memory at all. It asks Gmail which threads carry the label and
 * takes it off all of them, so it works regardless of what the process
 * remembers, or whether it is even the same process.
 *
 * A blunt instrument on purpose: it clears marks that have not expired yet. That
 * is the correct trade for a fallback — a working set the user cannot reliably
 * empty is worse than one they occasionally empty early.
 */
export async function clearAllOfLabel(
  label: InstantLabel,
  token: string,
): Promise<number> {
  const labelId = await ensureLabel(label, token);
  if (!labelId) return 0;

  // Query by labelIds, NOT by a `label:"..."` search string.
  //
  // Gmail's search syntax does not reliably match a label whose name contains a
  // non-ASCII character and spaces — `label:"⚡/Waiting on you"` returned
  // nothing, so the sweep detached nothing while cheerfully reporting success.
  // The label id is exact and involves no query parsing at all.
  const list = await gapi(`/threads?maxResults=100&labelIds=${encodeURIComponent(labelId)}`, token);
  const ids = ((list?.threads as Array<{ id: string }> | undefined) ?? []).map((t) => t.id);
  let n = 0;
  for (const id of ids) {
    if (await removeLabel(id, labelId, token)) n += 1;
  }
  return n;
}

/**
 * Delete a label outright, rather than detaching it from threads.
 *
 * `clearAllOfLabel` takes a label OFF messages but leaves the definition in the
 * sidebar. That is right for a label still in use and wrong for one that should
 * not exist — renaming the prefix from `InboxPulse ⚡/` to `⚡/` created a second
 * set beside the first, so the user ended up with sixteen labels where eight
 * were intended, half of them permanently empty.
 *
 * Deleting also detaches: Gmail removes a deleted label from every thread that
 * carried it, so this is strictly more thorough than the sweep.
 */
export async function deleteLabelByName(name: string, token: string): Promise<boolean> {
  const list = await gapi('/labels', token);
  const found = (list?.labels as Array<{ id: string; name: string }> | undefined)?.find(
    (l) => l.name === name,
  );
  if (!found) return false;
  const res = await gapi(`/labels/${found.id}`, token, { method: 'DELETE' });
  // Gmail returns an empty body on a successful delete, which `gapi` turns into
  // a JSON parse failure and therefore null. Re-list to confirm rather than
  // trusting the return value.
  const after = await gapi('/labels', token);
  const still = (after?.labels as Array<{ name: string }> | undefined)?.some((l) => l.name === name);
  return !still;
}
