import { Signal } from '@crm/shared';

/**
 * Which Gmail labels we are willing to write into someone's mailbox.
 *
 * A label is not a panel section. A bad section is ignored; a bad label is a
 * coloured marker in an inbox the user did not ask us to touch, sitting there
 * until they delete it by hand. Labels are the ONE sanctioned mailbox write
 * (ADR-005), so the bar is precision, not coverage.
 *
 * Everything here comes from measuring the existing corpus (125,685 analysed
 * emails), not from taste.
 *
 * ---------------------------------------------------------------------------
 * THE FOUR RULES
 * ---------------------------------------------------------------------------
 *
 * 1. A LABEL THAT FIRES ON MORE THAN 5% OF MAIL CARRIES NO INFORMATION.
 *
 *    Measured share of analysed mail:
 *
 *      Automated       51.7%   <- half the mailbox
 *      Churn (incl low) 25.7%
 *      Transactional    8.2%
 *      Marketing        5.2%
 *      Spam             4.9%
 *      Upsell           3.6%
 *      Churn (med+)     3.2%
 *      Competitor       2.9%
 *      Negative         0.8%
 *      Positive         0.2%
 *      Kudos            0.0%
 *      Escalation       0.0%
 *
 *    Labelling half a mailbox "Automated" tells the reader something they can
 *    see from the sender. The budget is enforced at RUN TIME against the actual
 *    mailbox, not just asserted here — see `withinBudget`.
 *
 * 2. NEVER DUPLICATE WHAT GMAIL ALREADY DOES.
 *
 *    Automated, Marketing, Transactional and Spam are Gmail's own Promotions /
 *    Updates / Spam categories. Re-labelling them adds a second, worse copy of
 *    a classification the user already has, and spends our credibility on it.
 *
 * 3. A LABEL THAT HAS NEVER FIRED IS NOT A LABEL.
 *
 *    Kudos and Escalation are 0 rows in 125,685. They were specced, never
 *    produced, and shipping them means creating Gmail labels that stay empty.
 *
 * 4. ONE LABEL PER MESSAGE.
 *
 *    Under the previous rules 1,893 emails would have taken two or more. A
 *    message wearing three coloured tags is not triaged, it is decorated.
 *    Ordered by which one most changes what the reader does next.
 *
 * ---------------------------------------------------------------------------
 * THE TEST FOR ANYTHING NEW
 * ---------------------------------------------------------------------------
 *
 * Would seeing this CHANGE WHAT THE USER DOES? Not "is it true", not "can we
 * compute it". A label's only job is to make someone open a message sooner, or
 * decide not to open it at all. Each surviving label carries the action it
 * implies, written beside it below; a tag that merely describes the message has
 * no claim on the mailbox.
 *
 * This is the same bar the connector spec applies
 * (apps/addon/src/services/connectors.ts): one fact per system, and only if it
 * changes the reply. A classification that changes nothing is a fact about our
 * pipeline, not about the user's day.
 */

export interface LabelDecision {
  /** Full Gmail label name, namespaced so the whole set is removable. */
  name: string;
  /** Gmail palette background. */
  bg: string;
  text: string;
  /** Share of the mailbox above which this label is refused. */
  maxShare: number;
}

const NS = 'InboxPulse';

/**
 * In priority order — the first match wins, and there is only ever one.
 *
 * Ordered by what most changes the reader's next action: a customer at real
 * risk of leaving outranks an opening, which outranks a note that someone was
 * unhappy in passing.
 */
export const LABELS: LabelDecision[] = [
  // Means: call them. A customer at real risk of leaving is worth interrupting
  // a day for, which is the highest claim any tag can make on an inbox.
  { name: `${NS}/Churn risk`, bg: '#fb4c2f', text: '#ffffff', maxShare: 0.05 },
  // Means: follow up when you have the energy to sell. Not urgent, but it
  // decays — an opening ignored for two weeks is not an opening.
  { name: `${NS}/Upsell`, bg: '#16a765', text: '#ffffff', maxShare: 0.05 },
  // Means: read this now. The cheapest possible action, and the one most often
  // skipped because an unhappy message looks like every other message in a list.
  { name: `${NS}/Negative`, bg: '#ffad47', text: '#ffffff', maxShare: 0.05 },
];

/**
 * Competitor terms that are ordinary English or industry vocabulary.
 *
 * The competitor flag is keyword-matched, and 1,947 of 3,595 hits matched a
 * stopword — `"and"` accounts for most of them, and even the "plausible" half
 * includes `"&"`, `"Accounting"` and `"Global"`. A parser fix landed later, but
 * the historical rows are still in the table and a label sweep reads history.
 *
 * Competitor is therefore NOT in LABELS at all. This list exists so the
 * decision is documented and testable rather than looking like an oversight.
 */
export const COMPETITOR_JUNK_TERMS = [
  'and', 'the', 'for', 'with', 'our', 'a', 'to', 'of', 'in', 'is', '&',
  'cfo', 'accounting', 'global', 'finance', 'financial', 'group',
];

/**
 * The single label for a message, or null.
 *
 * CHURN_LOW is excluded on purpose. It fires on 28,226 emails against 4,015 at
 * medium or above, and sampled low rows carry reasoning that says in terms "no
 * signs of churn". The panel already stopped treating it as a flag; a label is
 * the worse place to keep the mistake.
 */
export function labelFor(signals: number[]): LabelDecision | null {
  const s = new Set(signals);

  if (s.has(Signal.CHURN_MEDIUM) || s.has(Signal.CHURN_HIGH) || s.has(Signal.CHURN_CRITICAL)) {
    return LABELS[0];
  }
  if (s.has(Signal.UPSELL)) return LABELS[1];
  if (s.has(Signal.SENTIMENT_NEGATIVE)) return LABELS[2];
  return null;
}

export interface BudgetVerdict {
  ok: boolean;
  share: number;
  /** Present when refused, phrased for a human reading the run log. */
  reason?: string;
}

/**
 * Whether a label may be written to this mailbox, given what a dry run counted.
 *
 * This is the load-bearing safety check, and it deliberately does not trust the
 * policy above. The corpus that set these thresholds is one tenant's mail; a
 * different mailbox can have a very different mix, and the failure mode —
 * thousands of labels written into a real inbox — is not one to discover
 * afterwards. So every run measures first and refuses per label.
 *
 * Refusing is not an error. It means the label would have been noise here, and
 * the run should say so and carry on with the others.
 */
export function withinBudget(
  label: LabelDecision,
  matched: number,
  totalConsidered: number,
): BudgetVerdict {
  if (totalConsidered <= 0) return { ok: false, share: 0, reason: 'nothing to label' };
  const share = matched / totalConsidered;
  if (share > label.maxShare) {
    return {
      ok: false,
      share,
      reason: `${label.name} would cover ${(100 * share).toFixed(1)}% of this mailbox (limit ${(100 * label.maxShare).toFixed(0)}%) — refusing, it would be noise`,
    };
  }
  return { ok: true, share };
}

/**
 * Every label this policy could ever create, for teardown.
 *
 * A labeller that cannot be fully undone in one command should not be run at
 * all. Namespacing is what makes "delete everything InboxPulse wrote" a real
 * operation rather than a promise.
 */
export function allLabelNames(): string[] {
  return LABELS.map((l) => l.name);
}
