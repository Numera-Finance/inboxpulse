/**
 * The signed-in Gmail address, as InboxSDK reports it.
 *
 * Why this exists: the add-on identifies the viewer from a Google-signed
 * `userIdToken`, which an extension cannot mint. Without an address the
 * homepage card SKIPS `resolveViewer`, and its two entitlement-scoped
 * sections — "Where the fires are" and "Unhappy clients left waiting" — are
 * neither rendered nor reported as unscoped. The panel keeps showing firm-wide
 * numbers beside two silent absences, which reads as "nothing is on fire".
 *
 * So the extension tells the add-on who is looking, and this is where that
 * address lives between InboxSDK's load callback (outside React) and the Panel
 * tab (inside it).
 *
 * NOT an identity claim the add-on may trust — it is honoured only while
 * ADDON_VERIFY_ID_TOKEN is off. See apps/addon/src/auth/verify.ts.
 *
 * Deliberately not React state, for the same reason as lib/thread-store.ts: the
 * publisher is an InboxSDK callback with no way to reach a setState.
 */

let viewerEmail: string | null = null;

export function setViewerEmail(email: string | null): void {
  viewerEmail = email && email.includes('@') ? email : null;
}

export function getViewerEmail(): string | null {
  return viewerEmail;
}
