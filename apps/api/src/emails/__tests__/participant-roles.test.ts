import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import {
  buildParticipantRoster,
  collectAddresses,
  customerDomainKeysFor,
  formatAddressesWithRoles,
  formatRosterBlock,
  resolveParticipantRole,
  rosterRoleMap,
  type AddressSource,
} from '../participant-roles';

const TENANT_DOMAINS = ['mystartupcfo.com'];

describe('resolveParticipantRole', () => {
  const curated = new Set(['acme-client.com']);

  it('labels tenant addresses as us', () => {
    expect(resolveParticipantRole('mbala@mystartupcfo.com', TENANT_DOMAINS, curated)).toBe('us');
  });

  it('is case-insensitive on the tenant domain', () => {
    expect(resolveParticipantRole('MBala@MyStartupCFO.com', TENANT_DOMAINS, curated)).toBe('us');
  });

  it('labels curated customer domains as customer', () => {
    expect(resolveParticipantRole('jonathan@acme-client.com', TENANT_DOMAINS, curated)).toBe(
      'customer'
    );
  });

  it('matches curated customers on the top-level domain, not the subdomain', () => {
    expect(resolveParticipantRole('ap@billing.acme-client.com', TENANT_DOMAINS, curated)).toBe(
      'customer'
    );
  });

  // The ingestion pipeline auto-creates a customer row for EVERY participant
  // domain it sees. Those rows are excluded from `curated`, so a vendor that
  // merely appeared on a thread must not be promoted to `customer`.
  it('labels an uncurated external domain as unknown_external', () => {
    expect(resolveParticipantRole('regina@talapparel.com', TENANT_DOMAINS, curated)).toBe(
      'unknown_external'
    );
  });

  it('prefers us over customer when a tenant address is also a curated domain', () => {
    const overlapping = new Set(['mystartupcfo.com']);
    expect(resolveParticipantRole('mbala@mystartupcfo.com', TENANT_DOMAINS, overlapping)).toBe(
      'us'
    );
  });

  it('falls back to unknown_external when tenant domains are unconfigured', () => {
    expect(resolveParticipantRole('mbala@mystartupcfo.com', undefined, new Set())).toBe(
      'unknown_external'
    );
  });
});

describe('collectAddresses', () => {
  it('reads the nested sender shape used by the Email type', () => {
    const source: AddressSource = {
      from: { email: 'a@x.com', name: 'A' },
      tos: [{ email: 'b@y.com' }],
    };
    expect(collectAddresses(source)).toEqual([
      { email: 'a@x.com', name: 'A' },
      { email: 'b@y.com', name: undefined },
    ]);
  });

  it('reads the flat sender columns used by DB email rows', () => {
    const source: AddressSource = {
      fromEmail: 'a@x.com',
      fromName: 'A',
      ccs: [{ email: 'c@z.com' }],
    };
    expect(collectAddresses(source)).toEqual([
      { email: 'a@x.com', name: 'A' },
      { email: 'c@z.com', name: undefined },
    ]);
  });

  it('skips missing groups and blank addresses', () => {
    const source: AddressSource = { tos: null, ccs: [{ email: '' }], bccs: undefined };
    expect(collectAddresses(source)).toEqual([]);
  });
});

describe('buildParticipantRoster', () => {
  // The TAL Apparel case: a vendor presses the tenant's client for payment and
  // copies the tenant. The vendor must not read as a customer.
  const vendorThread: AddressSource[] = [
    {
      from: { email: 'reginacheung@talapparel.com', name: 'Regina Cheung' },
      tos: [{ email: 'sukikong@talapparel.com' }, { email: 'jonathan@acme-client.com', name: 'Jonathan Tang' }],
      ccs: [{ email: 'mbala@mystartupcfo.com', name: 'Manju Bala' }],
    },
  ];

  it('assigns a role to every address on the message', () => {
    const roster = buildParticipantRoster(vendorThread, TENANT_DOMAINS, new Set(['acme-client.com']));

    expect(roster).toEqual([
      { email: 'reginacheung@talapparel.com', name: 'Regina Cheung', role: 'unknown_external' },
      { email: 'sukikong@talapparel.com', name: undefined, role: 'unknown_external' },
      { email: 'jonathan@acme-client.com', name: 'Jonathan Tang', role: 'customer' },
      { email: 'mbala@mystartupcfo.com', name: 'Manju Bala', role: 'us' },
    ]);
  });

  it('deduplicates across messages, case-insensitively', () => {
    const roster = buildParticipantRoster(
      [
        { from: { email: 'Jonathan@Acme-Client.com', name: 'Jonathan Tang' } },
        { from: { email: 'jonathan@acme-client.com' }, tos: [{ email: 'JONATHAN@acme-client.com' }] },
      ],
      TENANT_DOMAINS,
      new Set(['acme-client.com'])
    );

    expect(roster).toHaveLength(1);
    expect(roster[0]).toEqual({
      email: 'jonathan@acme-client.com',
      name: 'Jonathan Tang',
      role: 'customer',
    });
  });

  it('backfills a display name from a later message that carries one', () => {
    const roster = buildParticipantRoster(
      [
        { from: { email: 'jonathan@acme-client.com' } },
        { from: { email: 'jonathan@acme-client.com', name: 'Jonathan Tang' } },
      ],
      TENANT_DOMAINS,
      new Set()
    );

    expect(roster[0].name).toBe('Jonathan Tang');
  });

  it('returns an empty roster when there are no addresses', () => {
    expect(buildParticipantRoster([], TENANT_DOMAINS, new Set())).toEqual([]);
  });

  // Roster scope is the thread, not the tenant: nothing may appear that was not
  // on one of the messages handed in.
  it('includes only addresses present on the given messages', () => {
    const roster = buildParticipantRoster(
      [{ from: { email: 'a@x.com' }, tos: [{ email: 'b@y.com' }] }],
      TENANT_DOMAINS,
      new Set(['unrelated-customer.com'])
    );

    expect(roster.map((r) => r.email)).toEqual(['a@x.com', 'b@y.com']);
  });
});

describe('customerDomainKeysFor', () => {
  it('collapses corporate addresses to their top-level domain', () => {
    const keys = customerDomainKeysFor([
      { from: { email: 'a@talapparel.com' }, tos: [{ email: 'b@talapparel.com' }] },
    ]);
    expect(keys).toEqual(['talapparel.com']);
  });

  it('gives personal addresses their own key so they do not collapse together', () => {
    const keys = customerDomainKeysFor([
      { from: { email: 'one@gmail.com' }, tos: [{ email: 'two@gmail.com' }] },
    ]);
    expect(keys).toHaveLength(2);
    expect(new Set(keys).size).toBe(2);
  });

  it('returns an empty list when no addresses are present', () => {
    expect(customerDomainKeysFor([{}])).toEqual([]);
  });
});

describe('prompt rendering helpers', () => {
  const roster = buildParticipantRoster(
    [
      {
        from: { email: 'regina@talapparel.com', name: 'Regina Cheung' },
        tos: [{ email: 'jonathan@acme-client.com', name: 'Jonathan Tang' }],
        ccs: [{ email: 'mbala@mystartupcfo.com' }],
      },
    ],
    TENANT_DOMAINS,
    new Set(['acme-client.com'])
  );

  it('renders the roster block with one labelled address per line', () => {
    expect(formatRosterBlock(roster)).toBe(
      [
        'Participants:',
        '  regina@talapparel.com Regina Cheung [UNKNOWN_EXTERNAL]',
        '  jonathan@acme-client.com Jonathan Tang [CUSTOMER]',
        '  mbala@mystartupcfo.com [US]',
      ].join('\n')
    );
  });

  it('renders an empty roster as an empty string', () => {
    expect(formatRosterBlock([])).toBe('');
  });

  it('renders an address list with role labels', () => {
    const line = formatAddressesWithRoles(
      [{ email: 'jonathan@acme-client.com', name: 'Jonathan Tang' }, { email: 'mbala@mystartupcfo.com' }],
      rosterRoleMap(roster)
    );
    expect(line).toBe('Jonathan Tang <jonathan@acme-client.com> [CUSTOMER], mbala@mystartupcfo.com [US]');
  });

  it('omits the label for an address missing from the roster', () => {
    const line = formatAddressesWithRoles([{ email: 'stranger@nowhere.com' }], rosterRoleMap(roster));
    expect(line).toBe('stranger@nowhere.com');
  });

  it('renders an empty address list as an empty string', () => {
    expect(formatAddressesWithRoles([], rosterRoleMap(roster))).toBe('');
    expect(formatAddressesWithRoles(undefined, rosterRoleMap(roster))).toBe('');
  });
});
