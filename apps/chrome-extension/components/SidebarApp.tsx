import { useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { useCustomerById } from '../hooks/useCustomerLookup';
import { useThreadCustomer } from '../hooks/useThreadCustomer';
import { CustomerHeader } from './CustomerHeader';
import { StatsBar } from './StatsBar';
import { ContactList } from './ContactList';
import { ActivityFeed } from './ActivityFeed';
import { FieldsSection } from './FieldsSection';
import { NegativeEmailResolution } from './NegativeEmailResolution';
import { NoCustomer } from './NoCustomer';
import { RefreshCw, Loader2 } from 'lucide-react';

interface SidebarAppProps {
  /** The external sender's email, used to highlight the matching contact. */
  senderEmail?: string | null;
  /** Gmail message IDs of the messages in the open thread. */
  threadMessageIds?: string[];
}

export function SidebarApp({
  senderEmail,
  threadMessageIds = [],
}: SidebarAppProps): React.ReactElement {
  const { user, isLoading: authLoading, isAuthenticated, refresh } = useAuth();

  // Resolve the customer authoritatively from the thread's emails (not by domain).
  const {
    customerId,
    negativeEmails,
    isLoading: resolving,
  } = useThreadCustomer(isAuthenticated ? threadMessageIds : []);
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

  // Not authenticated — show Google sign-in
  if (!isAuthenticated) {
    return <LoginScreen />;
  }

  // Resolving the thread → customer (useCustomerById is a no-op when customerId is null)
  if (resolving || customerLoading) {
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

  // No customer linked to this conversation
  if (!customer) {
    return (
      <div className="p-4">
        <Header userName={user?.firstName ?? 'User'} onRefresh={refresh} />
        <NoCustomer label={senderEmail ?? undefined} />
      </div>
    );
  }

  // Main view with customer data
  return (
    <div className="p-4 space-y-4">
      <Header userName={user?.firstName ?? 'User'} onRefresh={refresh} />
      <NegativeEmailResolution customerId={customer.id} negativeEmails={negativeEmails} />
      <CustomerHeader customer={customer} />
      <hr className="border-border" />
      <StatsBar customer={customer} />
      <hr className="border-border" />
      <ContactList customerId={customer.id} senderEmail={senderEmail ?? undefined} />
      <hr className="border-border" />
      <ActivityFeed customerId={customer.id} />
      <FieldsSection customer={customer} />
    </div>
  );
}

function LoginScreen(): React.ReactElement {
  const [isLoading, setIsLoading] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const handleSignIn = async (): Promise<void> => {
    setIsLoading(true);
    setLocalError(null);

    try {
      const response = await chrome.runtime.sendMessage({ type: 'LOGIN' });
      if (!response?.success) {
        setLocalError(response?.error ?? 'Login failed. Please try again.');
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
