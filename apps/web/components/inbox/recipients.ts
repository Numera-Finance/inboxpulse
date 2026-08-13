import type { InboxParticipant } from "./types"

/**
 * How many addresses the collapsed recipient summary shows before the rest are
 * folded behind the toggle.
 */
export const SUMMARY_RECIPIENT_LIMIT = 3

/**
 * Short label for the collapsed summary: the display name when the message
 * carried one (about 56% of stored recipients do), otherwise the bare address.
 *
 * A name is only ever shown when the sender's mail client actually supplied
 * one. We deliberately do not derive a name from the address — turning
 * pjain@example.com into "Pjain" invents something that reads like a real
 * person's name.
 */
export function participantLabel(participant: InboxParticipant): string {
  return participant.name || participant.email || ""
}

/**
 * Full label for the expanded list: "Name <address>", so the address stays
 * verifiable — seeing the actual ids is the point of expanding. Falls back to
 * the address alone when no name was captured, rather than repeating it as
 * "pjain@example.com <pjain@example.com>".
 */
export function participantDetail(participant: InboxParticipant): string {
  if (!participant.email) return participant.name
  if (!participant.name || participant.name === participant.email) {
    return participant.email
  }
  return `${participant.name} <${participant.email}>`
}

/** Which recipients the collapsed summary shows, and how many it holds back. */
export interface RecipientSummaryParts {
  shownTo: InboxParticipant[]
  shownCc: InboxParticipant[]
  hiddenCount: number
}

/**
 * Split recipients into the collapsed summary and the remainder.
 *
 * The summary holds three addresses, To first: three or more To addresses fill
 * it entirely and Cc stays hidden, while a shorter To list leaves room to spill
 * into Cc. `hiddenCount` is 0 when everyone fits, which is what tells the UI
 * there is nothing to expand into.
 */
export function summarizeRecipients(
  to: InboxParticipant[],
  cc: InboxParticipant[]
): RecipientSummaryParts {
  const shownTo = to.slice(0, SUMMARY_RECIPIENT_LIMIT)
  const shownCc = cc.slice(0, SUMMARY_RECIPIENT_LIMIT - shownTo.length)

  return {
    shownTo,
    shownCc,
    hiddenCount: to.length + cc.length - shownTo.length - shownCc.length,
  }
}
