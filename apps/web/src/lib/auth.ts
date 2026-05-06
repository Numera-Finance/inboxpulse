import { createAuthClient } from 'better-auth/client';
import { inferAdditionalFields } from 'better-auth/client/plugins';

// Better-auth client configuration
// baseURL should point to the API server
// Use runtime config (Docker) or build-time env (dev)
const API_URL = (window as any).__RUNTIME_CONFIG__?.API_URL
  || import.meta.env.VITE_API_URL
  || 'http://localhost:4001';

export const authClient = createAuthClient({
  baseURL: API_URL,
  fetchOptions: {
    credentials: 'include', // Required for cross-origin cookies
  },
  plugins: [
    inferAdditionalFields({
      user: {
        // Custom field added via customSession plugin on server
        tenantId: {
          type: 'string',
          required: false,
        },
      },
    }),
  ],
});

// Only allow same-origin relative paths to prevent open-redirect attacks.
function safeRelativePath(path: string | null | undefined): string {
  if (!path) return '/';
  if (!path.startsWith('/') || path.startsWith('//')) return '/';
  return path;
}

// Export convenience methods
export const signInWithGoogle = async (next?: string | null) => {
  // Pass callbackURL to redirect back to web app after OAuth
  const webUrl = import.meta.env.VITE_WEB_URL || window.location.origin;
  const target = safeRelativePath(next);
  return authClient.signIn.social({
    provider: 'google',
    callbackURL: `${webUrl}${target}`, // Redirect back to intended page on success
    errorCallbackURL: `${webUrl}/login`, // Redirect to login page on error (with error params)
  });
};

export const signOut = async () => {
  return authClient.signOut();
};

export const getSession = async () => {
  return authClient.getSession();
};
