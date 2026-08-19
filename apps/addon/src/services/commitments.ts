/**
 * Reject "commitments" that are really suggestions.
 *
 * The prompt already tells the model that a commitment is a future action the
 * person themselves undertook, and that suggestions do not count. It ignores
 * that regularly: "We should meet and learn from them" came back on a live
 * thread as a commitment by the person who wrote it.
 *
 * That failure is worse than it looks. "Who owes what" is the section that says
 * a named colleague owes something, and it is the input to a calendar reminder
 * and a tracked task. Filing a suggestion as a debt puts a person's name against
 * an obligation they never took on, and the user finds out by chasing them for
 * it. One of those is enough to stop believing the section.
 *
 * So this is a deterministic gate, not more prompt. Prompt instructions are
 * advisory and this needs to be a rule.
 *
 * The test is grammatical: a commitment needs someone to have undertaken it.
 * "We should", "let's", "it would be good to" propose that somebody act. "I'll",
 * "I will", "we'll send" undertake it. When a sentence proposes without
 * undertaking, it is a suggestion regardless of how actionable it sounds.
 *
 * IT FAILS CLOSED. The first version only rejected sentences that matched a
 * suggestion pattern and accepted everything else, which let a whole third
 * category through: pleasantries. On a thank-you thread the panel rendered
 *
 *   Vignesh Mohan  — carry this trend forward across everything we do together
 *   Seema Bhattacharjee — look forward to carrying this momentum forward
 *
 * under the heading "Who owes what". Nobody owed anything; it was a thank-you
 * note. "We look forward to X" is neither a suggestion nor an undertaking, so
 * absence-of-suggestion accepted it.
 *
 * Requiring a positive undertaking is the only rule that holds, because the
 * space of things that are not commitments is unbounded and cannot be
 * enumerated. This will miss real commitments phrased unusually. That is the
 * right trade: this section names a person and asserts they owe something, and
 * it feeds a calendar reminder and a tracked task. A missed commitment costs a
 * user one glance at a thread they already have open; an invented one sends
 * them to chase a colleague over a sentence that was a pleasantry.
 */

/** Proposing that something be done. */
const SUGGESTION = [
  /\b(?:we|you|they|someone|somebody)\s+(?:should|ought to|could|might want to|may want to)\b/i,
  /\blet(?:'|’)?s\b/i,
  /\blet us\b/i,
  /\bit(?:'|’)?s worth\b/i,
  /\bit would be (?:good|useful|helpful|worth|better|great)\b/i,
  /\bit might be (?:good|useful|helpful|worth|better)\b/i,
  /\b(?:maybe|perhaps|possibly)\b/i,
  /\bwe need to (?:think|consider|discuss)\b/i,
  /\b(?:can|could|should|shall)\s+(?:we|you)\b.*\?/i,
  /\bworth (?:a|considering|exploring|doing)\b/i,
];

/**
 * Warm noise. Not consulted for the accept/reject decision -- the fail-closed
 * rule already handles these -- but kept as executable documentation of the
 * category that broke the first version, and asserted in the tests.
 */
export const PLEASANTRY = [
  /\blook(?:ing)? forward to\b/i,
  /\bcan(?:'|’)?t wait to\b/i,
  /\b(?:excited|thrilled|delighted|pleased|proud) (?:about|to|of)\b/i,
  /\bthank(?:s| you)\b/i,
  /\bappreciate\b/i,
  /\bhere(?:'|’)?s to\b/i,
  /\bthis is just the beginning\b/i,
];

/** Actually undertaking it. */
const UNDERTAKING = [
  /\b(?:i|we)\s*(?:'|’)ll\b/i,
  /\b(?:i|we)\s+will\b/i,
  /\bwill\s+(?:send|share|get|loop|follow|circle|revert|confirm|deliver|schedule|set up|put|write|draft|review|check|update|come back)\b/i,
  /\b(?:i|we)\s+(?:am|'m|’m|are|'re|’re)\s+going to\b/i,
  /\b(?:i|we)\s+(?:plan|intend|commit|promise|aim)\b/i,
  /\b(?:i|we)\s+(?:am|'m|’m|are|'re|’re)\s+\w+ing\b/i,
  // Bare gerund opening a sentence: "Sending the deck across by end of day."
  /^(?:sending|shipping|getting|putting|drafting|writing|scheduling|sharing|booking|raising|filing)\b/i,
];

/**
 * Whether a commitment survives.
 *
 * Judged on the QUOTE, because the quote is the sentence the person actually
 * wrote. The model's `what` is its own paraphrase, and a paraphrase launders a
 * suggestion into an obligation for free: "We should meet and learn from them"
 * becomes "meet and learn from them", which reads exactly like a task.
 *
 * A commitment with no quote cannot be checked, and an unverifiable claim about
 * what a named person owes is the one this is here to stop. It fails closed.
 */
export function isRealCommitment(c: { what?: string; quote?: string }): boolean {
  const quote = (c.quote ?? '').trim();
  if (!quote) return false;

  // Positive evidence required. See the note above on failing closed -- an
  // earlier version returned true whenever no SUGGESTION pattern matched, and
  // "we look forward to carrying this momentum forward" matches neither list.
  return UNDERTAKING.some((re) => re.test(quote));
}

export function filterCommitments<T extends { what?: string; quote?: string }>(list: T[]): T[] {
  return list.filter(isRealCommitment);
}
