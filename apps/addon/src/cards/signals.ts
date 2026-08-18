/**
 * Maps the `emails.signals INTEGER[]` codes (see apps/api/sql/emails.sql) to the
 * human labels the InboxPulse design uses. Kept in one place so the label copy
 * matches the design spec exactly.
 */
export const SIGNAL_LABELS: Record<number, string> = {
  1: 'Positive',
  2: 'Negative',
  3: 'Neutral',
  10: 'At risk',
  20: 'Upsell signal',
  30: 'Churn risk',
  31: 'Churn risk',
  32: 'Churn risk',
  33: 'Churn risk',
  40: 'Kudos',
  50: 'Competitor',
};

/** Distinct, design-labelled signal names for a signals array (empty-safe). */
export function signalNames(signals: number[] = []): string[] {
  const names = signals.map((s) => SIGNAL_LABELS[s]).filter((n): n is string => Boolean(n));
  return [...new Set(names)];
}
