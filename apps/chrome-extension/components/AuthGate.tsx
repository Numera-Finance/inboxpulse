import { useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { useGmailContext } from '../hooks/useGmailContext';
import { useCustomerLookup } from '../hooks/useCustomerLookup';
import { CustomerPanel } from './CustomerPanel';
import { EscalationList } from './EscalationList';
import { EmailStats } from './EmailStats';
import { ContactList } from './ContactList';
import { NoCustomer } from './NoCustomer';
import { RefreshCw, Loader2 } from 'lucide-react';

export function AuthGate(): React.ReactElement {
  const { user, isLoading: authLoading, isAuthenticated, refresh } = useAuth();
  const { senderDomain } = useGmailContext();
  const { customer, isLoading: customerLoading } = useCustomerLookup(
    isAuthenticated ? senderDomain : null,
  );

  // Check for OAuth error in URL params (redirect back from failed login)
  const params = new URLSearchParams(window.location.search);
  const oauthError = params.get('error');

  // Loading auth
  if (authLoading) {
    return (
      <div className="flex flex-col items-center justify-center h-screen gap-3 p-6">
        <Loader2 size={24} className="animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">Checking authentication...</p>
      </div>
    );
  }

  // Not authenticated — show Google sign-in (same as web app)
  if (!isAuthenticated) {
    return <LoginScreen error={oauthError} />;
  }

  // No Gmail context
  if (!senderDomain) {
    return (
      <div className="p-4">
        <Header userName={user?.firstName ?? 'User'} onRefresh={refresh} />
        <div className="mt-8 flex flex-col items-center gap-3 text-center">
          <p className="text-sm text-muted-foreground">
            Open an email in Gmail to see customer data here.
          </p>
        </div>
      </div>
    );
  }

  // Loading customer
  if (customerLoading) {
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

  // No customer found
  if (!customer) {
    return (
      <div className="p-4">
        <Header userName={user?.firstName ?? 'User'} onRefresh={refresh} />
        <NoCustomer domain={senderDomain} />
      </div>
    );
  }

  // Main view with customer data
  return (
    <div className="p-4 space-y-4">
      <Header userName={user?.firstName ?? 'User'} onRefresh={refresh} />
      <CustomerPanel customer={customer} />
      <EscalationList customerId={customer.id} />
      <EmailStats customer={customer} />
      <ContactList customerId={customer.id} />
    </div>
  );
}

/**
 * Login screen — mirrors the web app login page.
 * Clicking "Sign in with Google" navigates the side panel through the
 * OAuth flow: side panel → API → Google → API callback → back to side panel.
 */
function LoginScreen({ error }: { error: string | null }): React.ReactElement {
  const [isLoading, setIsLoading] = useState(false);
  const [localError, setLocalError] = useState<string | null>(() => {
    if (!error) return null;
    if (error === 'unable_to_create_user') {
      return 'Your organization is not registered in this system. Please contact support.';
    }
    return error;
  });

  const handleGoogleSignIn = async (): Promise<void> => {
    setIsLoading(true);
    setLocalError(null);

    try {
      // Ask the background service worker to open a popup window for OAuth.
      // The popup auto-closes when login completes, and the useAuth hook's
      // polling (every 3s) will detect the session cookie automatically.
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
    <div className="flex flex-col items-center justify-center h-screen p-6">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <h2 className="text-xl font-bold text-foreground">
            Sign in to your account
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Use your Google account to continue
          </p>
        </div>

        {localError && (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3">
            <p className="text-xs text-destructive">{localError}</p>
          </div>
        )}

        <button
          onClick={handleGoogleSignIn}
          disabled={isLoading}
          className="w-full flex justify-center items-center gap-3 py-3 px-4 rounded-lg text-sm font-medium text-white bg-[#4285F4] hover:bg-[#3367D6] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {isLoading ? (
            <>
              <Loader2 size={20} className="animate-spin" />
              <span>Signing in...</span>
            </>
          ) : (
            <>
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
              </svg>
              <span>Sign in with Google</span>
            </>
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
        CRM <span className="text-muted-foreground font-normal">| {userName}</span>
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
