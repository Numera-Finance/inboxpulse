/**
 * "(Auto)" suffix marker used for names of records auto-created by the
 * email-ingestion pipeline (customers, users, etc.). Single source of
 * truth — `withAutoSuffix` is the only entry point. The suffix is
 * searchable in the UI and shows up in exports — intentional.
 */
const AUTO_NAME_SUFFIX = ' (Auto)';
const AUTO_SUFFIX_LOWER = AUTO_NAME_SUFFIX.toLowerCase();
/** Whitespace-tolerant fallback — catches "Foo(Auto)" without a leading space. */
const AUTO_SUFFIX_LOWER_TIGHT = AUTO_NAME_SUFFIX.trim().toLowerCase();

/**
 * Naive customer-name inference from a domain. Single source of truth for
 * both apps/analysis (extraction time) and apps/api (last-resort customer
 * creation in the email transaction).
 *
 *   acme-corp.com → "Acme Corp"
 *   global-tech-solutions.io → "Global Tech Solutions"
 *
 * Falls back to the raw domain if the first label is empty (defensive — the
 * caller should never pass an empty/malformed domain, but this is the safest
 * thing if they do).
 */
export function inferCustomerNameFromDomain(domain: string): string {
  if (!domain) return domain;
  const namePart = domain.split('.')[0];
  if (!namePart) return domain;
  return namePart
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

/**
 * Build the stored name for an auto-created record from a base name.
 * Always returns at least the "(Auto)" marker — callers don't need a
 * fallback for empty input. Idempotent: never double-appends, including
 * when the input already carries the suffix in any common formatting
 * (with or without the leading space, any letter case).
 */
export function withAutoSuffix(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return AUTO_NAME_SUFFIX.trim();
  const lower = trimmed.toLowerCase();
  if (lower.endsWith(AUTO_SUFFIX_LOWER) || lower.endsWith(AUTO_SUFFIX_LOWER_TIGHT)) {
    return trimmed; // already suffixed; don't double-append
  }
  return `${trimmed}${AUTO_NAME_SUFFIX}`;
}
