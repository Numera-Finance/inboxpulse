import type { Customer } from '@crm/clients';
import {
  Mail,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  ArrowUpRight,
  Clock,
} from 'lucide-react';
import { cn } from '../lib/utils';

interface EmailStatsProps {
  customer: Customer;
}

export function EmailStats({ customer }: EmailStatsProps): React.ReactElement {
  const stats = [
    {
      label: 'Emails',
      value: customer.emailCount,
      icon: <Mail size={12} />,
      color: 'text-foreground',
    },
    {
      label: 'Positive',
      value: customer.positiveCount,
      icon: <TrendingUp size={12} />,
      color: 'text-success',
    },
    {
      label: 'Escalations',
      value: customer.escalationCount,
      icon: <AlertTriangle size={12} />,
      color: 'text-destructive',
    },
    {
      label: 'Upsell',
      value: customer.upsellCount,
      icon: <ArrowUpRight size={12} />,
      color: 'text-primary',
    },
    {
      label: 'Churn Risk',
      value: customer.churnCount,
      icon: <TrendingDown size={12} />,
      color: 'text-warning',
    },
  ].filter((s) => s.value !== undefined);

  // Don't render if no stats available
  if (stats.length === 0 && customer.averageTat === undefined) {
    return <></>;
  }

  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
        <Mail size={14} className="text-muted-foreground" />
        <h3 className="text-xs font-semibold">Email Stats</h3>
      </div>

      <div className="p-3">
        {stats.length > 0 && (
          <div className="grid grid-cols-3 gap-2">
            {stats.map((stat) => (
              <div key={stat.label} className="text-center">
                <div className={cn('flex items-center justify-center gap-1', stat.color)}>
                  {stat.icon}
                  <span className="text-sm font-semibold">{stat.value}</span>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">{stat.label}</p>
              </div>
            ))}
          </div>
        )}

        {customer.averageTat !== undefined && customer.averageTat !== null && (
          <div className={cn('flex items-center gap-2 text-xs text-muted-foreground', stats.length > 0 && 'mt-2 pt-2 border-t border-border')}>
            <Clock size={12} />
            <span>
              Avg. turnaround: <span className="font-medium text-foreground">{formatTat(customer.averageTat)}</span>
            </span>
          </div>
        )}
      </div>
    </div>
  );
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
