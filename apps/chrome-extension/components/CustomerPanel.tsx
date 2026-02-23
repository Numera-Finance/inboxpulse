import type { Customer } from '@crm/clients';
import { useQuery } from '@tanstack/react-query';
import { getUserClient } from '../lib/clients';
import {
  Building2,
  Globe,
  Tag,
  TrendingUp,
  TrendingDown,
  Minus,
  Users,
} from 'lucide-react';
import { cn } from '../lib/utils';
import type { UserWithRole } from '@crm/clients';

interface CustomerPanelProps {
  customer: Customer;
}

export function CustomerPanel({ customer }: CustomerPanelProps): React.ReactElement {
  const { data: assignedUsers } = useQuery<UserWithRole[]>({
    queryKey: ['users', 'by-customer', customer.id],
    queryFn: async () => {
      const client = getUserClient();
      return client.getByCustomer(customer.id);
    },
    staleTime: 60_000,
  });

  const sentimentIcon = getSentimentIcon(customer.sentiment?.value);
  const sentimentColor = getSentimentColor(customer.sentiment?.value);

  return (
    <div className="rounded-lg border border-border bg-card p-3 space-y-3">
      {/* Customer name & sentiment */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Building2 size={16} className="text-primary shrink-0" />
          <h2 className="text-sm font-semibold truncate">
            {customer.name || customer.domains[0]}
          </h2>
        </div>
        {customer.sentiment && (
          <div
            className={cn(
              'flex items-center gap-1 text-xs font-medium shrink-0 rounded-full px-2 py-0.5',
              sentimentColor,
            )}
          >
            {sentimentIcon}
            {customer.sentiment.value}
          </div>
        )}
      </div>

      {/* Domains */}
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Globe size={12} className="shrink-0" />
        <span className="truncate">{customer.domains.join(', ')}</span>
      </div>

      {/* Labels */}
      {customer.labels && customer.labels.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap">
          <Tag size={12} className="text-muted-foreground shrink-0" />
          {customer.labels.map((label) => (
            <span
              key={label}
              className="inline-flex rounded-full bg-secondary px-2 py-0.5 text-xs text-secondary-foreground"
            >
              {label}
            </span>
          ))}
        </div>
      )}

      {/* Counts row */}
      <div className="flex items-center gap-4 text-xs text-muted-foreground pt-1 border-t border-border">
        {customer.emailCount !== undefined && (
          <span>{customer.emailCount} emails</span>
        )}
        {customer.escalationCount !== undefined && (
          <span className="text-destructive font-medium">
            {customer.escalationCount} escalations
          </span>
        )}
        {customer.contactCount !== undefined && (
          <span>{customer.contactCount} contacts</span>
        )}
      </div>

      {/* Assigned team */}
      {assignedUsers && assignedUsers.length > 0 && (
        <div className="pt-1 border-t border-border">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1.5">
            <Users size={12} />
            <span className="font-medium">Assigned team</span>
          </div>
          <div className="flex flex-wrap gap-1">
            {assignedUsers.map((user) => (
              <span
                key={user.id}
                className="inline-flex rounded-full bg-accent px-2 py-0.5 text-xs text-accent-foreground"
              >
                {user.firstName} {user.lastName}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function getSentimentIcon(
  sentiment: string | undefined,
): React.ReactElement | null {
  switch (sentiment) {
    case 'positive':
      return <TrendingUp size={12} />;
    case 'negative':
      return <TrendingDown size={12} />;
    case 'neutral':
      return <Minus size={12} />;
    default:
      return null;
  }
}

function getSentimentColor(sentiment: string | undefined): string {
  switch (sentiment) {
    case 'positive':
      return 'bg-success/10 text-success';
    case 'negative':
      return 'bg-destructive/10 text-destructive';
    case 'neutral':
      return 'bg-muted text-muted-foreground';
    default:
      return '';
  }
}
