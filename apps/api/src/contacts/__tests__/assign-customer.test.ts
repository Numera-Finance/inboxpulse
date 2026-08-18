import 'reflect-metadata';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ContactService } from '../service';

vi.mock('../../utils/logger', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

const TENANT_ID = '9f34e10b-27d1-457a-bcdc-590f2eb9fa4a';
const TARGET_CUSTOMER_ID = '2b6c1f90-4d3a-4a0e-9c1d-5e8a7b6c4d21';
const PLACEHOLDER_ID = '7d1e2f34-5a6b-4c7d-8e9f-0a1b2c3d4e5f';
const REAL_OTHER_ID = 'c3d4e5f6-1a2b-4c3d-9e8f-7a6b5c4d3e2f';

const header = {
  tenantId: TENANT_ID,
  userId: 'e1f2a3b4-c5d6-4e7f-8a9b-0c1d2e3f4a5b',
  permissions: [],
} as never;

interface Options {
  /** Customer that currently owns the address's domain key, if any. */
  domainOwner?: { id: string; isAutoCreated: boolean };
  /** Emails whose sender resolved to no customer at all. */
  unlinkedEmailIds?: string[];
  /** Of those, the ones that qualify for an escalation task. */
  taskEligible?: Array<{ id: string; subject: string | null }>;
}

function makeService(options: Options = {}) {
  const contactRepository = {
    canAccessCustomer: vi.fn(async () => true),
    upsert: vi.fn(async (data: Record<string, unknown>) => ({
      id: 'contact-id',
      ...data,
    })),
    reassignByDomain: vi.fn(async () => 2),
  };

  const customerRepository = {
    findById: vi.fn(async () => ({ id: TARGET_CUSTOMER_ID, tenantId: TENANT_ID })),
    findByDomain: vi.fn(async () => options.domainOwner),
    moveDomain: vi.fn(async () => undefined),
  };

  const emailRepository = {
    findUnlinkedSenderEmailIds: vi.fn(async () => options.unlinkedEmailIds ?? []),
    reassignParticipantsByAddress: vi.fn(async () => 7),
    findTaskEligibleEmails: vi.fn(async () => options.taskEligible ?? []),
  };

  const taskService = {
    createFromEmail: vi.fn(async () => ({ id: 'task-id' })),
  };

  // Run the callback inline — these tests assert the decisions the service
  // makes, not the transaction machinery underneath them.
  const db = { transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn({})) };

  const service = new ContactService(
    contactRepository as never,
    customerRepository as never,
    emailRepository as never,
    taskService as never,
    db as never
  );

  return { service, contactRepository, customerRepository, emailRepository, taskService };
}

describe('ContactService.assignCustomer domain handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('claims an unowned corporate domain and brings its contacts along', async () => {
    const { service, customerRepository, contactRepository } = makeService();

    const result = await service.assignCustomer(header, {
      email: 'bob@acme.com',
      customerId: TARGET_CUSTOMER_ID,
    });

    expect(customerRepository.moveDomain).toHaveBeenCalledWith(
      TENANT_ID,
      'acme.com',
      TARGET_CUSTOMER_ID,
      expect.anything()
    );
    // Siblings must follow, or contact-first resolution strands them on the
    // customer they were originally auto-linked to.
    expect(contactRepository.reassignByDomain).toHaveBeenCalledWith(
      TENANT_ID,
      'acme.com',
      TARGET_CUSTOMER_ID,
      expect.anything()
    );
    expect(result.domainMoved).toBe('acme.com');
  });

  it('takes a domain away from an auto-created placeholder', async () => {
    const { service, customerRepository } = makeService({
      domainOwner: { id: PLACEHOLDER_ID, isAutoCreated: true },
    });

    const result = await service.assignCustomer(header, {
      email: 'bob@acme.com',
      customerId: TARGET_CUSTOMER_ID,
    });

    expect(customerRepository.moveDomain).toHaveBeenCalled();
    expect(result.domainMoved).toBe('acme.com');
  });

  it('leaves a domain owned by a real customer alone', async () => {
    const { service, customerRepository, contactRepository, emailRepository } = makeService({
      domainOwner: { id: REAL_OTHER_ID, isAutoCreated: false },
    });

    const result = await service.assignCustomer(header, {
      email: 'bob@contractor.com',
      customerId: TARGET_CUSTOMER_ID,
    });

    expect(customerRepository.moveDomain).not.toHaveBeenCalled();
    expect(contactRepository.reassignByDomain).not.toHaveBeenCalled();
    expect(result.domainMoved).toBeNull();
    // Only this one sender's history is rewritten.
    expect(emailRepository.reassignParticipantsByAddress).toHaveBeenCalledWith(
      TENANT_ID,
      { kind: 'address', value: 'bob@contractor.com' },
      TARGET_CUSTOMER_ID,
      expect.anything()
    );
  });

  it('never touches a domain for a personal address', async () => {
    const { service, customerRepository, contactRepository, emailRepository } = makeService();

    const result = await service.assignCustomer(header, {
      email: 'bob@gmail.com',
      customerId: TARGET_CUSTOMER_ID,
    });

    expect(customerRepository.findByDomain).not.toHaveBeenCalled();
    expect(customerRepository.moveDomain).not.toHaveBeenCalled();
    expect(contactRepository.reassignByDomain).not.toHaveBeenCalled();
    expect(result.domainMoved).toBeNull();
    expect(emailRepository.reassignParticipantsByAddress).toHaveBeenCalledWith(
      TENANT_ID,
      { kind: 'address', value: 'bob@gmail.com' },
      TARGET_CUSTOMER_ID,
      expect.anything()
    );
    // The contact link alone settles future emails, since analysis reads it
    // before the domain.
    expect(contactRepository.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'bob@gmail.com', customerId: TARGET_CUSTOMER_ID }),
      expect.anything()
    );
  });

  it('matches the whole domain when it claimed one', async () => {
    const { service, emailRepository } = makeService();

    await service.assignCustomer(header, {
      email: 'bob@acme.com',
      customerId: TARGET_CUSTOMER_ID,
    });

    expect(emailRepository.reassignParticipantsByAddress).toHaveBeenCalledWith(
      TENANT_ID,
      { kind: 'domain', value: 'acme.com' },
      TARGET_CUSTOMER_ID,
      expect.anything()
    );
  });

  it('normalizes the address before doing anything with it', async () => {
    const { service, contactRepository } = makeService();

    await service.assignCustomer(header, {
      email: '  BoB@Acme.COM  ',
      customerId: TARGET_CUSTOMER_ID,
    });

    expect(contactRepository.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'bob@acme.com' }),
      expect.anything()
    );
  });
});

describe('ContactService.assignCustomer retroactive tasks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reads the unlinked emails before the reassignment overwrites them', async () => {
    const order: string[] = [];
    const { service, emailRepository } = makeService({ unlinkedEmailIds: ['email-1'] });

    emailRepository.findUnlinkedSenderEmailIds.mockImplementation(async () => {
      order.push('read');
      return ['email-1'];
    });
    emailRepository.reassignParticipantsByAddress.mockImplementation(async () => {
      order.push('write');
      return 7;
    });

    await service.assignCustomer(header, {
      email: 'bob@acme.com',
      customerId: TARGET_CUSTOMER_ID,
    });

    // Reversed, every previously-unlinked email looks already-linked and no
    // task would ever be created.
    expect(order).toEqual(['read', 'write']);
  });

  it('creates a task for each previously-unlinked negative email', async () => {
    const { service, taskService } = makeService({
      unlinkedEmailIds: ['email-1', 'email-2'],
      taskEligible: [
        { id: 'email-1', subject: 'Still broken' },
        { id: 'email-2', subject: null },
      ],
    });

    const result = await service.assignCustomer(header, {
      email: 'bob@acme.com',
      customerId: TARGET_CUSTOMER_ID,
    });

    expect(result.tasksCreated).toBe(2);
    expect(taskService.createFromEmail).toHaveBeenCalledWith(
      TENANT_ID,
      TARGET_CUSTOMER_ID,
      'email-1',
      'Still broken'
    );
    expect(taskService.createFromEmail).toHaveBeenCalledWith(
      TENANT_ID,
      TARGET_CUSTOMER_ID,
      'email-2',
      'Negative sentiment email'
    );
  });

  it('keeps the reassignment when task creation fails', async () => {
    const { service, taskService } = makeService({
      unlinkedEmailIds: ['email-1'],
      taskEligible: [{ id: 'email-1', subject: 'Still broken' }],
    });
    taskService.createFromEmail.mockRejectedValue(new Error('assignee lookup failed'));

    const result = await service.assignCustomer(header, {
      email: 'bob@acme.com',
      customerId: TARGET_CUSTOMER_ID,
    });

    expect(result.tasksCreated).toBe(0);
    expect(result.emailsReassigned).toBe(7);
  });
});

describe('ContactService.assignCustomer guards', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects a customer from another tenant', async () => {
    const { service, customerRepository } = makeService();
    customerRepository.findById.mockResolvedValue({
      id: TARGET_CUSTOMER_ID,
      tenantId: 'a0000000-0000-4000-8000-000000000000',
    });

    await expect(
      service.assignCustomer(header, { email: 'bob@acme.com', customerId: TARGET_CUSTOMER_ID })
    ).rejects.toThrow(/not found/i);
  });

  it('rejects a customer the caller cannot access', async () => {
    const { service, contactRepository } = makeService();
    contactRepository.canAccessCustomer.mockResolvedValue(false);

    await expect(
      service.assignCustomer(header, { email: 'bob@acme.com', customerId: TARGET_CUSTOMER_ID })
    ).rejects.toThrow(/access/i);
  });

  it('rejects an address with no domain', async () => {
    const { service } = makeService();

    await expect(
      service.assignCustomer(header, { email: 'not-an-address', customerId: TARGET_CUSTOMER_ID })
    ).rejects.toThrow(/valid email/i);
  });
});
