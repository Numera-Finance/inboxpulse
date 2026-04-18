/**
 * Suffix appended to the stored name of customers that were auto-created
 * (e.g., by the email-pipeline domain-extraction or refined later from a
 * signature's company field). The suffix is searchable in the UI and shows
 * up in exports — that's intentional.
 *
 * Single source of truth — both the create path (apps/analysis
 * domain-extraction) and the update-from-signature path (apps/api
 * analysis-service) import this so the suffix can't drift.
 */
export const AUTO_CUSTOMER_NAME_SUFFIX = ' (Auto)';

/** Lowercase form used for case-insensitive suffix detection. Single source. */
const AUTO_SUFFIX_LOWER = AUTO_CUSTOMER_NAME_SUFFIX.toLowerCase();
/** Whitespace-tolerant fallback — catches "Foo(Auto)" without a leading space. */
const AUTO_SUFFIX_LOWER_TIGHT = AUTO_CUSTOMER_NAME_SUFFIX.trim().toLowerCase();

/**
 * Build the stored name for an auto-created customer from a base name.
 * Idempotent: never double-appends, including when the input already carries
 * the suffix in any common formatting (with or without the leading space, any
 * letter case).
 */
export function withAutoCustomerSuffix(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return trimmed;
  const lower = trimmed.toLowerCase();
  if (lower.endsWith(AUTO_SUFFIX_LOWER) || lower.endsWith(AUTO_SUFFIX_LOWER_TIGHT)) {
    return trimmed; // already suffixed; don't double-append
  }
  return `${trimmed}${AUTO_CUSTOMER_NAME_SUFFIX}`;
}
