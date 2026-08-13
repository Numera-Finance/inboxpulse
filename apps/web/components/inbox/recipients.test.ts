import { describe, it, expect } from "vitest"
import {
  participantDetail,
  participantLabel,
  summarizeRecipients,
} from "./recipients"

/** A recipient as stored in emails.tos/ccs — name is optional in the headers. */
const person = (email: string, name?: string) => ({ email, name: name ?? email })

describe("participantLabel", () => {
  it("prefers the display name the sender supplied", () => {
    expect(participantLabel(person("pjain@example.com", "Pragati Jain"))).toBe(
      "Pragati Jain"
    )
  })

  it("falls back to the address when no name was captured", () => {
    // ~44% of stored recipients arrive as a bare address.
    expect(participantLabel(person("pjain@example.com"))).toBe(
      "pjain@example.com"
    )
  })
})

describe("participantDetail", () => {
  it("keeps the address visible alongside the name", () => {
    expect(participantDetail(person("pjain@example.com", "Pragati Jain"))).toBe(
      "Pragati Jain <pjain@example.com>"
    )
  })

  it("shows the address once when it stands in for the missing name", () => {
    expect(participantDetail(person("pjain@example.com"))).toBe(
      "pjain@example.com"
    )
  })
})

describe("summarizeRecipients", () => {
  it("fills all three slots from To, hiding Cc entirely", () => {
    const to = [person("a@x.com"), person("b@x.com"), person("c@x.com")]
    const cc = [person("d@x.com"), person("e@x.com")]

    const { shownTo, shownCc, hiddenCount } = summarizeRecipients(to, cc)

    expect(shownTo).toHaveLength(3)
    expect(shownCc).toEqual([])
    expect(hiddenCount).toBe(2)
  })

  it("spills into Cc when To is short", () => {
    const { shownTo, shownCc, hiddenCount } = summarizeRecipients(
      [person("a@x.com")],
      [person("b@x.com"), person("c@x.com"), person("d@x.com")]
    )

    expect(shownTo).toHaveLength(1)
    expect(shownCc).toHaveLength(2)
    expect(hiddenCount).toBe(1)
  })

  it("hides nothing when everyone fits, so no toggle is offered", () => {
    // The screenshot case: one To, one Cc — both visible, nothing to expand.
    const { hiddenCount } = summarizeRecipients(
      [person("pjain@example.com", "Pragati Jain")],
      [person("mmurthy@example.com", "Meghana Muralidhar Murthy")]
    )

    expect(hiddenCount).toBe(0)
  })

  it("summarizes a Cc-only message", () => {
    const { shownTo, shownCc, hiddenCount } = summarizeRecipients(
      [],
      [person("a@x.com"), person("b@x.com")]
    )

    expect(shownTo).toEqual([])
    expect(shownCc).toHaveLength(2)
    expect(hiddenCount).toBe(0)
  })

  it("reports nothing to show for a message with no recipients", () => {
    expect(summarizeRecipients([], [])).toEqual({
      shownTo: [],
      shownCc: [],
      hiddenCount: 0,
    })
  })
})
