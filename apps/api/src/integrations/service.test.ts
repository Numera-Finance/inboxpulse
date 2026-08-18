import 'reflect-metadata';
import { describe, it, expect, vi } from 'vitest';
import { IntegrationService } from './service';
import type {
  IntegrationRepository,
  IntegrationLookupResult,
  IntegrationWithKeys,
  UpdateKeysInput,
} from './repository';
import type { TenantRepository } from '../tenants/repository';

vi.mock('../utils/logger', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

/**
 * createOrUpdate is the whole OAuth reconnect path: the Gmail callback hands it
 * a mailbox and expects the tenant to end up with exactly one integration for
 * that mailbox. Every reconnect used to mint a new row instead (ADR-006).
 */

const TENANT_ID = '9f34e10b-27d1-457a-bcdc-590f2eb9fa4a';
const INTEGRATION_ID = '019f1c7a-223c-7689-a189-73e978bc9ca2';
const USER_ID = '11111111-1111-1111-1111-111111111111';
const EMAIL = 'emailsentiment@mystartupcfo.com';

interface RepoStub {
  findByTenantAndEmail: ReturnType<typeof vi.fn>;
  updateKeysById: ReturnType<typeof vi.fn>;
  create: ReturnType<typeof vi.fn>;
}

function createService(existing: IntegrationLookupResult | null): {
  service: IntegrationService;
  repo: RepoStub;
} {
  const integration = { id: INTEGRATION_ID } as unknown as IntegrationWithKeys;
  const repo: RepoStub = {
    findByTenantAndEmail: vi.fn(async () => existing),
    updateKeysById: vi.fn(async () => integration),
    create: vi.fn(async () => integration),
  };

  const service = new IntegrationService(
    repo as unknown as IntegrationRepository,
    {} as unknown as TenantRepository
  );

  return { service, repo };
}

/**
 * A service whose insert loses a race: the first lookup finds nothing, create
 * fails on the unique index, and the re-read returns `winner`.
 */
function createRacingService(
  winner: IntegrationLookupResult | null = { id: INTEGRATION_ID, isActive: true },
  createError: unknown = Object.assign(new Error('duplicate key'), { code: '23505' })
): { service: IntegrationService; repo: RepoStub } {
  const integration = { id: INTEGRATION_ID } as unknown as IntegrationWithKeys;
  let lookups = 0;
  const repo: RepoStub = {
    findByTenantAndEmail: vi.fn(async () => (lookups++ === 0 ? null : winner)),
    updateKeysById: vi.fn(async () => integration),
    create: vi.fn(async () => {
      throw createError;
    }),
  };

  const service = new IntegrationService(
    repo as unknown as IntegrationRepository,
    {} as unknown as TenantRepository
  );

  return { service, repo };
}

function connectGmail(service: IntegrationService) {
  return service.createOrUpdate({
    tenantId: TENANT_ID,
    authType: 'oauth',
    keys: { email: EMAIL, refreshToken: 'new-refresh-token' },
    createdBy: USER_ID,
  });
}

describe('IntegrationService.createOrUpdate', () => {
  it('revives the existing row when a disconnected mailbox is reconnected', async () => {
    const { service, repo } = createService({ id: INTEGRATION_ID, isActive: false });

    const result = await connectGmail(service);

    // The bug: a disconnected row was invisible to the lookup, so this branch
    // inserted a second integration and email_threads forked under the new id.
    expect(repo.create).not.toHaveBeenCalled();
    expect(repo.updateKeysById).toHaveBeenCalledWith(
      INTEGRATION_ID,
      expect.objectContaining({ keys: expect.objectContaining({ email: EMAIL }) }),
      { reactivate: true, authType: 'oauth' }
    );
    expect(result).toMatchObject({ updated: true, reactivated: true });
  });

  it('updates in place without resetting sync state when still connected', async () => {
    const { service, repo } = createService({ id: INTEGRATION_ID, isActive: true });

    const result = await connectGmail(service);

    expect(repo.create).not.toHaveBeenCalled();
    expect(repo.updateKeysById).toHaveBeenCalledWith(
      INTEGRATION_ID,
      expect.anything(),
      { reactivate: false, authType: 'oauth' }
    );
    expect(result).toMatchObject({ updated: true, reactivated: false });
  });

  it('creates a row only when the tenant has never connected this mailbox', async () => {
    const { service, repo } = createService(null);

    const result = await connectGmail(service);

    expect(repo.updateKeysById).not.toHaveBeenCalled();
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: TENANT_ID, source: 'gmail', createdBy: USER_ID })
    );
    expect(result).toMatchObject({ created: true });
  });

  it('looks the mailbox up by tenant and source', async () => {
    const { service, repo } = createService(null);

    await connectGmail(service);

    expect(repo.findByTenantAndEmail).toHaveBeenCalledWith(TENANT_ID, 'gmail', EMAIL);
  });

  it('records the reconnecting user on the revived row', async () => {
    const { service, repo } = createService({ id: INTEGRATION_ID, isActive: false });

    await connectGmail(service);

    const [, input] = repo.updateKeysById.mock.calls[0] as [string, UpdateKeysInput];
    expect(input.updatedBy).toBe(USER_ID);
  });

  it('falls back to the impersonated address for service accounts', async () => {
    const { service, repo } = createService(null);

    await service.createOrUpdate({
      tenantId: TENANT_ID,
      authType: 'service_account',
      keys: { impersonatedUserEmail: EMAIL },
    });

    expect(repo.findByTenantAndEmail).toHaveBeenCalledWith(TENANT_ID, 'gmail', EMAIL);
  });

  it('recovers when a concurrent connect wins the race to insert (23505)', async () => {
    // Both requests miss the lookup and both insert; the unique index from
    // migration 015 rejects the loser. Without this recovery the OAuth callback
    // would redirect with a raw Postgres constraint message.
    const { service, repo } = createRacingService();

    const result = await connectGmail(service);

    expect(repo.updateKeysById).toHaveBeenCalledWith(
      INTEGRATION_ID,
      expect.objectContaining({ keys: expect.objectContaining({ email: EMAIL }) }),
      { reactivate: false, authType: 'oauth' }
    );
    expect(result).toMatchObject({ updated: true, reactivated: false });
  });

  it('revives the winner if the race was lost to a disconnected row', async () => {
    const { service, repo } = createRacingService({ id: INTEGRATION_ID, isActive: false });

    const result = await connectGmail(service);

    expect(repo.updateKeysById).toHaveBeenCalledWith(
      INTEGRATION_ID,
      expect.anything(),
      { reactivate: true, authType: 'oauth' }
    );
    expect(result).toMatchObject({ updated: true, reactivated: true });
  });

  it('rethrows a unique violation it cannot attribute to a winner', async () => {
    // No row turns up on the re-read, so this was some other constraint —
    // swallowing it would hide a real failure behind a misleading success.
    const { service, repo } = createRacingService(null);

    await expect(connectGmail(service)).rejects.toThrow('duplicate key');
    expect(repo.updateKeysById).not.toHaveBeenCalled();
  });

  it('never retries an error that is not a unique violation', async () => {
    const { service, repo } = createRacingService(undefined, new Error('connection reset'));

    await expect(connectGmail(service)).rejects.toThrow('connection reset');
    expect(repo.findByTenantAndEmail).toHaveBeenCalledTimes(1);
    expect(repo.updateKeysById).not.toHaveBeenCalled();
  });

  it('refuses to write an integration with no mailbox to key on', async () => {
    const { service, repo } = createService(null);

    await expect(
      service.createOrUpdate({ tenantId: TENANT_ID, authType: 'oauth', keys: {} })
    ).rejects.toThrow(/email/);
    expect(repo.create).not.toHaveBeenCalled();
  });
});
