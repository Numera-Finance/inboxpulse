import { Loader2 } from 'lucide-react';
import { useThreadTrend, type Sentiment, type TrendPoint } from '../hooks/useThreadTrend';
import { SENTIMENT_CLASS, SENTIMENT_LABEL } from '../lib/sentiment';
import { Block } from './Section';

interface ThreadTrendProps {
  /** InboxPulse thread id for the open Gmail conversation. */
  threadId: string | null;
  /** How many of the most recent messages to chart. */
  windowSize?: number;
}

/**
 * "Trend" — one coloured block per message in this thread, oldest → newest.
 * Renders as a block inside the THREAD group, which is what scopes it; the
 * heading no longer has to spell out "this thread" itself.
 *
 * Ports the Gmail add-on's trend card (apps/addon/src/cards/trend.ts) into the
 * sidebar, keeping its reasoning: deliberately blocks rather than a line chart,
 * because a three-level axis over ≤10 messages doesn't earn a plot and there's
 * no room to label a y axis in a ~400px rail.
 *
 * Two things the add-on had to fake, this can do properly. The add-on rendered
 * the blocks as 🟩/🟧/🟥 emoji because Cards v2 has no way to draw a coloured
 * box; here they are real elements, so they scale with the panel and match the
 * palette exactly. And sentiment is still never carried by colour alone — the
 * legend names each colour, every block carries a title/aria-label, and the
 * summary spells out the latest class in words.
 */
export function ThreadTrend({ threadId, windowSize = 10 }: ThreadTrendProps): React.ReactElement | null {
  const { points, isLoading } = useThreadTrend(threadId);

  if (!threadId) return null;

  if (isLoading) {
    return (
      <Block title="Trend">
        <div className="flex items-center justify-center py-1">
          <Loader2 size={16} className="animate-spin text-muted-foreground" />
        </div>
      </Block>
    );
  }

  // Nothing scored in this thread — stay out of the way, same as the add-on.
  if (points.length === 0) return null;

  const recent = points.slice(-windowSize);
  const last = recent[recent.length - 1];
  const summary = trendSummary(recent, points.length);

  return (
    <Block title="Trend">
      <div className="space-y-2">
        <div className="flex flex-wrap gap-1" role="img" aria-label={`Sentiment per message: ${recent.map((p) => p.sentiment).join(', ')}`}>
          {recent.map((point, i) => (
            <span
              key={`${point.receivedAt}-${i}`}
              title={`${SENTIMENT_LABEL[point.sentiment]} — ${new Date(point.receivedAt).toLocaleDateString()}`}
              className={`h-4 w-4 rounded-sm ${SENTIMENT_CLASS[point.sentiment]}`}
            />
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          {(['positive', 'neutral', 'negative'] as Sentiment[]).map((s) => (
            <span key={s} className="flex items-center gap-1">
              <span className={`h-3 w-3 rounded-sm ${SENTIMENT_CLASS[s]}`} />
              {SENTIMENT_LABEL[s]}
            </span>
          ))}
        </div>

        <div>
          {/* "Latest" leads and the class reads as its value underneath — the
              reverse of the add-on, where the class was the larger of the two. */}
          <p className="text-sm font-medium">Latest</p>
          <p className="text-xs text-muted-foreground">{SENTIMENT_LABEL[last.sentiment]}</p>
          <p className="text-xs text-muted-foreground">{summary}</p>
        </div>
      </div>
    </Block>
  );
}

/**
 * Ordinal rank per class, used to decide whether the thread is improving or
 * declining: positive = +1, neutral = 0, negative = -1.
 */
const SENTIMENT_LEVEL: Record<Sentiment, 1 | 0 | -1> = {
  positive: 1,
  neutral: 0,
  negative: -1,
};

/** e.g. "→ stable · 3 messages" / "↓ declining · last 10 of 14 messages". */
function trendSummary(recent: TrendPoint[], totalPoints: number): string {
  const firstLevel = SENTIMENT_LEVEL[recent[0].sentiment];
  const lastLevel = SENTIMENT_LEVEL[recent[recent.length - 1].sentiment];

  const direction =
    recent.length < 2 || lastLevel === firstLevel
      ? '→ stable'
      : lastLevel > firstLevel
        ? '↑ improving'
        : '↓ declining';

  const windowNote =
    totalPoints > recent.length
      ? `last ${recent.length} of ${totalPoints} messages`
      : `${recent.length} message${recent.length > 1 ? 's' : ''}`;

  return `${direction} · ${windowNote}`;
}
