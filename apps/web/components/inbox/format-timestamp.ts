import { differenceInCalendarDays } from "date-fns"

/**
 * Format a timestamp for display in the inbox list.
 *
 * Buckets are based on the local *calendar day* difference between `date` and
 * `now`, not elapsed milliseconds. This ensures an email sent yesterday evening
 * reads as "Yesterday" the moment the clock passes local midnight, rather than
 * lingering as a same-day time for a rolling 24 hours.
 *
 * @param date - The timestamp to format (rendered in the browser's local timezone).
 * @param now - The current time; defaults to `new Date()`. Injectable for tests.
 */
export function formatTimestamp(date: Date, now: Date = new Date()): string {
  // Calendar-day difference in local time: 0 = today, 1 = yesterday, negative =
  // future. date-fns handles the DST / time-of-day normalization for us.
  const diffDays = differenceInCalendarDays(now, date)

  if (diffDays === 0) {
    // Today - show time
    return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
  } else if (diffDays === 1) {
    return "Yesterday"
  } else if (diffDays > 1 && diffDays < 7) {
    // Earlier this week - show day name
    return date.toLocaleDateString([], { weekday: "short" })
  } else {
    // Older (or any future-dated item) - show date
    return date.toLocaleDateString([], { month: "short", day: "numeric" })
  }
}
