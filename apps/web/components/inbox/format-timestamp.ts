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
  // Normalize both timestamps to local midnight before diffing so the
  // comparison is by calendar day, independent of the time of day.
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const startOfDate = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const diffDays = Math.round(
    (startOfToday.getTime() - startOfDate.getTime()) / (1000 * 60 * 60 * 24)
  )

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
