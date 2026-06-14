import 'reflect-metadata';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotFoundError, RowStatus } from '@crm/shared';
import { UserService } from './service';
import type { User } from './schema';

// Mock inngest to avoid network calls during queueAccessRebuild
vi.mock('../inngest/instance', () => ({
  inngest: { send: vi.fn().mockResolvedValue(undefined) },
}));

// Mock logger so we don't have to load env vars for a unit test
vi.mock('../utils/logger', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

type UpdateCall = { id: string; data: Partial<User> };

function makeService(overrides?: Partial<{ updateReturn: User | undefined }>) {
  const updateCalls: UpdateCall[] = [];

  const userRepository = {
    update: vi.fn(async (id: string, data: Partial<User>) => {
      updateCalls.push({ id, data });
      return overrides?.updateReturn;
    }),
  };

  // Only UserRepository is exercised by markActive/markInactive — other deps unused.
  const service = new UserService(
    {} as never, // Database
    userRepository as never, // UserRepository
    {} as never, // CustomerRepository
    {} as never, // TenantRepository
    {} as never, // RoleRepository
    {} as never, // TaskRepository
  );

  return { service, userRepository, updateCalls };
}

const sampleUser = (overrides?: Partial<User>): User => ({
  id: '019ce83b-0834-75bf-beb6-02558fbce9a2',
  tenantId: '9f34e10b-27d1-457a-bcdc-590f2eb9fa4a',
  firstName: 'Test',
  lastName: 'User',
  email: 'test@example.com',
  roleId: null,
  apiKeyHash: null,
  canLogin: true,
  timezone: 'Asia/Kolkata',
  rowStatus: RowStatus.ACTIVE,
  createdAt: new Date(),
  updatedAt: new Date(),
  lastLoginAt: null,
  ...overrides,
});

describe('UserService.markInactive', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sets rowStatus to INACTIVE on the repository', async () => {
    const updated = sampleUser({ rowStatus: RowStatus.INACTIVE });
    const { service, updateCalls } = makeService({ updateReturn: updated });

    const result = await service.markInactive(updated.tenantId, updated.id);

    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0]).toEqual({
      id: updated.id,
      data: { rowStatus: RowStatus.INACTIVE },
    });
    expect(result.rowStatus).toBe(RowStatus.INACTIVE);
  });

  it('throws NotFoundError when user does not exist', async () => {
    const { service } = makeService({ updateReturn: undefined });

    await expect(
      service.markInactive('tenant-id', 'missing-user-id'),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('UserService.markActive', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sets rowStatus to ACTIVE on the repository', async () => {
    const updated = sampleUser({ rowStatus: RowStatus.ACTIVE });
    const { service, updateCalls } = makeService({ updateReturn: updated });

    const result = await service.markActive(updated.tenantId, updated.id);

    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0]).toEqual({
      id: updated.id,
      data: { rowStatus: RowStatus.ACTIVE },
    });
    expect(result.rowStatus).toBe(RowStatus.ACTIVE);
  });

  it('throws NotFoundError when user does not exist', async () => {
    const { service } = makeService({ updateReturn: undefined });

    await expect(
      service.markActive('tenant-id', 'missing-user-id'),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
