/**
 * Instant labels — a working set the user turns on, that turns itself off.
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
 * In memory, and that is deliberate rather than lazy: the whole contract is
 * that these do not outlive the session. Persisting them would recreate the
 * accretion problem in a database instead of a mailbox, and a label whose
 * expiry survives a restart is a label that can be forgotten about.
 *
 * The consequence is honest and worth stating: if the process restarts while a
 * label is live, the sweep loses track of it and the label stays in Gmail until
 * the user removes it. That is a real gap, and the reason `sweepAll` also
 * accepts labels discovered in the mailbox rather than only ones it remembers.
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
