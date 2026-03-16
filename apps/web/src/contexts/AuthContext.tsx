import { createContext, useContext, useEffect, useState, ReactNode, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import LogRocket from 'logrocket';
import { authClient, getSession, signOut } from '../lib/auth';
import { authService } from '@/lib/auth/auth-service';
import { Permission, hasPermission, isAdmin, type PermissionType } from '@crm/shared';

interface User {
  id: string;
  email: string;
  name?: string | null;
  image?: string | null;
  emailVerified?: boolean;
  tenantId?: string | null; // Custom field stored in better_auth_user table
  createdAt?: Date;
  updatedAt?: Date;
}

interface Session {
  user: User;
  session: {
    id: string;
    expiresAt: Date;
  };
}

interface AuthContextType {
  user: User | null;
  session: Session | null;
  permissions: number[];
  isLoading: boolean;
  isAdmin: boolean;
  hasPermission: (permission: PermissionType) => boolean;
  signOut: () => Promise<void>;
  refreshSession: () => Promise<void>;
}

// Re-export Permission for convenience
export { Permission } from '@crm/shared';
export type { PermissionType } from '@crm/shared';

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// API URL for fetching user permissions
const API_URL = (window as any).__RUNTIME_CONFIG__?.API_URL
  || import.meta.env.VITE_API_URL
  || 'http://localhost:4001';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [permissions, setPermissions] = useState<number[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const navigate = useNavigate();

  // Fetch user permissions from the API (user's role permissions)
  const fetchPermissions = async (): Promise<number[]> => {
    try {
      const response = await fetch(`${API_URL}/api/users/me/permissions`, {
        credentials: 'include',
      });
      if (response.ok) {
        const data = await response.json();
        return data.data?.permissions || [];
      }
    } catch (error) {
      console.error('Failed to fetch permissions:', error);
    }
    return [];
  };

  const refreshSession = async () => {
    try {
      const result = await getSession();
      if (result?.data?.user) {
        const userData = result.data.user as User;
        setUser(userData);
        setSession(result.data as Session);
        // Keep authService in sync for components that use it directly
        authService.setSession({
          userId: userData.id,
          tenantId: userData.tenantId || '',
          email: userData.email,
          name: userData.name || undefined,
        });

        // Identify user in LogRocket
        LogRocket.identify(userData.id, {
          name: userData.name || '',
          email: userData.email,
        });

        // Fetch user permissions
        const userPermissions = await fetchPermissions();
        setPermissions(userPermissions);
      } else {
        setUser(null);
        setSession(null);
        setPermissions([]);
        authService.clearSession();
      }
    } catch (error) {
      console.error('Failed to get session:', error);
      setUser(null);
      setSession(null);
      setPermissions([]);
      authService.clearSession();
    } finally {
      setIsLoading(false);
    }
  };

  const handleSignOut = async () => {
    try {
      await signOut();
      setUser(null);
      setSession(null);
      setPermissions([]);
      authService.clearSession();
      navigate('/login');
    } catch (error) {
      console.error('Failed to sign out:', error);
    }
  };

  // Permission check helper
  const checkPermission = useCallback((permission: PermissionType): boolean => {
    return hasPermission(permissions, permission);
  }, [permissions]);

  // Admin check
  const userIsAdmin = isAdmin(permissions);

  useEffect(() => {
    // Check session on mount
    refreshSession();

    // Set up periodic session refresh (every 5 minutes)
    const interval = setInterval(() => {
      refreshSession();
    }, 5 * 60 * 1000);

    return () => clearInterval(interval);
  }, []);

  // Handle auth success/error from URL params (after OAuth callback)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const authStatus = params.get('auth');
    
    if (authStatus === 'success') {
      // Clear the URL param
      window.history.replaceState({}, '', window.location.pathname);
      // Refresh session
      refreshSession();
    } else if (authStatus === 'error') {
      const errorMessage = params.get('message') || 'Authentication failed';
      console.error('Auth error:', errorMessage);
      // Clear the URL param
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        permissions,
        isLoading,
        isAdmin: userIsAdmin,
        hasPermission: checkPermission,
        signOut: handleSignOut,
        refreshSession,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
