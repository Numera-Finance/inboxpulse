import 'reflect-metadata';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { withAutoSuffix } from '@crm/shared';
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

type EnsureOpts = {
  existing?: { id: string; name: string; isAutoCreated: boolean } | null;
  createError?: unknown;
  winner?: { id: string } | null;
};

function makeEnsureService(opts: EnsureOpts) {
  const findByDomain = vi
    .fn()
    .mockResolvedValueOnce(opts.existing ?? undefined) // first lookup
    .mockResolvedValue(opts.winner ?? undefined); // re-read after a lost race
  const update = vi.fn(async (id: string, patch: { name: string }) => ({
    id,
    name: patch.name,
    isAutoCreated: true,
  }));
  const create = opts.createError
    ? vi.fn().mockRejectedValue(opts.createError)
    : vi.fn(async () => ({ id: 'new-customer-id', name: 'created' }));

  const customerRepository = { findByDomain, update, create };
  const service = new CustomerService(
    customerRepository as never,
    {} as never, // ContactRepository
    {} as never, // EmailRepository
    {} as never, // TaskRepository
    {} as never, // UserRepository
    {} as never, // Database
  );
  // Fake tx whose `transaction` runs the callback inline, standing in for the
  // SAVEPOINT the real driver opens (propagates the callback's rejection).
  const tx = { transaction: (cb: (sp: unknown) => unknown) => cb({}) } as never;
  return { service, tx, findByDomain, update, create };
}

describe('CustomerService.ensureCustomerForEmail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const TENANT_ID = '9f34e10b-27d1-457a-bcdc-590f2eb9fa4a';
  const uniqueViolation = Object.assign(new Error('duplicate key'), { code: '23505' });

  it('throws when neither defaultName nor signatureCompany is provided', async () => {
    const { service, tx } = makeEnsureService({ existing: null });
    await expect(
      service.ensureCustomerForEmail(tx, TENANT_ID, 'foo.com', {}),
    ).rejects.toThrow(/requires at least one/);
  });

  it('creates a new customer inside a savepoint when none exists', async () => {
    const { service, tx, create, findByDomain } = makeEnsureService({ existing: null });

    const result = await service.ensureCustomerForEmail(tx, TENANT_ID, 'foo.com', {
      defaultName: 'Foo',
    });

    expect(create).toHaveBeenCalledTimes(1);
    expect(findByDomain).toHaveBeenCalledTimes(1); // no re-read on the happy path
    expect(result.id).toBe('new-customer-id');
  });

  it('re-reads the winner row when a concurrent insert wins the race (23505)', async () => {
    const { service, tx, create, findByDomain } = makeEnsureService({
      existing: null,
      createError: uniqueViolation,
      winner: { id: 'winner-id' },
    });

    const result = await service.ensureCustomerForEmail(tx, TENANT_ID, 'foo.com', {
      defaultName: 'Foo',
    });

    expect(create).toHaveBeenCalledTimes(1);
    expect(findByDomain).toHaveBeenCalledTimes(2); // lookup, then re-read after conflict
    expect(result.id).toBe('winner-id');
  });

  it('rethrows a non-unique-violation error from create', async () => {
    const { service, tx } = makeEnsureService({
      existing: null,
      createError: Object.assign(new Error('boom'), { code: '08006' }),
    });

    await expect(
      service.ensureCustomerForEmail(tx, TENANT_ID, 'foo.com', { defaultName: 'Foo' }),
    ).rejects.toThrow(/boom/);
  });

  it('refines the name of an existing auto-created customer when it differs', async () => {
    const { service, tx, update, create } = makeEnsureService({
      existing: { id: 'existing-id', name: 'Old Name', isAutoCreated: true },
    });

    const result = await service.ensureCustomerForEmail(tx, TENANT_ID, 'foo.com', {
      signatureCompany: 'Foo Inc',
    });

    expect(update).toHaveBeenCalledTimes(1);
    expect(create).not.toHaveBeenCalled();
    expect(result.name).toBe(withAutoSuffix('Foo Inc'));
  });

  it('leaves a manually-created customer untouched', async () => {
    const { service, tx, update, create } = makeEnsureService({
      existing: { id: 'existing-id', name: 'Manual Co', isAutoCreated: false },
    });

    const result = await service.ensureCustomerForEmail(tx, TENANT_ID, 'foo.com', {
      signatureCompany: 'Foo Inc',
    });

    expect(update).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
    expect(result.id).toBe('existing-id');
  });
});
