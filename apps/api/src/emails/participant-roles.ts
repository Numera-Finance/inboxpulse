import { resolveCustomerKeyForEmail } from '@crm/shared';
import { isFromTenantDomain } from './converter';

/**
 * Role of an email participant relative to the tenant being analysed.
 *
 * Analyses like sentiment are written in terms of "us" and "the customer", but
 * the LLM has no way to derive either from raw addresses. Roles are resolved
 * here — deterministically, from tenant domains and curated customer records —
 * and rendered into the prompt so the model reads them instead of guessing.
 *
 * - `us`                — address is on one of the tenant's own domains.
 * - `customer`          — address maps to a curated customer (a customer row a
 *                         human has confirmed, i.e. `is_auto_created = false`).
 * - `unknown_external`  — every other external address. This deliberately
 *                         covers the auto-created customer shells the ingestion
 *                         pipeline mints for *every* participant domain: those
 *                         rows prove only that an address appeared on an email,
 *                         not that the sender is a client. Vendors, prospects
 *                         and the customer's own counterparties all land here.
 *
 * The `unknown_external` tier exists so the labelling degrades safely: a real
 * client nobody has curated yet is still weighed as a possible customer by the
 * prompt, rather than being silently demoted to "third party" and losing all
 * sentiment sensitivity.
 */
export type ParticipantRole = 'us' | 'customer' | 'unknown_external';

/** A single address on the roster, with its resolved role. */
export interface RosterEntry {
  email: string;
  name?: string;
  role: ParticipantRole;
}

/** Minimal address shape shared by the `Email` type and DB email rows. */
export interface AddressLike {
  email: string;
  name?: string;
}

/**
 * Anything carrying email addresses. Covers both shapes the pipeline holds:
 * the shared `Email` type (`from: { email, name }`) and raw DB email rows
 * (`fromEmail` / `fromName` columns).
 */
export interface AddressSource {
  from?: AddressLike | null;
  fromEmail?: string | null;
  fromName?: string | null;
  tos?: AddressLike[] | null;
  ccs?: AddressLike[] | null;
  bccs?: AddressLike[] | null;
}

/**
 * Read every address off a source, in From → To → Cc → Bcc order.
 * Addresses are returned as they appear; de-duplication is the caller's job.
 */
export function collectAddresses(source: AddressSource): AddressLike[] {
  const addresses: AddressLike[] = [];

  // The shared Email type nests the sender; DB rows store it as two columns.
  const fromEmail = source.from?.email ?? source.fromEmail;
  if (fromEmail) {
    const fromName = source.from?.name ?? source.fromName;
    addresses.push({ email: fromEmail, name: fromName || undefined });
  }

  for (const group of [source.tos, source.ccs, source.bccs]) {
    for (const addr of group || []) {
      if (addr?.email) {
        addresses.push({ email: addr.email, name: addr.name || undefined });
      }
    }
  }

  return addresses;
}

/**
 * The `customer_domains.domain` keys for every address across the given
 * sources. Feed these to {@link CustomerService.findCuratedDomains} to learn
 * which of them belong to curated customers.
 *
 * Uses the same resolver as extraction and contact-ensure, so the keys line up
 * with what is actually stored in `customer_domains` (top-level domain for
 * corporate addresses, per-address pseudo-domain for personal ones).
 */
export function customerDomainKeysFor(sources: AddressSource[]): string[] {
  const keys = new Set<string>();

  for (const source of sources) {
    for (const addr of collectAddresses(source)) {
      const key = resolveCustomerKeyForEmail(addr.email, addr.name);
      if (key) keys.add(key.domain);
    }
  }

  return [...keys];
}

/**
 * Resolve one address to a role. Tenant domains win over customer records: a
 * tenant address that also happens to have a contact row is still `us`.
 */
export function resolveParticipantRole(
  emailAddress: string,
  tenantDomains: string[] | null | undefined,
  curatedCustomerDomains: ReadonlySet<string>
): ParticipantRole {
  if (isFromTenantDomain(emailAddress, tenantDomains)) {
    return 'us';
  }

  const key = resolveCustomerKeyForEmail(emailAddress);
  if (key && curatedCustomerDomains.has(key.domain)) {
    return 'customer';
  }

  return 'unknown_external';
}

/**
 * Build the participant roster for a set of messages.
 *
 * Scope is deliberately narrow: only addresses that actually appear on the
 * messages being sent to the model. The roster is never a dump of the tenant's
 * contacts or customer list — that would cost tokens and leak unrelated
 * customers into the prompt.
 *
 * Addresses are de-duplicated case-insensitively, keeping the first display
 * name seen for each (headers frequently omit the name on later turns).
 */
export function buildParticipantRoster(
  sources: AddressSource[],
  tenantDomains: string[] | null | undefined,
  curatedCustomerDomains: ReadonlySet<string>
): RosterEntry[] {
  const byAddress = new Map<string, RosterEntry>();

  for (const source of sources) {
    for (const addr of collectAddresses(source)) {
      const normalized = addr.email.toLowerCase().trim();
      if (!normalized) continue;

      const existing = byAddress.get(normalized);
      if (existing) {
        // Fill in a name only if we didn't already have one.
        if (!existing.name && addr.name) existing.name = addr.name;
        continue;
      }

      byAddress.set(normalized, {
        email: normalized,
        name: addr.name,
        role: resolveParticipantRole(normalized, tenantDomains, curatedCustomerDomains),
      });
    }
  }

  return [...byAddress.values()];
}

/** Prompt-facing label for a role. */
export function roleLabel(role: ParticipantRole): string {
  switch (role) {
    case 'us':
      return 'US';
    case 'customer':
      return 'CUSTOMER';
    case 'unknown_external':
      return 'UNKNOWN_EXTERNAL';
  }
}

/**
 * Render an address list as `name <email> [ROLE]`, for the per-message To/Cc
 * lines in thread context.
 */
export function formatAddressesWithRoles(
  addresses: AddressLike[] | null | undefined,
  roles: ReadonlyMap<string, ParticipantRole>
): string {
  if (!addresses?.length) return '';

  return addresses
    .filter((addr) => !!addr?.email)
    .map((addr) => {
      const normalized = addr.email.toLowerCase().trim();
      const role = roles.get(normalized);
      const label = role ? ` [${roleLabel(role)}]` : '';
      return addr.name ? `${addr.name} <${normalized}>${label}` : `${normalized}${label}`;
    })
    .join(', ');
}

/** Index a roster by lowercased address, for per-message rendering. */
export function rosterRoleMap(roster: RosterEntry[]): Map<string, ParticipantRole> {
  return new Map(roster.map((entry) => [entry.email, entry.role]));
}

/**
 * Render the roster block that heads the prompt. Returns an empty string for an
 * empty roster so callers can concatenate unconditionally.
 */
export function formatRosterBlock(roster: RosterEntry[]): string {
  if (!roster.length) return '';

  const lines = roster.map((entry) => {
    const name = entry.name ? ` ${entry.name}` : '';
    return `  ${entry.email}${name} [${roleLabel(entry.role)}]`;
  });

  return `Participants:\n${lines.join('\n')}`;
}
