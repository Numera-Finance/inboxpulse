import { type CardSection, type Widget, text, deco, heading, spacer } from './widgets';

/**
 * "Trend, this thread" — the design's sentiment-trend chart (§5), expressed in
 * the CardService widget set.
 *
 * Rendered as a row of equal-width coloured blocks, one per message, oldest →
 * newest: green positive, orange neutral, red negative. Deliberately NOT a line
 * chart. The add-on used to rasterize a PNG line chart itself (CardService can't
 * draw one, and its card images must be hosted PNG URLs — the image proxy is
 * unreliable with SVG), but a three-level axis over ≤10 messages doesn't earn a
 * plot: the line only ever visits three heights, the ~300px panel leaves no room
 * to label the y axis, and the hand-rasterized PNG blurred on HiDPI screens.
 * Native widgets render at device resolution and read correctly in either Gmail
 * theme.
 *
 * Sentiment is never carried by colour alone — the legend names each colour, and
 * the summary row spells out the latest class in words.
 */

/** The three sentiment classes. */
export type Sentiment = 'positive' | 'neutral' | 'negative';

/**
 * Ordinal rank per class, used to decide whether the thread is improving or
 * declining: positive = +1, neutral = 0, negative = -1.
 */
export const SENTIMENT_LEVEL: Record<Sentiment, 1 | 0 | -1> = {
  positive: 1,
  neutral: 0,
  negative: -1,
};

export interface TrendPoint {
  score: number;
  sentiment: Sentiment;
  receivedAt: string;
  isCustomer: boolean;
}

const SENTIMENT_LABEL: Record<Sentiment, string> = {
  positive: 'Positive',
  negative: 'Negative',
  neutral: 'Neutral',
};

const SENTIMENT_SQUARE: Record<Sentiment, string> = {
  positive: '🟩',
  neutral: '🟧',
  negative: '🟥',
};

/** Shared legend copy — the same colour key the blocks use. */
export const SENTIMENT_LEGEND = `${SENTIMENT_SQUARE.positive} Positive · ${SENTIMENT_SQUARE.neutral} Neutral · ${SENTIMENT_SQUARE.negative} Negative`;

/**
 * Build the Trend section, or null when there's nothing scored to show.
 * `windowSize` caps how many recent messages are charted.
 */
export function buildTrendSection(points: TrendPoint[], windowSize = 10): CardSection | null {
  if (!points || points.length === 0) return null;

  const recent = points.slice(-windowSize);

  const first = recent[0];
  const last = recent[recent.length - 1];
  const firstLevel = SENTIMENT_LEVEL[first.sentiment];
  const lastLevel = SENTIMENT_LEVEL[last.sentiment];
  const direction =
    recent.length < 2 || lastLevel === firstLevel
      ? '→ stable'
      : lastLevel > firstLevel
        ? '↑ improving'
        : '↓ declining';

  const windowNote =
    points.length > recent.length
      ? `last ${recent.length} of ${points.length} messages`
      : `${recent.length} message${recent.length > 1 ? 's' : ''}`;

  // Blank lines between the heading, the blocks, the legend and the summary: the
  // four read as four distinct things (the label, the chart, its key, the
  // takeaway), and Cards v2 gives no spacing property to separate them with.
  const widgets: Widget[] = [
    spacer(),
    text(recent.map((p) => SENTIMENT_SQUARE[p.sentiment]).join(' ')),
    spacer(),
    text(SENTIMENT_LEGEND),
    spacer(),
    deco({
      topLabel: 'Latest',
      text: SENTIMENT_LABEL[last.sentiment],
      bottomLabel: `${direction} · ${windowNote}`,
    }),
  ];

  return { header: heading('Trend, this thread'), widgets };
}
