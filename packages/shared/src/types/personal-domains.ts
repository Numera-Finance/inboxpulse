/**
 * Canonical list of personal email providers (consumer-grade webmail).
 * The email pipeline uses this to skip auto-creating customers for these
 * domains — addresses on these domains belong to individuals, not companies.
 *
 * Single source of truth — both apps/analysis (extraction time) and
 * apps/api (validation / contact handling) import from here so the list
 * cannot drift.
 */
export const PERSONAL_DOMAINS = new Set([
  'gmail.com',
  'googlemail.com',
  'outlook.com',
  'hotmail.com',
  'live.com',
  'msn.com',
  'yahoo.com',
  'yahoo.co.uk',
  'yahoo.co.in',
  'ymail.com',
  'aol.com',
  'icloud.com',
  'me.com',
  'mac.com',
  'protonmail.com',
  'proton.me',
  'zoho.com',
  'mail.com',
  'gmx.com',
  'gmx.net',
  'fastmail.com',
  'tutanota.com',
  'hey.com',
  'email.com',
]);

/** Returns true when the email's domain is a known personal-email provider. */
export function isPersonalEmailDomain(domain: string | null | undefined): boolean {
  if (!domain) return false;
  return PERSONAL_DOMAINS.has(domain.toLowerCase());
}
