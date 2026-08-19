/**
 * Turn a commitment's free-text date into a real calendar date.
 *
 * Commitments come back as "by Friday", "end of next week", "Nov 3" — the way
 * people actually write them. That is enough for a human reading the thread and
 * not enough to put anything in a calendar, which is the whole point: a reminder
 * on the wrong day is worse than no reminder, because it trains the user to stop
 * believing the ones that fire.
 *
 * So this resolves ONLY the forms it can resolve unambiguously and returns null
 * for everything else. Callers hide the control when it returns null rather than
 * guessing at today. Refusing is a feature here.
 *
 * Deliberately deterministic — no model call. A date is arithmetic, and asking a
 * 12b model to do arithmetic is how you get a reminder for last Tuesday.
 */

const WEEKDAYS = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
];

const MONTHS = [
  'jan', 'feb', 'mar', 'apr', 'may', 'jun',
  'jul', 'aug', 'sep', 'oct', 'nov', 'dec',
];

/** YYYYMMDD in local terms — the format Google Calendar's template URL wants. */
export function calendarStamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
}

function addDays(from: Date, n: number): Date {
  const d = new Date(from);
  d.setDate(d.getDate() + n);
  return d;
}

/**
 * Resolve free text to a date, relative to `today`.
 *
 * Always resolves FORWARD: "Friday" on a Saturday means the coming Friday, not
 * yesterday's. A commitment is about something not yet done, so a backwards
 * reading is always wrong.
 */
export function resolveWhen(text: string | undefined, today: Date): Date | null {
  if (!text) return null;
  const s = text.trim().toLowerCase();
  if (!s) return null;

  // Explicit ISO — the least ambiguous thing a model can emit, so it wins.
  const iso = s.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    const d = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
    return Number.isNaN(d.getTime()) ? null : d;
  }

  if (/\btoday\b|\bcob\b|\beod\b/.test(s)) return today;
  if (/\btomorrow\b/.test(s)) return addDays(today, 1);

  // "Nov 3", "3 Nov", "November 3rd".
  const monthFirst = s.match(/\b([a-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b/);
  const dayFirst = s.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]{3,9})\b/);
  const md = monthFirst
    ? { month: monthFirst[1], day: Number(monthFirst[2]) }
    : dayFirst
      ? { month: dayFirst[2], day: Number(dayFirst[1]) }
      : null;
  if (md) {
    const idx = MONTHS.indexOf(md.month.slice(0, 3));
    if (idx >= 0 && md.day >= 1 && md.day <= 31) {
      let d = new Date(today.getFullYear(), idx, md.day);
      // A month already past means they mean next year.
      if (d.getTime() < today.getTime() - 86400000) d = new Date(today.getFullYear() + 1, idx, md.day);
      return d;
    }
  }

  const nextWeek = /\bnext week\b/.test(s);
  const weekday = WEEKDAYS.findIndex((w) => new RegExp(`\\b${w}\\b`).test(s));
  if (weekday >= 0) {
    let delta = (weekday - today.getDay() + 7) % 7;
    // "Friday" said ON Friday means the next one, not this second.
    if (delta === 0) delta = 7;
    if (nextWeek) delta += 7;
    return addDays(today, delta);
  }

  if (nextWeek) return addDays(today, 7);
  if (/\bthis week\b|\bend of (the )?week\b/.test(s)) {
    // Friday of the current week, or next Friday if that has passed.
    const delta = (5 - today.getDay() + 7) % 7;
    return addDays(today, delta === 0 ? 7 : delta);
  }

  return null;
}

/**
 * A Google Calendar "add event" URL.
 *
 * A plain link, which is the reason it is buildable at all: creating a real
 * event needs the calendar OAuth scope, a RESTRICTED-tier ask that would drag
 * the whole add-on through security review. A template URL needs nothing, works
 * for every user on day one, and leaves them in control of what gets saved —
 * which also happens to be the honest default for something writing to a
 * personal calendar.
 */
export function calendarUrl(title: string, day: Date, details?: string): string {
  const end = addDays(day, 1);
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: title.slice(0, 120),
    dates: `${calendarStamp(day)}/${calendarStamp(end)}`,
  });
  if (details) params.set('details', details.slice(0, 500));
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}
