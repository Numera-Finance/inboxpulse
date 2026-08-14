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
