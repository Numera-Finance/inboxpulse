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
