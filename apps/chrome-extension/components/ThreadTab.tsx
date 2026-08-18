import { useSyncExternalStore } from 'react';
import { PlugZap } from 'lucide-react';
import { SidebarApp } from './SidebarApp';
import {
  getThreadSnapshot,
  subscribeThread,
  type ThreadState,
} from '../lib/thread-store';
import {
  getRuntimeGoneSnapshot,
  subscribeRuntimeGone,
  RUNTIME_GONE_MESSAGE,
} from '../lib/runtime-guard';

/**
 * The "Thread" tab of the global sidebar panel.
 *
 * Wraps SidebarApp so it re-renders as the reader moves between conversations,
 * instead of being torn down and rebuilt per thread the way the old per-thread
 * panel was. When Gmail is showing a list view there is no thread to describe,
 * so we render a prompt rather than SidebarApp's "no customer" state — the
 * distinction matters: one means "nothing open", the other means "open, but
 * unrecognised".
 *
 * `key` on SidebarApp is the thread identity. Remounting on thread change is
 * intentional: SidebarApp's hooks hold per-thread resolution state, and reusing
 * the instance across threads would show the previous customer's data during
 * the next thread's resolve.
 */
export function ThreadTab(): React.ReactElement {
  const thread: ThreadState = useSyncExternalStore(
    subscribeThread,
    getThreadSnapshot,
    getThreadSnapshot,
  );
  const runtimeGone = useSyncExternalStore(
    subscribeRuntimeGone,
    getRuntimeGoneSnapshot,
    getRuntimeGoneSnapshot,
  );

  // The extension was reloaded, updated, or disabled while this tab stayed
  // open. A content script cannot re-attach to a new extension context, so this
  // is terminal for the panel — say so plainly instead of rendering a view whose
  // every request will fail with a network error that blames the API.
  if (runtimeGone) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[200px] gap-2 p-6 text-center">
        <PlugZap size={20} className="text-muted-foreground" />
        <p className="text-sm font-medium">InboxPulse disconnected</p>
        <p className="text-xs text-muted-foreground">{RUNTIME_GONE_MESSAGE}</p>
        <button
          onClick={() => window.location.reload()}
          className="mt-1 text-xs text-primary hover:underline"
        >
          Reload now
        </button>
      </div>
    );
  }

  if (!thread.hasThread) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[200px] gap-2 p-6 text-center">
        <p className="text-sm text-muted-foreground">No conversation open</p>
        <p className="text-xs text-muted-foreground">
          Open an email to see its customer, sentiment history, and flagged messages.
        </p>
      </div>
    );
  }

  return (
    <SidebarApp
      // Keyed on the conversation, not on the message ids it has loaded so far.
      // Those ids grow as Gmail builds views, and re-keying on them remounted
      // the panel mid-read — discarding any drill-down state and re-running
      // every query. Falls back to the id list only when Gmail hasn't given us
      // a thread id.
      key={thread.providerThreadId ?? thread.threadMessageIds.join(',') ?? 'empty'}
      senderEmail={thread.senderEmail}
      threadMessageIds={thread.threadMessageIds}
      providerThreadId={thread.providerThreadId}
    />
  );
}
