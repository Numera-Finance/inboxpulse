import { useState } from 'react';
import { ChevronRight, Loader2, Search, ExternalLink } from 'lucide-react';
import { useThreadContext } from '../hooks/useThreadContext';
import { jumpToThread } from '../lib/gmail-nav';

interface ContextDropBarProps {
  /** InboxPulse thread id for the open conversation, or null if unresolved. */
  threadId: string | null;
  /** Mailbox to search. A tenant may have several connected. */
  viewerEmail?: string | null;
}

/**
 * Other conversations that give context for the one on screen.
 *
 * Collapsed by default, and the collapse is load-bearing rather than cosmetic:
 * expanding runs a live Gmail search plus a metadata fetch per candidate, which
 * is far too much to spend on every conversation a reader passes through. The
 * request is not made until the bar is opened — see `useThreadContext`.
 *
 * Picking a result opens that conversation in Gmail. Unlike everything else in
 * this panel, the target is not in the thread already rendered, so it navigates
 * by route rather than by revealing a row — see `jumpToThread`.
 */
export function ContextDropBar({
  threadId,
  viewerEmail,
}: ContextDropBarProps): React.ReactElement {
  const [open, setOpen] = useState(false);
  const { candidates, intent, reason, isLoading, error } = useThreadContext(
    threadId,
    open,
    viewerEmail,
  );

  return (
    <div className="border-t border-border/60 first:border-t-0">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-1.5 py-2 text-left"
      >
        <ChevronRight
          size={14}
          className={`shrink-0 text-muted-foreground transition-transform ${open ? 'rotate-90' : ''}`}
        />
        <Search size={13} className="shrink-0 text-muted-foreground" />
        <h3 className="flex-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Related context
        </h3>
        {open && !isLoading && candidates.length > 0 && (
          <span className="text-xs font-normal normal-case text-muted-foreground">
            {candidates.length}
          </span>
        )}
        {open && isLoading && <Loader2 size={13} className="animate-spin text-muted-foreground" />}
      </button>

      {open && (
        <div className="pb-3 space-y-2">
          {/* What the analysis decided it was looking for. Shown because a list
              of other threads is otherwise unexplained — it tells the reader on
              what basis these were chosen, and makes a bad match legible as a
              bad match rather than as a broken panel. */}
          {intent && !isLoading && (
            <p className="text-xs italic text-muted-foreground">{intent}</p>
          )}

          {isLoading && (
            <p className="text-xs text-muted-foreground">Searching your mailbox…</p>
          )}

          {error && <p className="text-xs text-destructive">{error}</p>}

          {!isLoading && !error && candidates.length === 0 && (
            <p className="text-xs text-muted-foreground">
              {reason ?? 'No related conversations found.'}
            </p>
          )}

          {candidates.map((c) => (
            <button
              key={c.messageId}
              onClick={() => jumpToThread(c.threadId)}
              className="group flex w-full flex-col gap-0.5 rounded-md border border-border/60 p-2 text-left transition-colors hover:border-primary/40 hover:bg-accent"
            >
              <div className="flex items-start gap-1.5">
                <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">
                  {c.subject}
                </span>
                <ExternalLink
                  size={11}
                  className="mt-0.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
                />
              </div>
              <div className="flex items-baseline gap-1.5 text-xs text-muted-foreground">
                <span className="min-w-0 truncate">{displayName(c.from)}</span>
                <span className="shrink-0">·</span>
                <span className="shrink-0">{shortDate(c.date)}</span>
              </div>
              {c.snippet && (
                <p className="line-clamp-2 text-xs text-muted-foreground/80">{c.snippet}</p>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** `Nina Patel <nina@acme.com>` → `Nina Patel`; a bare address is left alone. */
function displayName(from: string): string {
  const named = from.match(/^\s*"?([^"<]+?)"?\s*</);
  return named ? named[1].trim() : from.replace(/[<>]/g, '').trim();
}

/** RFC 2822 dates are too long for this row; show day and month only. */
function shortDate(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}
