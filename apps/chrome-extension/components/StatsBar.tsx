import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Customer } from '@crm/clients';
import type { RecentEmail } from '../hooks/useRecentEmails';
import { API_BASE_URL } from '../lib/clients';
import { cn } from '../lib/utils';
import { formatDistanceToNow } from 'date-fns';
import { Loader2, Mail } from 'lucide-react';
import { Block } from './Section';
import {
  useCustomerStats,
  statsRangeStart,
  STATS_RANGE_LABELS,
  type StatsRange,
} from '../hooks/useCustomerStats';

interface StatsBarProps {
  customer: Customer;
}

interface StatChip {
  label: string;
  value: string;
  filterKey: string | null;
  filterParams: string;
}

function formatTat(hours: number): string {
  if (hours < 1) {
    return `${Math.round(hours * 60)}m`;
  }
  if (hours < 24) {
    return `${hours.toFixed(1)}h`;
  }
  return `${(hours / 24).toFixed(1)}d`;
}

export function StatsBar({ customer }: StatsBarProps): React.ReactElement {
  const [expandedStat, setExpandedStat] = useState<string | null>(null);
  const [range, setRange] = useState<StatsRange>('all');
  const { stats: ranged, isLoading: rangeLoading, error: rangeError } = useCustomerStats(
    customer.id,
    range,
  );

  // "All time" reads the customer record's rollups — the panel already has them,
  // so there is nothing to fetch. Any narrower range is recomputed from the
  // emails themselves by the API.
  const counts =
    range === 'all'
      ? {
          emailCount: customer.emailCount,
          escalationCount: customer.escalationCount,
          upsellCount: customer.upsellCount,
          churnCount: customer.churnCount,
          positiveCount: customer.positiveCount,
          lastContactDate: customer.lastContactDate ?? null,
        }
      : (ranged ?? undefined);

  // Restrict the drill-down list to the same window the counts describe,
  // otherwise clicking "Churn 12" for last-30-days would open every churn email
  // ever. `dateFrom` is what /api/emails/customer/:id already accepts.
  const rangeParam = range === 'all' ? '' : `&dateFrom=${encodeURIComponent(statsRangeStart(range))}`;

  const chips: StatChip[] = [];

  if (counts?.emailCount !== undefined) {
    chips.push({
      label: 'Emails',
      value: String(counts.emailCount),
      filterKey: 'emails',
      filterParams: `?limit=10${rangeParam}`,
    });
  }

  if (counts?.escalationCount !== undefined) {
    chips.push({
      label: 'Escalations',
      value: String(counts.escalationCount),
      filterKey: counts.escalationCount > 0 ? 'escalations' : null,
      filterParams: `?limit=10&escalation=true${rangeParam}`,
    });
  }

  if (counts?.upsellCount !== undefined) {
    chips.push({
      label: 'Upsell',
      value: String(counts.upsellCount),
      filterKey: counts.upsellCount > 0 ? 'upsell' : null,
      filterParams: `?limit=10&signal=upsell${rangeParam}`,
    });
  }

  if (counts?.churnCount !== undefined) {
    chips.push({
      label: 'Churn',
      value: String(counts.churnCount),
      filterKey: counts.churnCount > 0 ? 'churn' : null,
      filterParams: `?limit=10&signal=churn${rangeParam}`,
    });
  }

  if (counts?.positiveCount !== undefined) {
    chips.push({
      label: 'Positive',
      value: String(counts.positiveCount),
      filterKey: counts.positiveCount > 0 ? 'positive' : null,
      filterParams: `?limit=10&sentiment=positive${rangeParam}`,
    });
  }

  // All-time only. `customers.averageTat` is an all-time rollup and the TAT
  // machinery buckets business-day lag rather than producing a mean, so there is
  // no honest per-range figure to show — better an absent chip than a number
  // that silently ignores the range next to six that don't.
  if (range === 'all' && customer.averageTat !== undefined && customer.averageTat !== null) {
    chips.push({
      label: 'Avg TAT',
      value: formatTat(Number(customer.averageTat)),
      filterKey: null,
      filterParams: '',
    });
  }

  if (counts?.lastContactDate) {
    chips.push({
      label: 'Last Email',
      value: formatDistanceToNow(new Date(counts.lastContactDate), { addSuffix: true }),
      filterKey: null,
      filterParams: '',
    });
  }

  const handleChipClick = (chip: StatChip): void => {
    if (!chip.filterKey) return;
    setExpandedStat((prev) => (prev === chip.filterKey ? null : chip.filterKey));
  };

  return (
    <Block title="Stats">
      <div className="space-y-2">
        {/* Range picker. Changing it re-reads the counts from the emails
            themselves rather than the customer's all-time rollups. */}
        <div className="flex items-center gap-2">
          <label htmlFor="stats-range" className="text-xs text-muted-foreground">
            Range
          </label>
          <select
            id="stats-range"
            value={range}
            onChange={(e) => {
              setRange(e.target.value as StatsRange);
              // The open drill-down describes the previous window; close it
              // rather than leave a list that no longer matches its chip.
              setExpandedStat(null);
            }}
            className="flex-1 rounded-md border border-border bg-background px-2 py-1 text-xs"
          >
            {(Object.keys(STATS_RANGE_LABELS) as StatsRange[]).map((key) => (
              <option key={key} value={key}>
                {STATS_RANGE_LABELS[key]}
              </option>
            ))}
          </select>
        </div>

        {rangeError && (
          <p className="text-xs text-destructive">{rangeError}</p>
        )}

        {rangeLoading && chips.length === 0 ? (
          <div className="flex items-center justify-center py-3">
            <Loader2 size={16} className="animate-spin text-muted-foreground" />
          </div>
        ) : chips.length === 0 ? (
          <p className="text-xs text-muted-foreground">No activity in this range.</p>
        ) : (
        <div className={cn('grid grid-cols-2 gap-1.5', rangeLoading && 'opacity-50')}>
          {chips.map((chip) => {
            const isClickable = chip.filterKey !== null;
            const isActive = expandedStat === chip.filterKey;

            return (
              <button
                key={chip.label}
                onClick={() => handleChipClick(chip)}
                disabled={!isClickable}
                className={cn(
                  'flex items-center justify-between rounded-md border px-2.5 py-1.5 text-xs transition-colors',
                  isClickable
                    ? 'cursor-pointer hover:bg-accent'
                    : 'cursor-default opacity-60',
                  isActive
                    ? 'border-primary bg-primary/5'
                    : 'border-border',
                )}
              >
                <span className="text-muted-foreground">{chip.label}</span>
                <span className={cn('font-medium', isActive ? 'text-primary' : 'text-foreground')}>
                  {chip.value}
                </span>
              </button>
            );
          })}
        </div>
        )}

        {expandedStat && (
          <FilteredEmailList
            customerId={customer.id}
            filterKey={expandedStat}
            filterParams={chips.find((c) => c.filterKey === expandedStat)?.filterParams ?? '?limit=10'}
          />
        )}
      </div>
    </Block>
  );
}

interface FilteredEmailListProps {
  customerId: string;
  filterKey: string;
  filterParams: string;
}

function FilteredEmailList({
  customerId,
  filterKey,
  filterParams,
}: FilteredEmailListProps): React.ReactElement {
  const { data: emails, isLoading } = useQuery<RecentEmail[]>({
    // filterParams, not just filterKey: the params now carry the selected date
    // range, and keying on the chip alone would serve last-90-days' cached list
    // under a last-7-days heading.
    queryKey: ['emails', 'filtered', customerId, filterKey, filterParams],
    queryFn: async () => {
      const response = await fetch(
        `${API_BASE_URL}/api/emails/customer/${encodeURIComponent(customerId)}${filterParams}`,
        { credentials: 'include' },
      );
      if (!response.ok) {
        throw new Error(`Failed to fetch emails: ${response.statusText}`);
      }
      const json = (await response.json()) as {
        success: boolean;
        data?: { emails: RecentEmail[] };
      };
      return json.data?.emails ?? [];
    },
    staleTime: 60_000,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-3">
        <Loader2 size={16} className="animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!emails || emails.length === 0) {
    return <p className="text-xs text-muted-foreground py-2">No emails found</p>;
  }

  const handleEmailClick = (messageId: string): void => {
    window.location.hash = `#inbox/${messageId}`;
  };

  return (
    <div className="space-y-1 border-t border-border pt-2">
      {emails.map((email) => (
        <button
          key={email.id}
          onClick={() => handleEmailClick(email.messageId)}
          className="flex items-start gap-2 w-full text-left rounded-md px-2 py-1.5 hover:bg-accent transition-colors"
        >
          <Mail size={12} className="text-muted-foreground mt-0.5 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-xs truncate">{email.subject}</p>
            <p className="text-xs text-muted-foreground">
              {formatDistanceToNow(new Date(email.receivedAt), { addSuffix: true })}
            </p>
          </div>
        </button>
      ))}
    </div>
  );
}
