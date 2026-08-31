/**
 * The "Panel" tab — the Workspace add-on's own cards, rendered in the extension.
 *
 * Same shape as ThreadTab: subscribe to lib/thread-store so the contextual card
 * follows the reader between conversations, and stand down loudly when the
 * extension context dies.
 *
 * Two deliberate differences from ThreadTab:
 *
 *  - NO "no conversation open" early return. The homepage card is the whole
 *    point of this tab and is firm-wide — it has plenty to say with no thread
 *    open, which is exactly when someone opens a panel to ask "where are the
 *    fires".
 *
 *  - NOT keyed on the thread. CardView re-fetches when the ids change, and
 *    remounting would throw away the homepage card — which does not depend on
 *    the thread at all — every time the reader clicked a different email.
 */

import { useSyncExternalStore } from 'react';
import { PlugZap } from 'lucide-react';
import { CardView } from './CardView';
import { getThreadSnapshot, subscribeThread, type ThreadState } from '../lib/thread-store';
import { getViewerEmail } from '../lib/viewer-store';
import {
  getRuntimeGoneSnapshot,
  subscribeRuntimeGone,
  RUNTIME_GONE_MESSAGE,
} from '../lib/runtime-guard';

export function CardTab(): React.ReactElement {
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

  // The extension was reloaded, updated or disabled while this tab stayed open.
  // A content script cannot re-attach to a new extension context, so every
  // request from here on fails with a network error that blames the add-on.
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

  return (
    <CardView
      providerThreadId={thread.providerThreadId}
      // The store holds every loaded message id; the contextual card wants the
      // one message. Gmail builds views for a subset of a thread, so the first
      // is simply the earliest one loaded — the add-on resolves the thread from
      // either id anyway.
      providerMessageId={thread.threadMessageIds[0] ?? null}
      viewerEmail={getViewerEmail()}
    />
  );
}
