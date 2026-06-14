import { inferCustomerNameFromDomain } from './auto-customer';

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

/**
 * Convert a personal-email address into a stable pseudo-domain so it can flow
 * through the same customer/domain plumbing as corporate addresses. The local
 * part is joined to the provider with `-`, so each personal address ends up
 * with its own customer row that a user can later merge into a real one.
 *
 *   uzi.dutta@gmail.com → uzi.dutta-gmail.com
 *   ALICE+work@yahoo.com → alice+work-yahoo.com
 *
 * Returns null for input that lacks both halves of an email address.
 */
export function personalEmailToPseudoDomain(email: string | null | undefined): string | null {
  if (!email) return null;
  const trimmed = email.trim().toLowerCase();
  const at = trimmed.indexOf('@');
  if (at <= 0 || at === trimmed.length - 1) return null;
  const local = trimmed.slice(0, at);
  const domain = trimmed.slice(at + 1);
  return `${local}-${domain}`;
}

/**
 * Shape returned by `resolveCustomerKeyForEmail`. Both the extraction side
 * (Step 1, apps/analysis) and the contact-ensure side (Step 2, apps/api) use
 * it so that personal- vs. corporate-email branching lives in exactly one
 * place.
 */
export interface CustomerKeyForEmail {
  /**
   * Value stored in `customer_domains.domain` — the top-level domain for
   * corporate addresses, or a per-address pseudo-domain for personal ones.
   */
  domain: string;
  /** Fallback customer name used when no signature company is known yet. */
  defaultName: string;
}

/**
 * Single source of truth for mapping an email address → the (domain,
 * defaultName) pair we key customers on. Call this wherever the pipeline
 * needs to know "which customer does this participant belong to" — both the
 * pure extraction step and the in-transaction contact upsert.
 */
export function resolveCustomerKeyForEmail(
  email: string | null | undefined,
  headerName?: string | null
): CustomerKeyForEmail | null {
  if (!email) return null;
  const rawDomain = email.split('@')[1]?.toLowerCase();
  if (!rawDomain) return null;

  if (isPersonalEmailDomain(rawDomain)) {
    const domain = personalEmailToPseudoDomain(email);
    if (!domain) return null;
    const defaultName = headerName?.trim() || inferNameFromEmailLocalPart(email);
    return { domain, defaultName };
  }

  const parts = rawDomain.split('.');
  const domain = parts.length >= 2 ? parts.slice(-2).join('.') : rawDomain;
  return { domain, defaultName: inferCustomerNameFromDomain(domain) };
}

/**
 * Produce a human-readable default customer name from the local part of an
 * email address. Splits on common separators (`. _ -`) and title-cases each
 * segment.
 *
 *   uzi.dutta@gmail.com   → "Uzi Dutta"
 *   john_doe@yahoo.com    → "John Doe"
 *   firstname-lastname@…  → "Firstname Lastname"
 *
 * Falls back to the raw local part when nothing splittable is present, and to
 * the original string when there's no `@`.
 */
export function inferNameFromEmailLocalPart(email: string | null | undefined): string {
  if (!email) return '';
  const trimmed = email.trim();
  const at = trimmed.indexOf('@');
  if (at === 0) return '';
  const local = at > 0 ? trimmed.slice(0, at) : trimmed;
  if (!local) return '';
  const segments = local.split(/[._\-+]+/).filter(Boolean);
  if (segments.length === 0) return local;
  return segments
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
}
