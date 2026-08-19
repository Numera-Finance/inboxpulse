import { useThreadFlagged, type FlaggedMessage } from '../hooks/useThreadFlagged';
import { Flag, Loader2 } from 'lucide-react';
import { format } from 'date-fns';
import { Block } from './Section';
import { jumpToMessage } from '../lib/gmail-nav';

interface FlaggedMessagesProps {
  /** InboxPulse thread id for the open Gmail conversation. */
  threadId: string | null;
}

/**
 * "Flagged messages" for the open thread, earliest first, each row jumping
 * straight to that message.
 *
 * Unlike the Gmail add-on — which is sandboxed in a side panel and can only
 * hand Gmail a URL to open in a tab or overlay — this runs inside the Gmail
 * page, so setting `location.hash` navigates the conversation in place. Same
 * data, same order; the drill-down is immediate.
 */
export function FlaggedMessages({ threadId }: FlaggedMessagesProps): React.ReactElement | null {
  const { messages, isLoading } = useThreadFlagged(threadId);

  // Nothing flagged is the common case — stay out of the way entirely.
  if (!threadId || (!isLoading && messages.length === 0)) {
    return null;
  }

  return (
    <Block title="Flagged Messages">
      {isLoading ? (
        <div className="flex items-center justify-center py-1">
          <Loader2 size={16} className="animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="space-y-1">
          {messages.map((message) => (
            <FlaggedMessageRow key={message.messageId} message={message} />
          ))}
        </div>
      )}
    </Block>
  );
}

function FlaggedMessageRow({ message }: { message: FlaggedMessage }): React.ReactElement {
  const primary = message.flags[0];
  const who = message.fromName || message.fromEmail;
  const labels = message.flags.map((flag) => flag.label).slice(0, 3).join(' · ');

  return (
    <button
      onClick={() =>
        jumpToMessage({
          messageId: message.messageId,
          fromEmail: message.fromEmail,
          receivedAt: message.receivedAt,
          snippet: message.bodyPreview,
        })
      }
      title={message.subject}
      className="flex items-start gap-2 w-full text-left rounded-md px-2 py-1.5 hover:bg-accent transition-colors"
    >
      <Flag size={12} className="text-destructive mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="text-xs font-medium text-destructive truncate">{labels}</p>
        <p className="text-xs truncate">
          {who}
          {primary?.detail ? <span className="text-muted-foreground"> — {primary.detail}</span> : null}
        </p>
        <p className="text-xs text-muted-foreground">
          {[primary?.provenance, formatDay(message.receivedAt)].filter(Boolean).join(' · ')}
        </p>
      </div>
    </button>
  );
}

function formatDay(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : format(date, 'MMM d, yyyy');
}
