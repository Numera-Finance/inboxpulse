/**
 * Removes the "x" (remove-label) control from protected Gmail label chips in
 * the thread view, so an analysis tag can be re-suggested but never deleted.
 *
 * Protected: `Inbox` (removing it archives the thread) and everything under the
 * `InboxPulse/` namespace (the analysis tags). Every other label a user has —
 * `External`, their own folders — keeps its "x"; managing those is none of our
 * business.
 *
 * ── Why this is written defensively ────────────────────────────────────────
 * Gmail's chip markup is obfuscated and unversioned: class names like `.ar.as`
 * rotate without notice, and InboxSDK exposes no API for these chips. So this
 * module never matches on a Gmail class name. It identifies a chip by the label
 * NAME Gmail puts in `data-tooltip` / `title` / `aria-label`, and works in two
 * independent layers:
 *
 *   1. Hide  — find the remove control inside a protected chip and display:none it.
 *   2. Block — a capture-phase click/keydown guard that swallows the event even
 *              if layer 1 failed to find the control.
 *
 * Layer 2 is the guarantee; layer 1 is the cosmetics. If Gmail reshuffles its
 * DOM, the worst case is a visible "x" that does nothing, not a deleted label.
 *
 * Scope is limited to the subject-line region of the open thread, so the
 * left-hand nav's own "Inbox" entry is never touched.
 */

/** Prefix for the diagnostic logs, so a user can report what was matched. */
const LOG = '[InboxPulse labels]';

/** Attributes Gmail uses to carry a chip's full label name. */
const NAME_ATTRS = ['data-tooltip', 'title', 'aria-label'] as const;

/** Marks a control we've already neutralized, so re-scans are cheap. */
const HANDLED = 'data-inboxpulse-label-guard';

/** Labels whose remove control is suppressed. */
export function isProtectedLabel(name: string): boolean {
  const n = name.trim().toLowerCase();
  return n === 'inbox' || n.startsWith('inboxpulse/');
}

/**
 * The label name a chip element advertises.
 *
 * Text first, attributes second. An earlier version matched only on
 * `data-tooltip`/`title`/`aria-label` — a guess about Gmail's markup that turned
 * out to be wrong, so nothing was ever detected and the "x" stayed live. The
 * chip's visible text is the one thing we can rely on being present.
 *
 * Exact match only: a container whose text is "Inbox" is a chip, whereas one
 * whose text merely contains "Inbox" is some ancestor holding half the page.
 */
function chipName(el: Element): string | null {
  const text = (el.textContent ?? '').trim();
  if (text && text.length <= 64 && isProtectedLabel(text)) return text;

  for (const attr of NAME_ATTRS) {
    const v = el.getAttribute(attr);
    if (v && v.trim()) return v.trim();
  }
  return null;
}

/**
 * The nearest ancestor chip of `el` that names a protected label.
 * Bounded climb — chips are shallow, and an unbounded walk would eventually
 * match any ancestor that happens to be titled "Inbox".
 */
function protectedChipFor(el: Element | null): { chip: HTMLElement; name: string } | null {
  let node: Element | null = el;
  for (let depth = 0; node && depth < 6; depth++, node = node.parentElement) {
    if (node.closest('[role="navigation"]')) return null; // left nav, not a chip
    const name = chipName(node);
    if (name && isProtectedLabel(name)) return { chip: node as HTMLElement, name };
  }
  return null;
}

/**
 * Whether `el` looks like the chip's remove affordance rather than its text.
 * Explicit "remove" wording first; otherwise a childless, textless clickable
 * node — which is how Gmail draws the sprite-based x.
 */
function looksLikeRemoveControl(el: Element, chip: Element): boolean {
  if (el === chip) return false;

  const hint = NAME_ATTRS.map((a) => el.getAttribute(a) ?? '')
    .join(' ')
    .toLowerCase();
  if (hint.includes('remove') || hint.includes('delete')) return true;

  // Anything inside a protected chip that carries no text is the "x" (Gmail
  // draws it as a sprite on an empty node). Deliberately broader than
  // "looks clickable" — the first version required role=button/jsaction/img and
  // matched nothing, which let a real removal through. The cost of being broad
  // is that clicking a chip's empty padding no longer navigates to that label;
  // that is a far better failure than losing a thread from the inbox.
  return (el.textContent ?? '').trim().length === 0;
}

/** Hide every remove control inside one protected chip. Returns how many. */
function neutralizeChip(chip: HTMLElement, name: string): number {
  let hidden = 0;
  for (const el of Array.from(chip.querySelectorAll<HTMLElement>('*'))) {
    if (el.hasAttribute(HANDLED)) continue;
    if (!looksLikeRemoveControl(el, chip)) continue;
    el.setAttribute(HANDLED, '1');
    el.style.setProperty('display', 'none', 'important');
    hidden++;
  }
  if (hidden > 0) console.log(`${LOG} hid ${hidden} remove control(s) on "${name}"`);
  return hidden;
}

/**
 * The region holding the open thread's label chips: the subject heading's
 * neighbourhood. Returns null before the thread has rendered.
 */
function subjectRegion(subject: string): HTMLElement | null {
  const heading = Array.from(document.querySelectorAll('h2')).find(
    (h) => (h.textContent ?? '').trim() === subject.trim()
  );
  if (!heading) return null;
  // Climb a few levels so the chips (siblings of the heading's wrapper) are in
  // scope, while staying well inside the conversation container.
  let scope: HTMLElement = heading;
  for (let i = 0; i < 3 && scope.parentElement; i++) scope = scope.parentElement;
  return scope;
}

/**
 * Hide the remove control on every protected chip in the thread header.
 * Returns the number of controls hidden.
 *
 * `report` emits a one-line diagnostic even when nothing matched — silence was
 * what made the first version impossible to debug from a user's console.
 */
export function guardLabelChips(subject: string, report = false): number {
  const scope = subjectRegion(subject);
  if (!scope) {
    if (report) console.log(`${LOG} no subject region found for "${subject}" — chips not scanned`);
    return 0;
  }

  let chips = 0;
  let total = 0;
  // Scope is the subject's immediate neighbourhood, so a full walk is cheap.
  for (const el of Array.from(scope.querySelectorAll<HTMLElement>('*'))) {
    if (el.closest('[role="navigation"]')) continue;
    if (el.tagName === 'A') continue; // nav entries are links; thread chips aren't
    const name = chipName(el);
    if (!name || !isProtectedLabel(name)) continue;
    // Innermost match wins: skip a wrapper whose only protected content is a
    // nested chip we're about to handle anyway.
    if (el.querySelector('*') && chipName(el.firstElementChild ?? el) === name && el.children.length === 1) {
      continue;
    }
    chips++;
    total += neutralizeChip(el, name);
  }

  if (report) {
    console.log(
      `${LOG} scanned "${subject}": ${chips} protected chip(s), ${total} remove control(s) hidden` +
        (chips > 0 && total === 0
          ? ' — chips found but no remove control matched; the click guard is still active'
          : '')
    );
  }
  return total;
}

/**
 * Capture-phase guard: swallow any interaction with a remove control on a
 * protected chip. Installed once for the page; independent of the hiding pass,
 * so a chip whose control we failed to find still can't be removed.
 *
 * Returns a disposer, and callers MUST keep it. This listener calls
 * `stopImmediatePropagation()` on document-level capture, which means it can
 * cancel Gmail's own handlers — that is the whole mechanism. A content script
 * outlives its extension context (see lib/runtime-guard.ts), so without a way
 * to remove these listeners a reloaded extension leaves a dead script still
 * intercepting clicks in Gmail for as long as the tab stays open. Guarding a
 * label is only worth doing while we are alive to do anything about it.
 */
export function installLabelClickGuard(): () => void {
  const handler = (event: Event): void => {
    const target = event.target;
    if (!(target instanceof Element)) return;

    const match = protectedChipFor(target);
    if (!match) return;
    if (!looksLikeRemoveControl(target, match.chip)) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    console.log(`${LOG} blocked removal of "${match.name}"`);
  };

  const keyHandler = (event: KeyboardEvent): void => {
    if (event.key !== 'Enter' && event.key !== ' ' && event.key !== 'Delete') return;
    handler(event);
  };

  // mousedown/mouseup too: Gmail wires some chip controls to those rather than
  // click, and blocking click alone would let the action through.
  const pointerTypes = ['mousedown', 'mouseup', 'click'] as const;
  for (const type of pointerTypes) {
    document.addEventListener(type, handler, true);
  }
  document.addEventListener('keydown', keyHandler, true);

  return () => {
    for (const type of pointerTypes) {
      document.removeEventListener(type, handler, true);
    }
    document.removeEventListener('keydown', keyHandler, true);
    console.log(`${LOG} click guard removed`);
  };
}
