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
