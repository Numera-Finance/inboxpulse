/**
 * Instant labels — a working set the user turns on, that turns itself off.
 *
 * LIVES IN THE PANEL, NOT THE MAILBOX.
 *
 * Putting a real Gmail label on a thread needs `users.threads.modify`, which
 * needs `gmail.modify` — a RESTRICTED scope whose consent screen reads "Read,
 * compose, send, and permanently delete all your email". Asking every user to
 * approve that, at install, for a coloured tag that disappears in thirty
 * minutes, trades the one constraint that decides whether anyone adopts this at
 * all. See docs/ADDON_SCOPES.md.
 *
 * So the working set is held here and rendered in the panel's homepage. The
 * user marks a thread, and every thread they have marked is one click away,
 * with the time remaining. What is lost is visibility in the inbox LIST, which
 * is real — but the discipline of a self-expiring working set survives, and it
 * survives without asking anyone for their whole mailbox.
 *
 * Every other label in this codebase is a CLAIM ABOUT THE MESSAGE: this is
 * churn risk, this is an upsell. Those can be wrong, and today's audit showed
 * how wrong — 32,241 "Churn risk" labels where 4,015 qualified. The whole
 * policy in ./policy.ts exists to stop a classifier writing noise into an inbox.
 *
 * These are the opposite kind. They are a statement about the USER'S SESSION:
 * what am I doing in the next half hour. "Focus" is not a claim that the thread
 * is important; it is the user saying they intend to work these next. A label
 * the user chose cannot be a false positive, which removes the precision
 * problem entirely rather than managing it.
 *
 * WHY THEY EXPIRE
 *
 * The failure mode of every manual labelling system is accretion: labels get
 * applied, never removed, and six weeks later "Focus" has 400 threads in it and
 * means nothing. Superhuman's users work around this by creating splits they
 * intend to keep "for a week or two" and then living with them forever.
 *
 * Expiry inverts the default. A working set is worthless the moment it stops
 * describing what you are actually doing, so the label removes itself after
 * thirty minutes unless the user turns it off sooner. The mailbox cannot
 * accumulate cruft because nothing persists long enough to accumulate.
 *
 * Thirty minutes is a working block, not a guess: long enough to clear a batch,
 * short enough that a forgotten label is gone before it misleads.
 */

/** How long an instant label lives before it removes itself. */
export const INSTANT_TTL_MS = 30 * 60 * 1000;

export interface InstantLabel {
  key: string;
  /** Full Gmail label name. Distinct prefix so a sweep can never touch the analysis labels. */
  name: string;
  /** What the user means by turning it on — shown on the button. */
  means: string;
  bg: string;
  text: string;
}

const NS = 'InboxPulse ⚡';

/**
 * Four, and four is the point.
 *
 * These are the states a thread can be in relative to the user's attention, not
 * categories of email. A longer list would be a taxonomy, and a taxonomy is
 * something you maintain rather than something you use — at which point it has
 * become the filing system this is meant to replace.
 */
export const INSTANT_LABELS: InstantLabel[] = [
  {
    key: 'focus',
    name: `${NS}/Focus`,
    means: 'Working these next',
    bg: '#fb4c2f',
    text: '#ffffff',
  },
  {
    key: 'research',
    name: `${NS}/Research`,
    means: 'Needs digging, not now',
    bg: '#a479e2',
    text: '#ffffff',
  },
  {
    key: 'blocktime',
    name: `${NS}/Block time`,
    means: 'Needs a calendar slot',
    bg: '#16a765',
    text: '#ffffff',
  },
  {
    key: 'waiting',
    name: `${NS}/Waiting on`,
    means: 'Blocked on someone else',
    bg: '#ffad47',
    text: '#ffffff',
  },
];

export function instantLabelByKey(key: string): InstantLabel | null {
  return INSTANT_LABELS.find((l) => l.key === key) ?? null;
}

/** Only these are ever swept. The analysis labels use `InboxPulse/` and are untouched. */
export function isInstantLabelName(name: string): boolean {
  return name.startsWith(`${NS}/`);
}

export interface InstantApplication {
  labelKey: string;
  threadId: string;
  /** Epoch ms when this should be removed. */
  expiresAt: number;
}

/**
 * State for one user's instant labels.
 *
 * IN MEMORY, WHICH IS A REAL LIMITATION, NOT A DESIGN FLOURISH.
 *
 * The expiry promise — "clears in 30 minutes" — is only kept while the process
 * that made it is alive. Cloud Run scales to zero after roughly fifteen minutes
 * idle, which is INSIDE the thirty-minute window, so an instance can and will
 * die holding live labels. When it does, nothing knows those labels should come
 * off and they stay in Gmail until the user removes them by hand.
 *
 * Two things reduce it and neither eliminates it:
 *
 *   - `min-instances 1` keeps the process alive, so the state survives normal
 *     use. It does not survive a deploy, a crash, or a region restart.
 *   - The sweep runs on every thread open, not just on a label press, so an
 *     active user reliably triggers it.
 *
 * The real fix is durable expiry — a row per mark, swept by a job that holds
 * its own credential. That needs both a schema change and a stored refresh
 * token, and neither exists yet. Until then, treat the thirty minutes as a
 * strong default rather than a guarantee, and keep the manual toggle
 * prominent — it is the only removal path that cannot fail.
 */
export class InstantLabelState {
  private readonly live = new Map<string, InstantApplication>();

  constructor(private readonly now: () => number = Date.now) {}

  private id(threadId: string, labelKey: string): string {
    return `${threadId}|${labelKey}`;
  }

  /** Turn on, or extend if already on. Returns the application to write. */
  turnOn(threadId: string, labelKey: string): InstantApplication {
    const app: InstantApplication = {
      threadId,
      labelKey,
      expiresAt: this.now() + INSTANT_TTL_MS,
    };
    this.live.set(this.id(threadId, labelKey), app);
    return app;
  }

  /** Turn off now. Returns true if it was on. */
  turnOff(threadId: string, labelKey: string): boolean {
    return this.live.delete(this.id(threadId, labelKey));
  }

  isOn(threadId: string, labelKey: string): boolean {
    const app = this.live.get(this.id(threadId, labelKey));
    if (!app) return false;
    if (app.expiresAt <= this.now()) {
      this.live.delete(this.id(threadId, labelKey));
      return false;
    }
    return true;
  }

  /** Minutes left, for showing on the button. Null when not on. */
  minutesLeft(threadId: string, labelKey: string): number | null {
    const app = this.live.get(this.id(threadId, labelKey));
    if (!app) return null;
    const left = app.expiresAt - this.now();
    return left > 0 ? Math.ceil(left / 60_000) : null;
  }

  /**
   * Everything that has expired and should be removed from Gmail.
   *
   * Swept lazily, on every panel open, because there is no cron. That is a real
   * limitation: a label expires on schedule only if the user opens the panel
   * again afterwards. It is also the least bad version of it — the moment a
   * user is not opening their mail panel is precisely the moment a stale
   * working-set label costs them nothing.
   */
  takeExpired(): InstantApplication[] {
    const out: InstantApplication[] = [];
    for (const [id, app] of this.live) {
      if (app.expiresAt <= this.now()) {
        out.push(app);
        this.live.delete(id);
      }
    }
    return out;
  }

  /** Everything currently on, for rendering state. */
  active(): InstantApplication[] {
    this.takeExpired();
    return [...this.live.values()];
  }
}

/**
 * A link back to the thread in Gmail.
 *
 * This is what makes an in-panel working set usable at all. Without it the
 * homepage would be a list of subjects the user then has to go and find, which
 * is worse than no list — the point of a working set is that the next thread is
 * one click away.
 */
export function gmailThreadUrl(threadId: string, viewerEmail?: string): string {
  const auth = viewerEmail ? `?authuser=${encodeURIComponent(viewerEmail)}` : '';
  return `https://mail.google.com/mail/u/0/${auth}#all/${threadId}`;
}

export interface WorkingSetEntry {
  label: InstantLabel;
  threadId: string;
  subject: string;
  minutesLeft: number;
}

/**
 * Thread subjects, remembered only for as long as a label is on them.
 *
 * The homepage has no message context — it is opened from the Gmail rail with no
 * thread — so it cannot look a subject up. Storing it alongside the label is the
 * only way the list can say anything more useful than a thread id, and it is
 * discarded on the same schedule as the label itself.
 */
export class WorkingSet {
  private readonly subjects = new Map<string, string>();

  constructor(private readonly state: InstantLabelState) {}

  mark(threadId: string, labelKey: string, subject: string): { on: boolean; minutesLeft: number | null } {
    // Toggle. Pressing the same button again is how a user turns one off before
    // it expires, which has to be the same button or it is not a toggle.
    if (this.state.isOn(threadId, labelKey)) {
      this.state.turnOff(threadId, labelKey);
      if (!this.state.active().some((a) => a.threadId === threadId)) this.subjects.delete(threadId);
      return { on: false, minutesLeft: null };
    }
    this.state.turnOn(threadId, labelKey);
    if (subject.trim()) this.subjects.set(threadId, subject.trim());
    return { on: true, minutesLeft: this.state.minutesLeft(threadId, labelKey) };
  }

  isOn(threadId: string, labelKey: string): boolean {
    return this.state.isOn(threadId, labelKey);
  }

  /** Set on, without toggling — used when Gmail has already decided the state. */
  turnOnFor(threadId: string, labelKey: string, subject: string): void {
    this.state.turnOn(threadId, labelKey);
    if (subject.trim()) this.subjects.set(threadId, subject.trim());
  }

  /** Set off, without toggling. */
  turnOffFor(threadId: string, labelKey: string): void {
    this.state.turnOff(threadId, labelKey);
    if (!this.state.active().some((a) => a.threadId === threadId)) this.subjects.delete(threadId);
  }

  minutesLeftFor(threadId: string, labelKey: string): number | null {
    return this.state.minutesLeft(threadId, labelKey);
  }

  /** Everything still live, ordered by label so the list reads as groups. */
  entries(): WorkingSetEntry[] {
    const out: WorkingSetEntry[] = [];
    for (const a of this.state.active()) {
      const label = instantLabelByKey(a.labelKey);
      const minutesLeft = this.state.minutesLeft(a.threadId, a.labelKey);
      if (!label || minutesLeft === null) continue;
      out.push({
        label,
        threadId: a.threadId,
        subject: this.subjects.get(a.threadId) ?? '(no subject)',
        minutesLeft,
      });
    }
    const order = INSTANT_LABELS.map((l) => l.key);
    return out.sort(
      (x, y) => order.indexOf(x.label.key) - order.indexOf(y.label.key) || x.minutesLeft - y.minutesLeft,
    );
  }

  /** Drop the subjects of anything that has expired, so nothing lingers. */
  prune(): void {
    const liveThreads = new Set(this.state.active().map((a) => a.threadId));
    for (const id of [...this.subjects.keys()]) {
      if (!liveThreads.has(id)) this.subjects.delete(id);
    }
  }
}
