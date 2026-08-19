/**
 * Gmail OAuth configuration
 * Shared between API (for requesting scopes) and web (for displaying permissions)
 */

export interface OAuthScope {
  url: string;
  description: string;
}

/**
 * Gmail OAuth scopes with human-readable descriptions
 */
export const GMAIL_OAUTH_SCOPES: OAuthScope[] = [
  {
    url: 'https://www.googleapis.com/auth/gmail.readonly',
    description: 'Read your emails (read-only)',
  },
  {
    // Write access — required to create InboxPulse labels and apply them to
    // messages (labels.create + messages.modify). Grants read/write to the
    // mailbox but NOT permanent delete. Enables surfacing analysis flags as
    // native Gmail labels in the inbox.
    url: 'https://www.googleapis.com/auth/gmail.modify',
    description: 'Apply InboxPulse labels to your emails (create + label messages)',
  },
  {
    url: 'https://www.googleapis.com/auth/userinfo.email',
    description: 'Access your email address',
  },
  {
    url: 'https://www.googleapis.com/auth/userinfo.profile',
    description: 'Access your basic profile info',
  },
];

/**
 * Get just the scope URLs for OAuth requests
 */
export const GMAIL_SCOPE_URLS = GMAIL_OAUTH_SCOPES.map((scope) => scope.url);

/**
 * Get just the descriptions for UI display
 */
export const GMAIL_SCOPE_DESCRIPTIONS = GMAIL_OAUTH_SCOPES.map((scope) => scope.description);
