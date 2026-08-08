import { describe, it, expect } from 'vitest';
import { buildTrendSection, SENTIMENT_LEGEND, type TrendPoint } from './trend';
import { buildThreadCard } from './thread';
import type { CardSection, Widget } from './widgets';

/**
 * The section's real widgets, with the blank-line spacers dropped — so these tests
 * assert on content and stay green when the spacing is retuned.
 */
const content = (section: CardSection | null): Widget[] =>
  section!.widgets.filter((w) => !('textParagraph' in w && w.textParagraph.text.trim() === ''));

const pt = (sentiment: TrendPoint['sentiment'], receivedAt: string): TrendPoint => ({
  sentiment,
  score: sentiment === 'positive' ? 75 : sentiment === 'negative' ? 25 : 50,
  receivedAt,
  isCustomer: true,
});

describe('buildTrendSection', () => {
  it('returns null when there are no scored messages', () => {
    expect(buildTrendSection([])).toBeNull();
  });

  it('renders one coloured block per message, oldest → newest', () => {
    const section = buildTrendSection([
      pt('positive', '2026-05-01T00:00:00Z'),
      pt('neutral', '2026-05-02T00:00:00Z'),
      pt('negative', '2026-05-03T00:00:00Z'),
    ]);
    const squares = (content(section)[0] as { textParagraph: { text: string } }).textParagraph.text;
    expect(squares).toBe('🟩 🟧 🟥'); // green positive, orange neutral, red negative
  });

  it('keeps chronological order rather than grouping by sentiment', () => {
    const section = buildTrendSection([
      pt('neutral', '2026-05-01T00:00:00Z'),
      pt('positive', '2026-05-02T00:00:00Z'),
      pt('negative', '2026-05-03T00:00:00Z'),
    ]);
    const squares = (content(section)[0] as { textParagraph: { text: string } }).textParagraph.text;
    expect(squares).toBe('🟧 🟩 🟥');
  });

  it('charts only the most recent window', () => {
    const many = Array.from({ length: 12 }, (_, i) =>
      pt(i < 11 ? 'positive' : 'negative', `2026-05-${String(i + 1).padStart(2, '0')}T00:00:00Z`),
    );
    const section = buildTrendSection(many);
    const squares = (content(section)[0] as { textParagraph: { text: string } }).textParagraph.text;
    expect(squares.split(' ')).toHaveLength(10);
    expect(squares.endsWith('🟥')).toBe(true);
  });

  it('never carries sentiment by colour alone — no image widget to fail the proxy', () => {
    const section = buildTrendSection([pt('negative', '2026-05-01T00:00:00Z')]);
    expect(JSON.stringify(section)).not.toContain('image');
    const meta = (content(section)[2] as { decoratedText: { text: string } }).decoratedText;
    expect(meta.text).toBe('Negative');
  });

  it('includes the colour legend', () => {
    const section = buildTrendSection([pt('positive', '2026-05-01T00:00:00Z')]);
    const legend = (content(section)[1] as { textParagraph: { text: string } }).textParagraph.text;
    expect(legend).toBe(SENTIMENT_LEGEND);
    expect(legend).toBe('🟩 Positive · 🟧 Neutral · 🟥 Negative');
  });

  it('flags a declining thread and reports the window', () => {
    const section = buildTrendSection([
      pt('positive', '2026-05-01T00:00:00Z'),
      pt('neutral', '2026-05-02T00:00:00Z'),
      pt('negative', '2026-05-03T00:00:00Z'),
    ]);
    const meta = (content(section)[2] as { decoratedText: { text: string; bottomLabel: string } }).decoratedText;
    expect(meta.text).toBe('Negative');
    expect(meta.bottomLabel).toContain('↓ declining');
    expect(meta.bottomLabel).toContain('3 messages');
  });

  it('caps the charted window and notes the total', () => {
    const many = Array.from({ length: 17 }, (_, i) => pt('neutral', `2026-05-${String(i + 1).padStart(2, '0')}T00:00:00Z`));
    const section = buildTrendSection(many);
    const meta = (content(section)[2] as { decoratedText: { bottomLabel: string } }).decoratedText;
    expect(meta.bottomLabel).toContain('last 10 of 17 messages');
  });
});

describe('thread card integration', () => {
  it('includes a Trend section only when trend points are present', () => {
    const withTrend = JSON.stringify(
      buildThreadCard({ status: 'resolved', accountName: 'Peak Insure', trend: [pt('negative', '2026-05-03T00:00:00Z')] }),
    );
    expect(withTrend).toContain('Trend, this thread');

    const without = JSON.stringify(buildThreadCard({ status: 'resolved', accountName: 'Peak Insure' }));
    expect(without).not.toContain('Trend, this thread');
  });
});
