import { useRecentEmails } from '../hooks/useRecentEmails';
import { Mail, Loader2 } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { Block } from './Section';

interface ActivityFeedProps {
  customerId: string;
}

export function ActivityFeed({ customerId }: ActivityFeedProps): React.ReactElement {
  const { emails, isLoading } = useRecentEmails(customerId);

  return (
    <Block title="Recent Activity">
      {isLoading ? (
        <div className="flex items-center justify-center py-3">
          <Loader2 size={16} className="animate-spin text-muted-foreground" />
        </div>
      ) : emails.length === 0 ? (
        <p className="text-xs text-muted-foreground">No recent emails</p>
      ) : (
        <div className="space-y-1">
          {emails.map((email) => (
            <button
              key={email.id}
              onClick={() => { window.location.hash = `#inbox/${email.messageId}`; }}
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
      )}
    </Block>
  );
}
