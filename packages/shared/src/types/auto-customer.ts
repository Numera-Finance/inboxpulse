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

/** Build the stored name for an auto-created customer from a base name. */
export function withAutoCustomerSuffix(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return trimmed;
  if (trimmed.toLowerCase().endsWith(AUTO_CUSTOMER_NAME_SUFFIX.toLowerCase().trim())) {
    return trimmed; // already suffixed; don't double-append
  }
  return `${trimmed}${AUTO_CUSTOMER_NAME_SUFFIX}`;
}
