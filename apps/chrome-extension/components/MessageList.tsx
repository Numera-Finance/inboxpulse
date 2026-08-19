import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { ChevronDown, Check, CloudDownload, Loader2 } from 'lucide-react';
import { format } from 'date-fns';
import {
  getActiveMessageSnapshot,
  subscribeActiveMessage,
  selectMessage,
} from '../lib/active-message-store';
import {
  getThreadMessagesSnapshot,
  subscribeThreadMessages,
} from '../lib/thread-messages-store';
import { buildMessageList, type ListEntry } from '../lib/thread-message-list';
import { useThreadMessages } from '../hooks/useThreadMessages';
import { jumpToMessage } from '../lib/gmail-nav';
import { cn } from '../lib/utils';

interface MessageListProps {
  /** InboxPulse thread id for the open conversation, or null if unresolved. */
  threadId: string | null;
}

/**
 * The message picker — a drop bar naming every message in the open conversation.
 *
 * Sits above everything else because it is the panel's subject line: the two
 * blocks under it ("Selected" and "Analysis") describe whichever message this
 * names, so the reader needs to see which one that is before reading either.
 *
 * It exists because expanding a message in Gmail was the only way to choose one,
 * and that stops working the moment a reader has several open — clicking an
 * already-expanded message fires no view state change, so there was no way back
 * to it. The flagged list and the search box both create that state, which made
 * the panel's own drill-downs the thing that broke selection. A list the reader
 * picks from doesn't care what is expanded.
 *
 * The list is the CRM's thread joined to Gmail's — see lib/thread-message-list.
 * Neither source is complete on its own, and the failures are opposite: the CRM
 * is missing the reader's own replies, Gmail is missing whatever sits inside an
 * unopened run. A row the CRM has and Gmail has not rendered is still offered,
 * marked as such, and still selectable.
 */
export function MessageList({ threadId }: MessageListProps): React.ReactElement | null {
  const rendered = useSyncExternalStore(
    subscribeThreadMessages,
    getThreadMessagesSnapshot,
    getThreadMessagesSnapshot,
  );
  const active = useSyncExternalStore(
    subscribeActiveMessage,
    getActiveMessageSnapshot,
    getActiveMessageSnapshot,
  );
  // Eager and envelope-only. The picker is the first thing the reader looks at,
  // so waiting for intent the way the search box does would mean the list
  // visibly filling in underneath them.
  const { messages: stored, truncated } = useThreadMessages(threadId, true, false);

  const entries = useMemo(
    () => buildMessageList(rendered, stored),
    [rendered, stored],
  );

  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    /**
     * Close on a click anywhere else — including anywhere in Gmail.
     *
     * `composedPath()`, not `contains(event.target)`: the panel lives in a shadow
     * root, so a listener on the document sees every click inside it retargeted
     * to the host element. Testing containment against that target reports the
     * menu's own rows as outside clicks and shuts the menu before the row's
     * handler ever runs.
     */
    const onPointerDown = (event: Event): void => {
      const path = event.composedPath?.() ?? [];
      if (containerRef.current && path.includes(containerRef.current)) return;
      setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false);
    };

    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown, true);
    };
  }, [open]);

  // Nothing to pick between. The panel's other sections already say what state
  // the thread is in, so an empty picker would only add a second voice.
  if (entries.length === 0) return null;

  const current = entries.find((entry) => entry.id === active?.id) ?? null;

  const handlePick = (entry: ListEntry): void => {
    // Select first, then navigate. The selection is the point — the jump has to
    // unfold runs and match rows and may still come up short, and the panel must
    // be describing the message the reader chose either way.
    selectMessage(entry.selection);
    setOpen(false);

    jumpToMessage({
      messageId: entry.id,
      fromEmail: entry.stored?.fromEmail ?? entry.selection.fromEmail,
      receivedAt: entry.stored?.receivedAt ?? null,
      // Only ever present on a stored row, and only when something else fetched
      // the bodies — the picker asks for envelopes alone. revealMessage falls
      // back to sender and time without it.
      snippet: entry.stored?.bodyPreview ?? null,
    });
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((wasOpen) => !wasOpen)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Select a message in this conversation"
        className="flex w-full items-center gap-2 rounded-md border border-border bg-background px-2 py-1.5 text-left hover:bg-accent transition-colors focus:outline-none focus:ring-1 focus:ring-primary"
      >
        <div className="min-w-0 flex-1">
          {current ? (
            <div className="flex items-baseline gap-1.5 text-xs">
              <span className="shrink-0 font-medium">{current.sender}</span>
              <span className="truncate text-muted-foreground">{current.subject}</span>
            </div>
          ) : (
            <span className="text-xs text-muted-foreground">
              Select a message ({entries.length})
            </span>
          )}
        </div>
        <ChevronDown
          size={14}
          className={cn(
            'shrink-0 text-muted-foreground transition-transform',
            open && 'rotate-180',
          )}
        />
      </button>

      {open && (
        <div
          role="listbox"
          className="absolute left-0 right-0 top-full z-50 mt-1 max-h-80 overflow-y-auto rounded-md border border-border bg-background py-1 shadow-lg"
        >
          {entries.map((entry) => (
            <MessageRow
              key={entry.id}
              entry={entry}
              selected={entry.id === active?.id}
              onPick={handlePick}
            />
          ))}

          {/* The stored side of the list has a ceiling the API sets. Saying so
              is the difference between a short list and a wrong one. */}
          {truncated && (
            <p className="border-t border-border/60 px-2 py-1.5 text-xs text-muted-foreground">
              This conversation has more messages than the panel lists.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function MessageRow({
  entry,
  selected,
  onPick,
}: {
  entry: ListEntry;
  selected: boolean;
  onPick: (entry: ListEntry) => void;
}): React.ReactElement {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      onClick={() => onPick(entry)}
      title={entry.subject}
      className={cn(
        'flex w-full items-start gap-2 px-2 py-1.5 text-left hover:bg-accent transition-colors',
        selected && 'bg-accent/60',
      )}
    >
      {/* The tick keeps its column whether or not it's drawn, so the senders
          line up down the left edge instead of the selected row jutting out. */}
      <Check
        size={12}
        className={cn('mt-0.5 shrink-0 text-primary', !selected && 'invisible')}
      />
      <div className="min-w-0 flex-1 space-y-0.5">
        <div className="flex items-baseline justify-between gap-2">
          <span className="truncate text-xs font-medium">{entry.sender}</span>
          <span className="shrink-0 text-xs text-muted-foreground">
            {formatDay(entry.receivedAt)}
          </span>
        </div>
        <p className="truncate text-xs text-muted-foreground">{entry.subject}</p>
        {/* Marked, not hidden and not greyed into unusability: the message is
            real, the CRM has it, and picking it works — Gmail just has to
            unfold a run first, which takes a moment and a network round trip
            the reader is owed warning of. */}
        {!entry.loaded && (
          <p className="flex items-center gap-1 text-xs text-muted-foreground">
            <CloudDownload size={11} className="shrink-0" />
            Not loaded in this thread yet
          </p>
        )}
      </div>
    </button>
  );
}

function formatDay(receivedAt: number | null): string {
  if (receivedAt === null) return '';
  const date = new Date(receivedAt);
  return Number.isNaN(date.getTime()) ? '' : format(date, 'MMM d');
}
