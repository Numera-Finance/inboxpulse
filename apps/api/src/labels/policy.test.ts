import { describe, it, expect } from 'vitest';
import { labelFor, withinBudget, LABELS, allLabelNames, COMPETITOR_JUNK_TERMS } from './policy';
import { Signal } from '@crm/shared';

describe('labelFor', () => {
  it('does not label CHURN_LOW', () => {
    // 28,226 emails carry it against 4,015 at medium+, and sampled low rows say
    // in terms "no signs of churn". A label writes that mistake into an inbox.
    expect(labelFor([Signal.CHURN_LOW])).toBeNull();
  });

  it('labels real churn', () => {
    for (const s of [Signal.CHURN_MEDIUM, Signal.CHURN_HIGH, Signal.CHURN_CRITICAL]) {
      expect(labelFor([s])?.name).toBe('InboxPulse/Churn risk');
    }
  });

  it('returns exactly one label, never a stack', () => {
    // 1,893 emails would have taken two or more under the previous rules. A
    // message wearing three coloured tags is decorated, not triaged.
    const d = labelFor([Signal.CHURN_HIGH, Signal.UPSELL, Signal.SENTIMENT_NEGATIVE]);
    expect(d?.name).toBe('InboxPulse/Churn risk');
    expect(Array.isArray(d)).toBe(false);
  });

  it('never labels what Gmail already categorises', () => {
    // Automated is 51.7% of the corpus; Gmail's own Updates/Promotions already
    // say this, and better.
    for (const s of [
      Signal.CLASSIFICATION_AUTOMATED,
      Signal.CLASSIFICATION_MARKETING,
      Signal.CLASSIFICATION_TRANSACTIONAL,
      Signal.CLASSIFICATION_SPAM,
      Signal.CLASSIFICATION_BUSINESS,
    ]) {
      expect(labelFor([s]), String(s)).toBeNull();
    }
  });

  it('does not label competitor mentions', () => {
    // Keyword-matched: 1,947 of 3,595 hits matched a stopword, "and" chief
    // among them, and the rest include "&", "Accounting" and "Global".
    expect(labelFor([Signal.COMPETITOR])).toBeNull();
    expect(COMPETITOR_JUNK_TERMS).toContain('and');
  });

  it('does not ship labels that have never fired', () => {
    // Kudos and Escalation are 0 rows in 125,685 analysed emails.
    expect(labelFor([Signal.KUDOS])).toBeNull();
    expect(labelFor([Signal.ESCALATION])).toBeNull();
    expect(allLabelNames()).toHaveLength(3);
  });

  it('returns nothing for an unanalysed message', () => {
    expect(labelFor([])).toBeNull();
  });
});

describe('withinBudget', () => {
  const churn = LABELS[0];

  it('refuses a label that would cover too much of the mailbox', () => {
    const v = withinBudget(churn, 2600, 10_000); // 26%, the CHURN_LOW share
    expect(v.ok).toBe(false);
    expect(v.reason).toContain('refusing');
  });

  it('allows a label within its share', () => {
    expect(withinBudget(churn, 320, 10_000).ok).toBe(true); // 3.2%
  });

  it('refuses when there is nothing to label rather than dividing by zero', () => {
    expect(withinBudget(churn, 0, 0).ok).toBe(false);
  });

  it('is evaluated per mailbox, not from the corpus that set the threshold', () => {
    // Same label, same limit, different mailbox mix — one passes, one does not.
    expect(withinBudget(churn, 40, 1000).ok).toBe(true);
    expect(withinBudget(churn, 400, 1000).ok).toBe(false);
  });
});
