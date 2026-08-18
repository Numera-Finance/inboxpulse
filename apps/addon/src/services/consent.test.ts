import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Consent lives in the user's own mailbox, not in our process.
 *
 * It was a per-process Map, and Cloud Run runs up to ten instances: "Stop
 * reading my mail" cleared the one that served the click, and the next thread
 * could route to an instance that still held the grant — and read it. The card
 * promises the switch is immediate, so that was the promise being false, not a
 * scaling quirk.
 *
 * A label named ⚡/Reading on is instance-independent (any instance asks Gmail),
 * visible to him in his own label list, and removable by him in Gmail whether
 * or not our panel cooperates.
 */
vi.mock('../gmail/labels', () => ({
  labelExists: vi.fn(),
  ensureLabel: vi.fn(),
  deleteLabelByName: vi.fn(),
}));

import { labelExists, ensureLabel, deleteLabelByName } from '../gmail/labels';
import { hasConsent, grantConsent, revokeConsent, CONSENT_LABEL } from './consent';

describe('consent', () => {
  beforeEach(() => vi.clearAllMocks());

  it('is off when the label is absent', async () => {
    vi.mocked(labelExists).mockResolvedValue(false);
    expect(await hasConsent('tok')).toBe(false);
  });

  it('is on when the label is present', async () => {
    vi.mocked(labelExists).mockResolvedValue(true);
    expect(await hasConsent('tok')).toBe(true);
  });

  /** No token means no consent — never the reverse. */
  it('is off without a Gmail token', async () => {
    expect(await hasConsent(undefined)).toBe(false);
    expect(await grantConsent(undefined)).toBe(false);
    expect(await revokeConsent(undefined)).toBe(false);
    expect(labelExists).not.toHaveBeenCalled();
  });

  it('turning it on creates the label', async () => {
    vi.mocked(ensureLabel).mockResolvedValue('Label_1');
    expect(await grantConsent('tok')).toBe(true);
    expect(ensureLabel).toHaveBeenCalledWith(CONSENT_LABEL, 'tok');
  });

  /**
   * Turning it off is the same operation he can perform by hand in Gmail, so
   * the button and the manual route cannot diverge.
   */
  it('turning it off deletes that same label', async () => {
    vi.mocked(deleteLabelByName).mockResolvedValue(true);
    expect(await revokeConsent('tok')).toBe(true);
    expect(deleteLabelByName).toHaveBeenCalledWith(CONSENT_LABEL.name, 'tok');
  });

  /**
   * On the reduced-scope install the labels API is refused. False must mean
   * "not consented" rather than an error the caller might ignore.
   */
  it('stays off when Gmail refuses the call', async () => {
    vi.mocked(labelExists).mockResolvedValue(false);
    expect(await hasConsent('tok-without-modify')).toBe(false);
  });

  it('is never attached to a thread — existence is the whole state', () => {
    expect(CONSENT_LABEL.name).toBe('⚡/Reading on');
  });
});

/**
 * "Clear all my marks" must not silently turn reading back off.
 *
 * That sweep deletes every label in the ⚡/ namespace, and the consent record
 * lives in the same namespace so the user can see it beside the marks. If it
 * were swept too, clearing a cluttered inbox would revoke consent as a side
 * effect and the panel would quietly stop working with no explanation.
 *
 * It is kept out by construction: the sweep iterates INSTANT_LABELS and
 * MODE_LABELS, and CONSENT_LABEL is declared here, in neither list.
 */
describe('consent label is not a mark', () => {
  it('is absent from the lists the clear-marks sweep iterates', async () => {
    const { INSTANT_LABELS, MODE_LABELS } = await import('./instant-labels');
    const swept = [...INSTANT_LABELS, ...MODE_LABELS].map((l) => l.name);
    expect(swept).not.toContain(CONSENT_LABEL.name);
  });
});
