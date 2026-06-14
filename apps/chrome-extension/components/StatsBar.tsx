import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Customer } from '@crm/clients';
import type { RecentEmail } from '../hooks/useRecentEmails';
import { API_BASE_URL } from '../lib/clients';
import { cn } from '../lib/utils';
import { formatDistanceToNow } from 'date-fns';
import { Loader2, Mail } from 'lucide-react';

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

  const chips: StatChip[] = [];

  if (customer.emailCount !== undefined) {
    chips.push({
      label: 'Emails',
      value: String(customer.emailCount),
      filterKey: 'emails',
      filterParams: '?limit=10',
    });
  }

  if (customer.escalationCount !== undefined) {
    chips.push({
      label: 'Escalations',
      value: String(customer.escalationCount),
      filterKey: customer.escalationCount > 0 ? 'escalations' : null,
      filterParams: '?limit=10&escalation=true',
    });
  }

  if (customer.upsellCount !== undefined) {
    chips.push({
      label: 'Upsell',
      value: String(customer.upsellCount),
      filterKey: customer.upsellCount > 0 ? 'upsell' : null,
      filterParams: '?limit=10&signal=upsell',
    });
  }

  if (customer.churnCount !== undefined) {
    chips.push({
      label: 'Churn',
      value: String(customer.churnCount),
      filterKey: customer.churnCount > 0 ? 'churn' : null,
      filterParams: '?limit=10&signal=churn',
    });
  }

  if (customer.positiveCount !== undefined) {
    chips.push({
      label: 'Positive',
      value: String(customer.positiveCount),
      filterKey: customer.positiveCount > 0 ? 'positive' : null,
      filterParams: '?limit=10&sentiment=positive',
    });
  }

  if (customer.averageTat !== undefined && customer.averageTat !== null) {
    chips.push({
      label: 'Avg TAT',
      value: formatTat(Number(customer.averageTat)),
      filterKey: null,
      filterParams: '',
    });
  }

  if (customer.lastContactDate) {
    chips.push({
      label: 'Last Email',
      value: formatDistanceToNow(new Date(customer.lastContactDate), { addSuffix: true }),
      filterKey: null,
      filterParams: '',
    });
  }

  if (chips.length === 0) {
    return <></>;
  }

  const handleChipClick = (chip: StatChip): void => {
    if (!chip.filterKey) return;
    setExpandedStat((prev) => (prev === chip.filterKey ? null : chip.filterKey));
  };

  return (
    <div className="space-y-2">
      <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
        Stats
      </h3>

      <div className="grid grid-cols-2 gap-1.5">
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

      {expandedStat && (
        <FilteredEmailList
          customerId={customer.id}
          filterKey={expandedStat}
          filterParams={chips.find((c) => c.filterKey === expandedStat)?.filterParams ?? '?limit=10'}
        />
      )}
    </div>
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
    queryKey: ['emails', 'filtered', customerId, filterKey],
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
