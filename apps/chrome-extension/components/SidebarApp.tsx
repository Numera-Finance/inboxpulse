import { useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { useCustomerById } from '../hooks/useCustomerLookup';
import { useThreadCustomer } from '../hooks/useThreadCustomer';
import { useThreadByProvider } from '../hooks/useThreadByProvider';
import { StatsBar } from './StatsBar';
import { ActivityFeed } from './ActivityFeed';
import { FlaggedMessages } from './FlaggedMessages';
import { ThreadSearch } from './ThreadSearch';
import { ThreadTrend } from './ThreadTrend';
import { MessageList } from './MessageList';
import { MessageAnalysis } from './MessageAnalysis';
import { SelectedMessage } from './SelectedMessage';
import { ThreadContact } from './ThreadContact';
import { FieldsSection } from './FieldsSection';
import { NegativeEmailResolution } from './NegativeEmailResolution';
import { ContextDropBar } from './ContextDropBar';
import { SectionGroup } from './Section';
import { sendRuntimeMessage, RUNTIME_GONE_MESSAGE } from '../lib/runtime-guard';
import { RefreshCw, Loader2 } from 'lucide-react';

interface SidebarAppProps {
  /** The external sender's email, used to highlight the matching contact. */
  senderEmail?: string | null;
  /** Gmail message IDs of the messages in the open thread. */
  threadMessageIds?: string[];
  /** Gmail's own id for the open conversation. */
  providerThreadId?: string | null;
}

export function SidebarApp({
  senderEmail,
  threadMessageIds = [],
  providerThreadId = null,
}: SidebarAppProps): React.ReactElement {
  const { user, isLoading: authLoading, isAuthenticated, error: authError, refresh } = useAuth();

  // Resolve the customer authoritatively from the thread's emails (not by domain).
  const {
    customerId,
    threadId: threadIdFromMessages,
    negativeEmails,
    envelopes,
    isLoading: resolving,
  } = useThreadCustomer(isAuthenticated ? threadMessageIds : []);

  // The conversation's own id first, the loaded messages' ids second.
  //
  // Everything thread-scoped hangs off this. Resolving only through message ids
  // made those sections follow the reader's selection — Gmail loads views for a
  // subset of a thread's messages, so opening an email the sync never ingested
  // (typically one of the reader's own) resolved to nothing and the trend and
  // flagged blocks vanished from a conversation that plainly had both.
  const { threadId: threadIdFromProvider, isLoading: resolvingThread } =
    useThreadByProvider(isAuthenticated ? providerThreadId : null);
  const threadId = threadIdFromProvider ?? threadIdFromMessages;
  const { customer, isLoading: customerLoading } = useCustomerById(
    isAuthenticated ? customerId : null,
  );

  // Loading auth
  if (authLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[200px] gap-3 p-6">
        <Loader2 size={24} className="animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">Checking authentication...</p>
      </div>
    );
  }

  // Not authenticated — show Google sign-in.
  //
  // `authError` distinguishes "the session check said no" from "the session
  // check never got an answer". Both land here with isAuthenticated false, and
  // showing a bare "Sign in to get started" for the second case tells an
  // already-signed-in user to do something that will not help. Pass the reason
  // through so the screen can say what actually went wrong.
  if (!isAuthenticated) {
    return <LoginScreen checkError={authError} onRetry={refresh} />;
  }

  // Resolving the thread → customer (useCustomerById is a no-op when customerId is null)
  if (resolving || customerLoading || resolvingThread) {
    return (
      <div className="p-4">
        <Header userName={user?.firstName ?? 'User'} onRefresh={refresh} />
        <div className="mt-6 space-y-3">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      </div>
    );
  }

  // The name the stored thread has for the external sender, used by the USER
  // group when no CRM contact record matches the address.
  const senderName =
    senderEmail
      ? ([...envelopes.values()].find(
          (e) => e.fromEmail?.toLowerCase() === senderEmail.toLowerCase(),
        )?.fromName ?? null)
      : null;

  // No customer linked to this conversation.
  //
  // Trend and flagged messages are thread-scoped, not customer-scoped — the
  // add-on rendered both without any customer, and an early return here hid
  // them whenever the customer lookup came back empty. Keep showing whatever
  // the thread itself can answer; only the customer-scoped blocks below
  // (stats, activity) genuinely need a resolved customer.
  //
  // The group order is deliberate and matches the reading order of the task:
  // what am I looking at (SELECTED) → what did we make of it (ANALYSIS) → who
  // is it from (USER) → what's the wider conversation (THREAD). Narrowest scope
  // first, widest last.
  if (!customer) {
    return (
      <div className="p-4 space-y-6">
        <Header userName={user?.firstName ?? 'User'} onRefresh={refresh} />
        <MessageList threadId={threadId} />
        <ThreadSearch threadId={threadId} />
        <SelectedMessage envelopes={envelopes} />
        <MessageAnalysis threadId={threadId} />
        <SectionGroup title="User">
          <ThreadContact
            customerId={null}
            senderEmail={senderEmail ?? undefined}
            senderName={senderName}
          />
        </SectionGroup>
        <SectionGroup title="Thread">
          <ThreadTrend threadId={threadId} />
          <FlaggedMessages threadId={threadId} />
          <ContextDropBar threadId={threadId} viewerEmail={user?.email} />
        </SectionGroup>
      </div>
    );
  }

  // Main view with customer data
  return (
    <div className="p-4 space-y-6">
      <Header userName={user?.firstName ?? 'User'} onRefresh={refresh} />

      {/* First, because it names what the two message-scoped groups below are
          about. It is also the only way to reach a message that is already
          expanded — Gmail fires nothing when one of those is clicked. */}
      <MessageList threadId={threadId} />
      <ThreadSearch threadId={threadId} />
      <NegativeEmailResolution customerId={customer.id} negativeEmails={negativeEmails} />

      {/* Message-scoped: both groups follow whichever message is SELECTED —
          which is no longer the same thing as "whichever is expanded", now that
          the picker above can name one directly. */}
      <SelectedMessage envelopes={envelopes} />
      <MessageAnalysis threadId={threadId} />

      <SectionGroup title="User">
        <ThreadContact
          customerId={customer.id}
          senderEmail={senderEmail ?? undefined}
          senderName={senderName}
        />
        <StatsBar customer={customer} />
        <ActivityFeed customerId={customer.id} />
      </SectionGroup>

      {/* No "Customer" block. Nothing in the schema ties a customer to a
          THREAD — `email_threads` has no customer column, and the link lives
          per-message on email_participants, where it is derived from the
          participants' domains. So the block named a company on the strength of
          who happened to be on the email, and changed as that changed. The
          customer-scoped blocks that remain (stats, activity, details) are
          labelled by what they show rather than by asserting whose account this
          conversation belongs to. */}
      <SectionGroup title="Thread">
        <ThreadTrend threadId={threadId} />
        <FlaggedMessages threadId={threadId} />
        <ContextDropBar threadId={threadId} viewerEmail={user?.email} />
        <FieldsSection customer={customer} />
      </SectionGroup>
    </div>
  );
}

function LoginScreen({
  checkError,
  onRetry,
}: {
  /** Why the session check failed, if it failed rather than returned "no". */
  checkError?: string | null;
  onRetry?: () => void;
}): React.ReactElement {
  const [isLoading, setIsLoading] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const handleSignIn = async (): Promise<void> => {
    setIsLoading(true);
    setLocalError(null);

    try {
      const response = await sendRuntimeMessage<{ success?: boolean; error?: string }>({
        type: 'LOGIN',
      });
      if (!response) {
        setLocalError(RUNTIME_GONE_MESSAGE);
      } else if (!response.success) {
        setLocalError(response.error ?? 'Login failed. Please try again.');
      }
    } catch {
      setLocalError('Failed to open login window. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-[200px] p-6">
      <div className="w-full max-w-sm space-y-4 text-center">
        <h1 className="text-lg font-semibold text-foreground">InboxPulse</h1>
        <p className="text-sm text-muted-foreground">
          View customer data alongside your Gmail conversations.
        </p>

        {checkError && (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-left space-y-2">
            <p className="text-xs font-medium text-destructive">
              Couldn’t verify your session
            </p>
            <p className="text-xs text-destructive/90">{checkError}</p>
            <p className="text-xs text-muted-foreground">
              If you were already signed in, this is usually the background
              worker having gone idle — retry before signing in again.
            </p>
            {onRetry && (
              <button onClick={onRetry} className="text-xs text-primary hover:underline">
                Retry check
              </button>
            )}
          </div>
        )}

        {localError && (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3">
            <p className="text-xs text-destructive">{localError}</p>
          </div>
        )}

        <button
          onClick={handleSignIn}
          disabled={isLoading}
          className="inline-flex items-center gap-2 text-sm text-primary hover:underline disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isLoading ? (
            <>
              <Loader2 size={14} className="animate-spin" />
              <span>Signing in...</span>
            </>
          ) : (
            <span>Sign in to get started</span>
          )}
        </button>
      </div>
    </div>
  );
}

function Header({
  userName,
  onRefresh,
}: {
  userName: string;
  onRefresh: () => void;
}): React.ReactElement {
  return (
    <div className="flex items-center justify-between">
      <h1 className="text-sm font-semibold text-foreground">
        InboxPulse <span className="text-muted-foreground font-normal">| {userName}</span>
      </h1>
      <button
        onClick={onRefresh}
        className="rounded-md p-1 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
        title="Refresh"
      >
        <RefreshCw size={14} />
      </button>
    </div>
  );
}

function SkeletonCard(): React.ReactElement {
  return (
    <div className="rounded-lg border border-border bg-card p-3 space-y-2 animate-pulse">
      <div className="h-3 w-24 rounded bg-muted" />
      <div className="h-3 w-40 rounded bg-muted" />
    </div>
  );
}
