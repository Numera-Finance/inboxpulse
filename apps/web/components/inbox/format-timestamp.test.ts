import { describe, it, expect } from "vitest"
import { formatTimestamp } from "./format-timestamp"

/**
 * Dates are built from local components (new Date(y, m, d, h, min)) so both
 * `date` and `now` live in the same local timezone — the assertions about which
 * calendar bucket a timestamp falls into are then independent of the machine's TZ.
 */
const local = (y: number, m: number, d: number, h = 0, min = 0): Date =>
  new Date(y, m - 1, d, h, min)

describe("formatTimestamp", () => {
  it("shows the time for a timestamp earlier the same calendar day", () => {
    const now = local(2026, 6, 16, 14, 0)
    const date = local(2026, 6, 16, 9, 40)
    // Locale-dependent exact text; just assert it renders a clock time, not a date label.
    expect(formatTimestamp(date, now)).toMatch(/\d{1,2}:\d{2}/)
  })

  it("shows 'Yesterday' for the previous calendar day even if < 24h elapsed (the bug case)", () => {
    // Screenshot scenario: email Mon Jun 15 9:40 PM, "now" ~9h later on Jun 16.
    // The old elapsed-ms logic bucketed this as "today" and showed "9:40 PM".
    const now = local(2026, 6, 16, 6, 40)
    const date = local(2026, 6, 15, 21, 40)
    expect(formatTimestamp(date, now)).toBe("Yesterday")
  })

  it("shows 'Yesterday' the instant the clock passes local midnight", () => {
    const now = local(2026, 6, 16, 0, 1)
    const date = local(2026, 6, 15, 23, 59)
    expect(formatTimestamp(date, now)).toBe("Yesterday")
  })

  it("does NOT show 'Yesterday' for a same-day timestamp ~23h earlier", () => {
    const now = local(2026, 6, 16, 23, 30)
    const date = local(2026, 6, 16, 0, 30)
    expect(formatTimestamp(date, now)).not.toBe("Yesterday")
    expect(formatTimestamp(date, now)).toMatch(/\d{1,2}:\d{2}/)
  })

  it("shows the weekday name for 2-6 calendar days ago", () => {
    const now = local(2026, 6, 16, 10, 0) // Tuesday
    const date = local(2026, 6, 13, 10, 0) // 3 days earlier (Saturday)
    expect(formatTimestamp(date, now)).toBe(
      date.toLocaleDateString([], { weekday: "short" })
    )
  })

  it("shows month/day for 7+ calendar days ago", () => {
    const now = local(2026, 6, 16, 10, 0)
    const date = local(2026, 6, 1, 10, 0)
    expect(formatTimestamp(date, now)).toBe(
      date.toLocaleDateString([], { month: "short", day: "numeric" })
    )
  })

  it("treats exactly 7 days ago as older (month/day, not weekday)", () => {
    const now = local(2026, 6, 16, 10, 0)
    const date = local(2026, 6, 9, 10, 0)
    expect(formatTimestamp(date, now)).toBe(
      date.toLocaleDateString([], { month: "short", day: "numeric" })
    )
  })

  it("falls back to month/day for future-dated timestamps", () => {
    const now = local(2026, 6, 16, 10, 0)
    const date = local(2026, 6, 18, 10, 0)
    expect(formatTimestamp(date, now)).toBe(
      date.toLocaleDateString([], { month: "short", day: "numeric" })
    )
  })
})
