import type { Customer, UserWithRole } from '@crm/clients';
import { useQuery } from '@tanstack/react-query';
import { getUserClient, WEB_URL } from '../lib/clients';
import {
  ExternalLink,
  Globe,
  Tag,
  TrendingUp,
  TrendingDown,
  Minus,
  User,
} from 'lucide-react';
import { cn } from '../lib/utils';

interface CustomerHeaderProps {
  customer: Customer;
}

export function CustomerHeader({ customer }: CustomerHeaderProps): React.ReactElement {
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
  const owner = assignedUsers?.[0];

  return (
    <div className="space-y-2">
      {/* Customer name + sentiment + CRM link */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="text-base font-bold truncate">
              {customer.name || customer.domains[0]}
            </h2>
            {customer.sentiment && (
              <span
                className={cn(
                  'flex items-center gap-1 text-xs font-medium shrink-0 rounded-full px-2 py-0.5',
                  sentimentColor,
                )}
              >
                {sentimentIcon}
                {customer.sentiment.value}
              </span>
            )}
          </div>
        </div>
        <a
          href={`${WEB_URL}/customers/${customer.id}`}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-md p-1 text-muted-foreground hover:text-primary hover:bg-accent transition-colors shrink-0"
          title="Open in CRM"
        >
          <ExternalLink size={14} />
        </a>
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

      {/* Owner */}
      {owner && (
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <User size={12} className="shrink-0" />
          <span>
            Owner: <span className="text-foreground font-medium">{owner.firstName} {owner.lastName}</span>
          </span>
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
