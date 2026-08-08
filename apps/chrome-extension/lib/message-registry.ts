/**
 * Opening one message of the open conversation from the panel.
 *
 * Two problems shape everything here, and both were learned the hard way.
 *
 * **Ids don't travel.** Gmail message ids are per-mailbox: the same email
 * carries a different id in every participant's mailbox, and the CRM stores one
 * row per message bearing the id of whichever mailbox ingested it first. In a
 * thread that reached the CRM through several colleagues, some rows carry ids
 * this reader's Gmail has never heard of. The add-on solved this by reading the
 * stable RFC `Message-ID` from the Gmail API; a content script has no such
 * access. So a message is described — sender, opening text, time — and matched
 * on resemblance when its id doesn't land.
 *
 * **InboxSDK doesn't see every message.** It builds a `MessageView` only for
 * messages Gmail has actually loaded — in a real thread that was two of them,
 * so anything keyed off the view registry could not find the rest. The matching
 * below therefore reads Gmail's own DOM, using the class contract InboxSDK
 * itself depends on:
 *
 *   kQ / kx  HIDDEN inside a super-collapsed run ("N more messages"). Opened by
 *            clicking the run's notice element, which carries `.adx`.
 *   kv / ky  COLLAPSED: a one-line row that opens when clicked.
 *   h7       EXPANDED.
 *
 * The registry is kept as the fast path for the common case where the stored id
 * is this mailbox's, and because the content script already maintains it.
 */
export interface RegisteredMessage {
  getElement(): HTMLElement;
  getViewState(): 'HIDDEN' | 'COLLAPSED' | 'EXPANDED';
}

/** How the panel names a message it wants opened. */
export interface MessageDescriptor {
  /** Provider id as stored. Correct whenever the row came from this mailbox. */
  messageId: string;
  fromEmail?: string | null;
  /** ISO timestamp as stored. */
  receivedAt?: string | null;
  /** How the message text begins, for telling two messages from one sender apart. */
  snippet?: string | null;
}

const messages = new Map<string, RegisteredMessage>();

/** Every message row Gmail has put in the thread pane, in any of its states. */
const ROW_SELECTOR = '.kv, .ky, .h7, .kQ, .kx';

const FLASH_MS = 1_600;
const POLL_MS = 100;
/** How long to wait for rows to appear after opening a super-collapsed run. */
const LOAD_TIMEOUT_MS = 6_000;
/** How long one click attempt gets before the next is tried. */
const EXPAND_TIMEOUT_MS = 1_500;

export function registerMessage(id: string, view: RegisteredMessage): void {
  messages.set(id, view);
}

export function forgetMessage(id: string): void {
  messages.delete(id);
}

/** Drop the whole map when the reader leaves the conversation. */
export function clearMessages(): void {
  messages.clear();
}

/**
 * Open the message and scroll to it. Returns whether it was found at all.
 */
export async function revealMessage(target: MessageDescriptor): Promise<boolean> {
  let row = fromRegistry(target.messageId) ?? findRow(target);

  // Not on screen yet. Messages inside a super-collapsed run don't exist as
  // rows until the run is opened, and Gmail fetches them over the network when
  // it is — so open every run and then wait for the rows to arrive.
  if (!row) {
    if (openSuperCollapsedRuns()) {
      row = await waitFor(() => findRow(target), LOAD_TIMEOUT_MS);
    }
  }

  if (!row) {
    reportMiss(target);
    return false;
  }

  await open(row, target);
  return true;
}

async function open(row: HTMLElement, target: MessageDescriptor): Promise<void> {
  try {
    // Hidden rows have no clickable header of their own until their run opens.
    if (isHidden(row)) {
      openSuperCollapsedRuns();
      const reloaded = await waitFor(
        () => {
          const found = findRow(target);
          return found && !isHidden(found) ? found : null;
        },
        LOAD_TIMEOUT_MS,
      );
      if (reloaded) row = reloaded;
    }

    // One candidate at a time, each given long enough to answer.
    //
    // Gmail sets `h7` a beat after the click, and treating that lag as failure
    // meant clicking a second target on a message that was already opening —
    // which closed it again, so the thread unfolded with nothing open in it.
    for (const targetElement of clickTargets(row)) {
      if (isExpanded(row)) break;
      pressOn(targetElement);
      const opened = await waitFor(
        () => {
          // Gmail may swap the node out as it expands, so re-find rather than
          // trusting the reference we clicked.
          const current = findRow(target) ?? row;
          return isExpanded(current) ? current : null;
        },
        EXPAND_TIMEOUT_MS,
      );
      if (opened) {
        row = opened;
        break;
      }
    }

    if (!isExpanded(row)) {
      console.warn(
        `[InboxPulse] found message ${target.messageId} but could not open it.`,
        '\nrow:',
        row.className,
        '\ninside:',
        describe(row),
      );
    }

    // After the expand, never before: opening a message changes the height of
    // everything below it, so a scroll computed first lands in the wrong place.
    anchor(row);
    flash(row);
  } catch (err) {
    console.warn('[InboxPulse] revealing a message failed:', err);
  }
}

function fromRegistry(id: string): HTMLElement | null {
  const view = messages.get(id);
  if (!view) return null;
  const element = elementOf(view);
  return element?.isConnected ? element : null;
}

/**
 * Find the reader's copy of a message among the rows Gmail has rendered.
 *
 * Three keys, narrowest first, because no single one is sufficient:
 *
 *   sender  Cuts the thread down to one participant, and is exact. Rarely
 *           enough alone — people send several messages to a thread.
 *   text    How the message begins. Separates two messages from one sender, and
 *           compares like with like: Gmail's row preview and our stored preview
 *           are both the start of the same body.
 *   time    Last, and only within five minutes. Gmail renders localized dates of
 *           varying precision, so this settles a tie rather than deciding one.
 */
function findRow(target: MessageDescriptor): HTMLElement | null {
  const rows = [...document.querySelectorAll<HTMLElement>(ROW_SELECTOR)];
  if (rows.length === 0) return null;

  let pool = rows;

  if (target.fromEmail) {
    const wanted = target.fromEmail.toLowerCase();
    const bySender = pool.filter((row) => rowSender(row) === wanted);
    if (bySender.length === 1) return bySender[0]!;
    if (bySender.length > 1) pool = bySender;
  }

  if (target.snippet) {
    const wanted = normalize(target.snippet);
    const best = pool
      .map((row) => ({ row, score: textScore(rowText(row), wanted) }))
      .sort((a, b) => b.score - a.score)[0];
    if (best && best.score >= 0.6) return best.row;
  }

  if (target.receivedAt) {
    const wanted = Date.parse(target.receivedAt);
    if (!Number.isNaN(wanted)) {
      const best = pool
        .map((row) => ({ row, gap: Math.abs((rowDate(row) ?? Infinity) - wanted) }))
        .sort((a, b) => a.gap - b.gap)[0];
      if (best && best.gap <= 5 * 60 * 1000) return best.row;
    }
  }

  // Narrowing by sender left exactly one candidate — that is still an answer.
  return pool.length === 1 && pool !== rows ? pool[0]! : null;
}

/**
 * Open every "N more messages" run in the thread.
 *
 * Blunt on purpose: this runs only when the reader has asked for a message that
 * isn't reachable, and opening a run is what they'd do by hand to find it.
 */
function openSuperCollapsedRuns(): boolean {
  const notices = document.querySelectorAll<HTMLElement>('.adx');
  if (notices.length === 0) return false;
  notices.forEach((notice) => pressOn(notice));
  return true;
}

/**
 * The elements worth clicking to open a collapsed row, best first.
 *
 * The preview text comes first deliberately. It is the biggest inert target in
 * the row — clicking it can only mean "open this" — whereas the cells around it
 * carry the star, the reply arrow and the overflow menu, and the sender name
 * opens a contact card rather than the message.
 *
 * The fourth entry is not a selector: whichever descendant holds the most text
 * of its own, which is the preview line under whatever class Gmail uses next.
 */
function clickTargets(row: HTMLElement): HTMLElement[] {
  const candidates = [
    row.querySelector<HTMLElement>('span.y2'),
    row.querySelector<HTMLElement>('td.gF'),
    row.querySelector<HTMLElement>('.gE.iv.gt'),
    bestTextTarget(row),
    row.firstElementChild as HTMLElement | null,
    row,
  ];
  return candidates.filter(
    (el, index): el is HTMLElement =>
      !!el && el.isConnected && candidates.indexOf(el) === index,
  );
}

/**
 * The descendant carrying the most text of its own.
 *
 * "Of its own" — direct text nodes, not `textContent` — is what makes this pick
 * the preview line rather than the container wrapping the whole row. Anything
 * inside a link or a control is skipped: those do something other than open the
 * message.
 */
function bestTextTarget(row: HTMLElement): HTMLElement | null {
  let best: HTMLElement | null = null;
  let bestLength = 15; // Below this it's a date or a name, not a preview.

  for (const candidate of row.querySelectorAll<HTMLElement>('span, div, td')) {
    if (candidate.closest('a, button, [role="button"], [role="menu"]')) continue;
    const ownText = Array.from(candidate.childNodes)
      .filter((node) => node.nodeType === Node.TEXT_NODE)
      .map((node) => node.textContent ?? '')
      .join('')
      .trim();
    if (ownText.length > bestLength) {
      best = candidate;
      bestLength = ownText.length;
    }
  }

  return best;
}

const isExpanded = (row: HTMLElement): boolean => row.classList.contains('h7');
const isHidden = (row: HTMLElement): boolean =>
  row.classList.contains('kQ') || row.classList.contains('kx');

function elementOf(view: RegisteredMessage): HTMLElement | null {
  try {
    return view.getElement();
  } catch {
    return null;
  }
}

/** The sender's address, which Gmail keeps in an attribute on the row. */
function rowSender(row: HTMLElement): string | null {
  return (
    row.querySelector<HTMLElement>('span[email]')?.getAttribute('email')?.toLowerCase() ??
    null
  );
}

/** How the row's message begins: its preview line, or its text if expanded. */
function rowText(row: HTMLElement): string {
  const preview = row.querySelector<HTMLElement>('span.y2')?.textContent;
  return normalize(preview ?? row.textContent ?? '');
}

/**
 * The row's timestamp. Gmail puts a full date in the title of its date cell.
 *
 * Exported because the message picker needs it for the same reason the matching
 * below does. `MessageView.getDateString()` is the *visible* date — "9:14 AM"
 * for today's mail, with no day in it at all — so it cannot be compared against
 * a stored `receivedAt`, and cannot be sorted. The title attribute is the full
 * date behind that rendering, and is the only precise time a content script can
 * read off a message it hasn't opened.
 */
export function readRowTimestamp(row: HTMLElement): number | null {
  return rowDate(row);
}

/** The row's timestamp. Gmail puts a full date in the title of its date cell. */
function rowDate(row: HTMLElement): number | null {
  const title = row.querySelector<HTMLElement>('span[title]')?.getAttribute('title');
  if (!title) return null;
  const parsed = Date.parse(title);
  return Number.isNaN(parsed) ? null : parsed;
}

function normalize(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * How alike two openings are, 0 to 1.
 *
 * Containment first: Gmail's preview is a truncation of the same body, so one
 * usually starts with the other. The stored preview is not identical — quoted
 * history and signatures are stripped out of ours — so a shared prefix is the
 * fallback rather than requiring the strings to agree.
 */
function textScore(rowText: string, wanted: string): number {
  if (!rowText || !wanted) return 0;

  const probe = wanted.slice(0, 25);
  if (probe.length >= 10 && rowText.includes(probe)) return 1;

  let shared = 0;
  const limit = Math.min(rowText.length, wanted.length);
  while (shared < limit && rowText[shared] === wanted[shared]) shared++;
  return shared / Math.max(20, limit);
}

/** Poll a lookup until it returns something, or give up. */
async function waitFor<T>(
  lookup: () => T | null | undefined,
  timeoutMs: number,
): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((resolve) => window.setTimeout(resolve, POLL_MS));
    const found = lookup();
    if (found) return found;
  }
  return null;
}

/**
 * Say what was on screen when a message couldn't be found.
 *
 * Not decoration: every key here is inferred from Gmail's markup, and the only
 * way to see which one stopped agreeing with the stored row is to print both
 * sides side by side.
 */
function reportMiss(target: MessageDescriptor): void {
  const rows = [...document.querySelectorAll<HTMLElement>(ROW_SELECTOR)];
  console.warn(
    `[InboxPulse] could not find message ${target.messageId} in the open conversation.`,
    '\nwanted:',
    {
      from: target.fromEmail,
      at: target.receivedAt,
      text: target.snippet?.slice(0, 60),
    },
    `\nscanned ${rows.length} row(s):`,
    rows.map((row) => ({
      classes: row.className,
      from: rowSender(row),
      at: row.querySelector<HTMLElement>('span[title]')?.getAttribute('title') ?? null,
      text: rowText(row).slice(0, 60),
    })),
  );
}

/**
 * Click the way a person does.
 *
 * `element.click()` dispatches a lone click event. Gmail's row handlers are on
 * mousedown/mouseup, so a bare click is silently ignored — which is exactly what
 * the first attempt at this did.
 */
function pressOn(element: HTMLElement): void {
  // Aimed at the middle of the element. Handlers that hit-test the pointer
  // position — Gmail has them — ignore an event that claims to be at (0, 0).
  const box = element.getBoundingClientRect();
  const init: MouseEventInit = {
    bubbles: true,
    cancelable: true,
    composed: true,
    view: window,
    detail: 1,
    button: 0,
    buttons: 1,
    clientX: box.left + box.width / 2,
    clientY: box.top + box.height / 2,
  };
  element.dispatchEvent(new PointerEvent('pointerdown', init));
  element.dispatchEvent(new MouseEvent('mousedown', init));
  element.dispatchEvent(new PointerEvent('pointerup', { ...init, buttons: 0 }));
  element.dispatchEvent(new MouseEvent('mouseup', { ...init, buttons: 0 }));
  element.dispatchEvent(new MouseEvent('click', { ...init, buttons: 0 }));
}

/** A compact tag.class listing of a row, for when nothing opened it. */
function describe(element: HTMLElement): string {
  return Array.from(element.querySelectorAll<HTMLElement>('*'))
    .slice(0, 24)
    .map((el) => el.tagName.toLowerCase() + (el.className ? `.${el.className}` : ''))
    .join(' | ');
}

/**
 * Scroll the message to the middle and keep it there.
 *
 * Once, then twice more, because Gmail scrolls the thread itself as it finishes
 * loading — newly opened messages settle to the newest one. A single scroll
 * issued before that lands correctly and is then undone half a second later,
 * which is indistinguishable from the jump never having worked.
 */
function anchor(element: HTMLElement): void {
  const scroll = (): void => {
    if (element.isConnected) {
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  };
  scroll();
  window.setTimeout(scroll, 350);
  window.setTimeout(scroll, 900);
}

/**
 * Briefly outline the message that was jumped to.
 *
 * In a long thread the scroll alone is ambiguous — several messages are in view
 * when it settles, and a message that was already expanded doesn't visibly
 * change at all. Inline styles because this is Gmail's DOM, not ours: the
 * panel's stylesheet lives in a shadow root and cannot reach it.
 */
function flash(element: HTMLElement): void {
  const previousOutline = element.style.outline;
  const previousOffset = element.style.outlineOffset;
  const previousRadius = element.style.borderRadius;

  element.style.outline = '2px solid rgba(26, 115, 232, 0.9)';
  element.style.outlineOffset = '2px';
  element.style.borderRadius = '4px';

  window.setTimeout(() => {
    element.style.outline = previousOutline;
    element.style.outlineOffset = previousOffset;
    element.style.borderRadius = previousRadius;
  }, FLASH_MS);
}
