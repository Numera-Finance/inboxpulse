import { ensureLabel, deleteLabelByName, labelExists } from '../gmail/labels';
import type { InstantLabel } from './instant-labels';

/**
 * Whether this viewer has agreed to have the open thread read.
 *
 * The panel used to send the open thread to a model the instant it rendered.
 * Nobody was asked. For most users that is invisible; for one who has said he
 * is sensitive about his mail being read, it is the whole question, and a
 * privacy claim printed on a card that reads first and explains afterwards is
 * not a claim, it is a caption.
 *
 * So reading is OFF until the viewer turns it on, and the card says what will
 * happen before it happens.
 *
 * ---------------------------------------------------------------------------
 * THE CONSENT RECORD IS A LABEL IN THE USER'S OWN MAILBOX
 * ---------------------------------------------------------------------------
 *
 * This was a Map in process memory, and that quietly broke the promise the card
 * makes. Cloud Run runs up to ten instances, each with its own Map: "Stop
 * reading my mail" cleared the instance that served the click, and the next
 * thread could route to an instance that still held the grant — and read it.
 * Pinning the service to one instance would have hidden the bug behind a
 * deployment flag that anyone could change without knowing what it was load
 * bearing for.
 *
 * The state now lives where it belongs: a label named `⚡/Reading on` in the
 * person's own mailbox. Its mere existence IS the consent — no thread carries
 * it, it is never attached to mail.
 *
 * That choice does several things at once, which is why it wins over a row in
 * our database:
 *
 *   INSTANCE-INDEPENDENT. Any instance can ask Gmail, so ten of them agree.
 *   VISIBLE. It appears in his label list. He can see the switch is on without
 *     taking our word for it, which no server-side record can offer.
 *   REMOVABLE BY HIM. Deleting the label in Gmail turns reading off, whether or
 *     not our panel is working, whether or not we cooperate. A preference about
 *     being read should be revocable without asking the people doing the
 *     reading.
 *   NOT OURS TO KEEP. It is in his mailbox, not our database. Nothing about his
 *     preferences accumulates on our side for an admin to browse.
 *
 * The cost is honest: it needs `gmail.modify`, which the reduced-scope install
 * does not have. There, `hasConsent` returns false and stays false — reading
 * simply never happens, which is the safe direction.
 *
 * And it costs one `labels.list` call per render. That is the price of the
 * switch being true from any instance, and it is not cached: a cache is exactly
 * how the per-process Map went wrong.
 */

/** The label whose existence means "you may read my open thread". */
export const CONSENT_LABEL: InstantLabel = {
  key: 'reading-on',
  name: '⚡/Reading on',
  means: 'InboxPulse may read the thread you have open',
  // Grey rather than a signal color: this is a state, not a thing to act on.
  bg: '#c2c2c2',
  text: '#ffffff',
};

export async function hasConsent(token: string | undefined): Promise<boolean> {
  if (!token) return false;
  return labelExists(CONSENT_LABEL.name, token);
}

export async function grantConsent(token: string | undefined): Promise<boolean> {
  if (!token) return false;
  return (await ensureLabel(CONSENT_LABEL, token)) !== null;
}

/**
 * Deleting the label is what turns reading off.
 *
 * Deliberately the same operation the user can perform by hand in Gmail, so the
 * button and the manual route cannot diverge — there is no second switch of
 * ours that could stay on after he has turned his off.
 */
export async function revokeConsent(token: string | undefined): Promise<boolean> {
  if (!token) return false;
  return deleteLabelByName(CONSENT_LABEL.name, token);
}
