import type { Sentiment } from '../hooks/useThreadTrend';

/**
 * The panel's single sentiment vocabulary — label and colour.
 *
 * Shared rather than per-component because the trend blocks and the selected
 * message's sentiment now sit in different groups of the same panel: if they
 * ever disagreed about what "neutral" looks like, the panel would be telling the
 * reader two things about one message.
 */

export const SENTIMENT_LABEL: Record<Sentiment, string> = {
  positive: 'Positive',
  neutral: 'Neutral',
  negative: 'Negative',
};

/** Matches the add-on's green / orange / red key. */
export const SENTIMENT_CLASS: Record<Sentiment, string> = {
  positive: 'bg-emerald-500',
  neutral: 'bg-orange-500',
  negative: 'bg-rose-600',
};
