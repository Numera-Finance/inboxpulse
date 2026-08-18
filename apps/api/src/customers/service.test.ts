import 'reflect-metadata';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CustomerService } from './service';

vi.mock('../inngest/instance', () => ({
  inngest: { send: vi.fn().mockResolvedValue(undefined) },
}));

vi.mock('../utils/logger', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

type UpsertCall = Parameters<
  (typeof import('./repository'))['CustomerRepository']['prototype']['upsertWithDomains']
>[0];

function makeService(existing?: { id: string; isAutoCreated: boolean } | null) {
  const upsertCalls: UpsertCall[] = [];

  const customerRepository = {
    findByDomain: vi.fn(async () => existing ?? undefined),
    upsertWithDomains: vi.fn(async (data: UpsertCall) => {
      upsertCalls.push(data);
      return {
        id: existing?.id ?? 'new-customer-id',
        tenantId: data.tenantId,
        name: data.name ?? 'Stored Name',
        website: null,
        industry: null,
        labels: null,
        externalId: null,
        metadata: null,
        isAutoCreated: data.isAutoCreated ?? false,
        rowStatus: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
        domains: data.domains,
      };
    }),
  };

  const service = new CustomerService(
    customerRepository as never,
    {} as never, // ContactRepository
    {} as never, // EmailRepository
    {} as never, // TaskRepository
    {} as never, // UserRepository
    {} as never, // Database
  );

  return { service, customerRepository, upsertCalls };
}

describe('CustomerService.upsertCustomer name handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const TENANT_ID = '9f34e10b-27d1-457a-bcdc-590f2eb9fa4a';

  it('passes the caller-provided name through when creating a new customer', async () => {
    const { service, upsertCalls } = makeService(null);

    await service.upsertCustomer(TENANT_ID, {
      domains: ['foo.com'],
      name: 'Foo (Auto)',
      isAutoCreated: true,
    });

    expect(upsertCalls).toHaveLength(1);
    expect(upsertCalls[0].name).toBe('Foo (Auto)');
  });

  it('strips name from the payload when the customer already exists for the domain', async () => {
    const { service, upsertCalls } = makeService({
      id: 'existing-id',
      isAutoCreated: true,
    });

    await service.upsertCustomer(TENANT_ID, {
      domains: ['foo.com'],
      name: 'Foo (Auto)', // pipeline re-run sends the inferred name again
      isAutoCreated: true,
    });

    expect(upsertCalls).toHaveLength(1);
    expect(upsertCalls[0]).not.toHaveProperty('name');
  });

  it('strips name even when the caller is not the pipeline, so manual upserts cannot rename an existing customer', async () => {
    const { service, upsertCalls } = makeService({
      id: 'existing-id',
      isAutoCreated: false,
    });

    await service.upsertCustomer(TENANT_ID, {
      domains: ['foo.com'],
      name: 'Renamed Via Upsert',
    });

    expect(upsertCalls).toHaveLength(1);
    expect(upsertCalls[0]).not.toHaveProperty('name');
  });
});

/**
 * An unrecognised domain must not mint a customer when an existing client
 * already owns the company.
 *
 * This is what stranded Hammerhead: "Hammerhead AI, Inc" holds hammerhead.io and
 * six allocated people, the client writes from hammerheadco.ai, and that domain
 * got a fresh auto-created record with nobody on it. The panel showed a fire with
 * no owner while six people were assigned to that company. Across the tenant,
 * 3,897 customers carry a domain and 2 of the auto-created ones have an owner.
 *
 * The evidence is the firm's own convention: a per-client alias at our domain —
 * hammerheadai@ — on the thread, whose local part identifies the client in the
 * allocation sheet.
 */
describe('a domain an existing client already owns', () => {
  function serviceWithClaim(claimRows: Array<{ customer_id: string; name: string; alias: string }>) {
    const executed: string[] = [];
    const created: unknown[] = [];
    const tx = {
      execute: vi.fn(async (q: unknown) => {
        const text = JSON.stringify(q);
        executed.push(text);
        // The advisory lock and the domain INSERT return nothing; only the
        // claim lookup returns rows.
        return text.includes('customer_allocations') ? claimRows : [];
      }),
    };
    const customerRepository = {
      findByDomain: vi.fn(async () => undefined),
      findById: vi.fn(async (id: string) => ({ id, name: 'Hammerhead AI, Inc' })),
      create: vi.fn(async (data: unknown) => {
        created.push(data);
        return { id: 'freshly-minted', ...(data as object) };
      }),
    };
    const svc = new CustomerService(
      customerRepository as never, {} as never, {} as never, {} as never
    );
    return { svc, tx, customerRepository, created };
  }

  const addresses = ['mgb@hammerheadco.ai', 'hammerheadai@mystartupcfo.com'];

  it('attaches the domain to that client instead of creating a customer', async () => {
    const { svc, tx, customerRepository, created } = serviceWithClaim([
      { customer_id: 'hammerhead-real', name: 'Hammerhead AI, Inc', alias: 'hammerheadai@mystartupcfo.com' },
    ]);
    const out = await svc.ensureCustomerForEmail(tx as never, 'tenant-1', 'hammerheadco.ai', {
      defaultName: 'Hammerheadco',
      threadAddresses: addresses,
    });
    expect(out.id).toBe('hammerhead-real');
    expect(customerRepository.create).not.toHaveBeenCalled();
    expect(created).toHaveLength(0);
  });

  it('creates as before when no client claims it', async () => {
    const { svc, customerRepository, tx } = serviceWithClaim([]);
    await svc.ensureCustomerForEmail(tx as never, 'tenant-1', 'stranger.com', {
      defaultName: 'Stranger',
      threadAddresses: ['a@stranger.com'],
    });
    expect(customerRepository.create).toHaveBeenCalled();
  });

  it('refuses to guess when two clients claim the same domain', async () => {
    // A wrong domain attributes one client's mail to another, which is worse
    // than an orphan. Ambiguity falls through to the old behaviour.
    const { svc, customerRepository, tx } = serviceWithClaim([
      { customer_id: 'client-a', name: 'A Inc', alias: 'alpha@mystartupcfo.com' },
      { customer_id: 'client-b', name: 'B Inc', alias: 'beta@mystartupcfo.com' },
    ]);
    await svc.ensureCustomerForEmail(tx as never, 'tenant-1', 'contested.com', {
      defaultName: 'Contested',
      threadAddresses: ['x@contested.com'],
    });
    expect(customerRepository.create).toHaveBeenCalled();
  });

  it('does not run the lookup at all without thread addresses', async () => {
    const { svc, tx } = serviceWithClaim([]);
    await svc.ensureCustomerForEmail(tx as never, 'tenant-1', 'plain.com', { defaultName: 'Plain' });
    const looked = (tx.execute.mock.calls as unknown[][])
      .some((c) => JSON.stringify(c[0]).includes('customer_allocations'));
    expect(looked).toBe(false);
  });
});
