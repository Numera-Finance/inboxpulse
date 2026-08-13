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

  it('refuses to write an integration with no mailbox to key on', async () => {
    const { service, repo } = createService(null);

    await expect(
      service.createOrUpdate({ tenantId: TENANT_ID, authType: 'oauth', keys: {} })
    ).rejects.toThrow(/email/);
    expect(repo.create).not.toHaveBeenCalled();
  });
});
