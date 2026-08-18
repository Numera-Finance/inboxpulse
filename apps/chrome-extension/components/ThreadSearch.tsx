import { useMemo, useState } from 'react';
import { Search, X, Loader2 } from 'lucide-react';
import { format } from 'date-fns';
import { useThreadMessages, type ThreadMessage } from '../hooks/useThreadMessages';
import { jumpToMessage } from '../lib/gmail-nav';

/** How many matches to list before saying "and N more". */
const MAX_RESULTS = 20;
/** Characters of context shown either side of a match in the body. */
const SNIPPET_PADDING = 70;

interface ThreadSearchProps {
  /** InboxPulse thread id for the open conversation, or null if unresolved. */
  threadId: string | null;
}

/**
 * Find one message inside the open conversation.
 *
 * Sits at the top of the Thread tab because it's a way of navigating the thread
 * rather than another thing the panel reports about it — everything below is
 * "here is what we know", this is "take me to the one I mean".
 *
 * Matching includes the message text, which is the whole point: inside a single
 * conversation every message carries the same subject, so sender and subject
 * alone would only ever narrow a long thread to "the ones from Nina". Picking a
 * result jumps Gmail's thread pane to that message.
 */
export function ThreadSearch({ threadId }: ThreadSearchProps): React.ReactElement | null {
  const [query, setQuery] = useState('');
  // Nothing is fetched until the reader shows intent. The thread's full text is
  // the largest thing this panel can ask for, and most readers never search;
  // focusing the box is early enough that results are ready by the first
  // keystroke, and the query is cached for the rest of the thread.
  const [engaged, setEngaged] = useState(false);

  const { messages, isLoading, error, truncated } = useThreadMessages(threadId, engaged);

  const terms = useMemo(
    () => query.toLowerCase().split(/\s+/).filter(Boolean),
    [query],
  );

  const results = useMemo(
    () => (terms.length === 0 ? [] : messages.filter((m) => matches(m, terms))),
    [messages, terms],
  );

  const searching = terms.length > 0;
  // Either the thread never resolved to a stored conversation, or it resolved to
  // one the CRM holds no messages for. Both mean the same thing to the reader.
  const nothingToSearch = !threadId || messages.length === 0;

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search
          size={14}
          className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
        />
        {/* type="text", not "search": Chrome draws its own clear affordance on a
            search input, which would sit next to the one below in a different
            style. */}
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setEngaged(true)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setQuery('');
          }}
          placeholder="Search this conversation"
          aria-label="Search this conversation"
          className="w-full rounded-md border border-border bg-background py-1.5 pl-7 pr-7 text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
        />
        {query && (
          <button
            onClick={() => setQuery('')}
            aria-label="Clear search"
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            <X size={14} />
          </button>
        )}
      </div>

      {searching && isLoading && (
        <div className="flex items-center gap-2 px-1 py-1">
          <Loader2 size={14} className="animate-spin text-muted-foreground" />
          <span className="text-xs text-muted-foreground">Reading this conversation…</span>
        </div>
      )}

      {searching && error && <p className="px-1 text-xs text-destructive">{error}</p>}

      {searching && !isLoading && !error && (
        <div className="space-y-1">
          {/* "Nothing stored" and "nothing matched" are different answers and
              the reader acts on them differently — one is worth retrying with
              other words, the other is not. Never show both. */}
          {nothingToSearch ? (
            <p className="px-1 text-xs text-muted-foreground">
              None of this conversation’s messages are stored in the CRM, so there is
              nothing to search here.
            </p>
          ) : results.length === 0 ? (
            <p className="px-1 text-xs text-muted-foreground">
              No messages match “{query.trim()}”.
            </p>
          ) : (
            <>
              {results.slice(0, MAX_RESULTS).map((message) => (
                <SearchResultRow key={message.messageId} message={message} terms={terms} />
              ))}
              {results.length > MAX_RESULTS && (
                <p className="px-1 pt-1 text-xs text-muted-foreground">
                  and {results.length - MAX_RESULTS} more
                </p>
              )}
              {/* Sits with the results because it qualifies a count the reader
                  would otherwise read as the whole conversation. */}
              {truncated && (
                <p className="px-1 pt-1 text-xs text-muted-foreground">
                  Only the first {messages.length} messages of this conversation were
                  searched.
                </p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function SearchResultRow({
  message,
  terms,
}: {
  message: ThreadMessage;
  terms: string[];
}): React.ReactElement {
  const who = message.fromName || message.fromEmail;
  const snippet = buildSnippet(message, terms);

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
      className="flex w-full flex-col gap-0.5 rounded-md px-2 py-1.5 text-left hover:bg-accent transition-colors"
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate text-xs font-medium">{who}</span>
        <span className="shrink-0 text-xs text-muted-foreground">
          {formatDay(message.receivedAt)}
        </span>
      </div>
      <p className="text-xs text-muted-foreground break-words">
        <Highlighted text={snippet} terms={terms} />
      </p>
    </button>
  );
}

/** Every term must appear somewhere in the message — narrowing, not ranking. */
function matches(message: ThreadMessage, terms: string[]): boolean {
  const haystack = [
    message.fromName ?? '',
    message.fromEmail,
    message.subject,
    message.bodyPreview ?? '',
  ]
    .join('\n')
    .toLowerCase();
  return terms.every((term) => haystack.includes(term));
}

/**
 * The line shown under the sender: the text around the first term that hit the
 * body, falling back to the subject when the match was on the envelope.
 */
function buildSnippet(message: ThreadMessage, terms: string[]): string {
  const body = message.bodyPreview?.replace(/\s+/g, ' ').trim();
  if (body) {
    const lower = body.toLowerCase();
    const hit = terms
      .map((term) => lower.indexOf(term))
      .filter((index) => index >= 0)
      .sort((a, b) => a - b)[0];
    if (hit !== undefined) {
      const start = Math.max(0, hit - SNIPPET_PADDING);
      const end = Math.min(body.length, hit + SNIPPET_PADDING);
      return `${start > 0 ? '…' : ''}${body.slice(start, end).trim()}${end < body.length ? '…' : ''}`;
    }
  }
  return message.subject || '(no subject)';
}

/**
 * Mark the matched terms inside a snippet.
 *
 * Built by splitting on a term-matching regex rather than by writing HTML: the
 * terms are the reader's own input, and this text goes into Gmail's page.
 */
function Highlighted({ text, terms }: { text: string; terms: string[] }): React.ReactElement {
  const pattern = terms.filter(Boolean).map(escapeRegExp).join('|');
  if (!pattern) return <>{text}</>;

  const parts = text.split(new RegExp(`(${pattern})`, 'gi'));
  return (
    <>
      {parts.map((part, index) =>
        terms.includes(part.toLowerCase()) ? (
          <span key={index} className="rounded bg-primary/20 text-foreground">
            {part}
          </span>
        ) : (
          <span key={index}>{part}</span>
        ),
      )}
    </>
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function formatDay(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : format(date, 'MMM d, yyyy');
}
