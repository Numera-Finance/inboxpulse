import { describe, it, expect } from "vitest"
import { resolveFlags } from "./signal-flags-logic"

/**
 * The signal codes below mirror @crm/shared Signal:
 *  2 negative · 3 neutral · 10 escalation · 20 upsell · 32 churn-high ·
 *  33 churn-critical · 30 churn-low · 40 kudos · 50 competitor · 64 business
 * These are exactly the shapes persisted for the npradhan past-week backfill
 * (e.g. [64,3,32] = Business/Neutral/Churn-High).
 */
describe("resolveFlags", () => {
  it("returns nothing for empty / classification-or-sentiment-only signals", () => {
    expect(resolveFlags(null)).toEqual([])
    expect(resolveFlags([])).toEqual([])
    // Business + Neutral only — no action flags.
    expect(resolveFlags([64, 3])).toEqual([])
  })

  it("flags escalation as 'At risk'", () => {
    const flags = resolveFlags([10, 2])
    expect(flags.map((f) => f.kind)).toEqual(["escalation"])
    expect(flags[0].text).toBe("At risk")
  })

  it("flags churn with its level in the label", () => {
    expect(resolveFlags([64, 3, 32])[0]).toMatchObject({ kind: "churn", text: "Churn risk · High" })
    expect(resolveFlags([64, 3, 33])[0]).toMatchObject({ kind: "churn", text: "Churn risk · Critical" })
    expect(resolveFlags([64, 3, 30])[0]).toMatchObject({ kind: "churn", text: "Churn risk · Low" })
  })

  it("flags upsell, kudos, competitor", () => {
    expect(resolveFlags([20]).map((f) => f.kind)).toEqual(["upsell"])
    expect(resolveFlags([40]).map((f) => f.kind)).toEqual(["kudos"])
    expect(resolveFlags([50]).map((f) => f.kind)).toEqual(["competitor"])
  })

  it("orders multiple flags by urgency (escalation, churn, competitor, upsell, kudos)", () => {
    const flags = resolveFlags([40, 20, 50, 32, 10])
    expect(flags.map((f) => f.kind)).toEqual(["escalation", "churn", "competitor", "upsell", "kudos"])
  })
})
