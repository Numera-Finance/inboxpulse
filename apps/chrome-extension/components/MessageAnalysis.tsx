import { useSyncExternalStore } from 'react';
import {
  getActiveMessageSnapshot,
  subscribeActiveMessage,
} from '../lib/active-message-store';
import { useThreadFlagged, type FlaggedFlag } from '../hooks/useThreadFlagged';
import { useThreadTrend, type Sentiment } from '../hooks/useThreadTrend';
import { SENTIMENT_CLASS, SENTIMENT_LABEL } from '../lib/sentiment';
import { Block, SectionGroup } from './Section';
import { cn } from '../lib/utils';

interface MessageAnalysisProps {
  /** InboxPulse thread id for the open conversation. */
  threadId: string | null;
}

/**
 * "Analysis" — churn risk and sentiment for the ONE message currently selected.
 *
 * This is the message-scoped half of the panel: it swaps as the reader picks a
 * different email, while the customer, trend and flagged list stay pinned to the
 * thread. Churn and sentiment get named blocks of their own because they are the
 * two verdicts the reader actually came for; anything else the analysis found is
 * still shown, but underneath, rather than competing for the same attention the
 * way the old undifferentiated flag list did.
 *
 * Both readings come from data the panel has already fetched for the thread —
 * the flagged set and the sentiment trend — so switching messages is instant and
 * costs no network. The two sources are not interchangeable: the flagged set
 * carries sentiment only when it is NEGATIVE (that being the only sentiment
 * worth flagging), so reading sentiment from it alone would report every neutral
 * and positive message as unanalysed. The trend has a point per scored message,
 * which is why sentiment is read from there.
 */
export function MessageAnalysis({ threadId }: MessageAnalysisProps): React.ReactElement {
  const active = useSyncExternalStore(
    subscribeActiveMessage,
    getActiveMessageSnapshot,
    getActiveMessageSnapshot,
  );
  const { messages, isLoading: flaggedLoading } = useThreadFlagged(threadId);
  const { points, isLoading: trendLoading } = useThreadTrend(threadId);

  const isLoading = flaggedLoading || trendLoading;
  const flags: FlaggedFlag[] = active
    ? (messages.find((m) => m.messageId === active.id)?.flags ?? [])
    : [];

  const churn = flags.find((flag) => flag.type === 'churn');
  const negative = flags.find((flag) => flag.type === 'negative');
  const other = flags.filter((flag) => flag.type !== 'churn' && flag.type !== 'negative');
  const sentiment: Sentiment | null = active
    ? (points.find((p) => p.messageId === active.id)?.sentiment ?? null)
    : null;

  return (
    <SectionGroup title="Analysis" hint="(churn risk and sentiment)">
      {!active ? (
        <Block>
          <p className="text-xs text-muted-foreground">No message selected.</p>
        </Block>
      ) : isLoading ? (
        <Block>
          <p className="text-xs text-muted-foreground">Loading analysis…</p>
        </Block>
      ) : (
        <>
          <Block title="Churn risk">
            {churn ? (
              <div className="space-y-1">
                <Badge className={CHURN_CLASS[churn.level ?? ''] ?? 'bg-muted text-muted-foreground'}>
                  {churn.level ? capitalize(churn.level) : churn.label}
                </Badge>
                <p className="text-xs text-muted-foreground">
                  {churn.detail ?? 'No reason recorded.'}
                </p>
                <p className="text-xs text-muted-foreground">{churn.provenance}</p>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">Not assessed on this message.</p>
            )}
          </Block>

          <Block title="Sentiment">
            {sentiment ? (
              <div className="space-y-1">
                <div className="flex items-center gap-1.5">
                  <span className={cn('h-3 w-3 rounded-sm', SENTIMENT_CLASS[sentiment])} />
                  <span className="text-sm font-medium">{SENTIMENT_LABEL[sentiment]}</span>
                </div>
                {/* Only a negative reading carries a reason — see the note above. */}
                {negative && (
                  <>
                    <p className="text-xs text-muted-foreground">
                      {negative.detail ?? 'No reason recorded.'}
                    </p>
                    <p className="text-xs text-muted-foreground">{negative.provenance}</p>
                  </>
                )}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">Not assessed on this message.</p>
            )}
          </Block>

          {other.length > 0 && (
            <Block title="Other signals">
              <div className="space-y-2">
                {other.map((flag, i) => (
                  <div key={`${flag.type}-${i}`} className="space-y-0.5">
                    <p className="text-xs font-semibold">{flag.label}</p>
                    <p className="text-xs text-muted-foreground">
                      {flag.detail ?? 'No reason recorded.'}
                    </p>
                    <p className="text-xs text-muted-foreground">{flag.provenance}</p>
                  </div>
                ))}
              </div>
            </Block>
          )}
        </>
      )}
    </SectionGroup>
  );
}

/** Risk levels as stored on email_analyses.risk_level. */
const CHURN_CLASS: Record<string, string> = {
  low: 'bg-success/10 text-success',
  medium: 'bg-orange-500/10 text-orange-600',
  high: 'bg-destructive/10 text-destructive',
  critical: 'bg-destructive text-destructive-foreground',
};

function Badge({
  className,
  children,
}: {
  className: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <span
      className={cn(
        'inline-flex rounded-full px-2 py-0.5 text-xs font-medium',
        className,
      )}
    >
      {children}
    </span>
  );
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
