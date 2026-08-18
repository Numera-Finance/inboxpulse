import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import { type SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { Database } from '@crm/database';
import { IntegrationRepository } from './repository';
import type { Integration } from './schema';

/**
 * These tests pin the mailbox-identity rule behind ADR-006: an integration is
 * identified by (tenant, source, mailbox) and NOT by whether it is currently
 * connected. Scoping the lookup to active rows made every reconnect insert a
 * duplicate, which fragmented one production mailbox across 13 integration rows
 * and split its email_threads three ways.
 */

const TENANT_ID = '9f34e10b-27d1-457a-bcdc-590f2eb9fa4a';
const INTEGRATION_ID = '019f1c7a-223c-7689-a189-73e978bc9ca2';
const EMAIL = 'emailsentiment@mystartupcfo.com';

type Row = Record<string, unknown>;

interface Captured {
  where?: SQL;
  orderBy: unknown[];
  set?: Row;
}

/**
 * Minimal stand-in for the Drizzle query builder. It records the predicate and
 * the update payload so tests can assert on generated SQL without a database.
 */
function createFakeDb(rows: { selected: Row[]; updated: Row[] }): {
  db: Database;
  captured: Captured;
} {
  const captured: Captured = { orderBy: [] };

  const selectChain = {
    from: () => selectChain,
    where: (predicate: SQL) => {
      captured.where = predicate;
      return selectChain;
    },
    orderBy: (...columns: unknown[]) => {
      captured.orderBy = columns;
      return selectChain;
    },
    limit: async () => rows.selected,
  };

  const db = {
    select: () => selectChain,
    update: () => ({
      set: (values: Row) => {
        captured.set = values;
        return {
          where: () => ({ returning: async () => rows.updated }),
        };
      },
    }),
  };

  return { db: db as unknown as Database, captured };
}

function renderWhere(captured: Captured): string {
  return new PgDialect().sqlToQuery(captured.where!).sql;
}

function whereParams(captured: Captured): unknown[] {
  return new PgDialect().sqlToQuery(captured.where!).params;
}

/**
 * orderBy takes a mix of wrapped expressions (desc(...) yields SQL) and bare
 * columns, which render differently.
 */
function renderOrderTerm(term: unknown): string {
  const isSql = typeof (term as { toQuery?: unknown }).toQuery === 'function';
  return isSql
    ? new PgDialect().sqlToQuery(term as SQL).sql
    : String((term as { name: string }).name);
}

/** An integration row as it looks after the mailbox was disconnected. */
function disconnectedRow(overrides: Partial<Integration> = {}): Row {
  return {
    id: INTEGRATION_ID,
    tenantId: TENANT_ID,
    source: 'gmail',
    authType: 'oauth',
    parameters: [
      { key: 'email', value: EMAIL },
      { key: 'blacklistEmails', value: ['mystartupcfo.com'] },
    ],
    accessToken: 'stale-access-token',
    accessTokenExpiresAt: new Date('2026-06-28T00:00:00Z'),
    refreshToken: null,
    token: 'old-refresh-token',
    tokenExpiresAt: null,
    watchSetAt: new Date('2026-06-25T00:00:00Z'),
    watchExpiresAt: new Date('2026-07-02T00:00:00Z'),
    lastRunToken: '284197',
    lastRunAt: new Date('2026-06-28T00:00:00Z'),
    isActive: false,
    lastUsedAt: null,
    createdBy: null,
    updatedBy: null,
    createdAt: new Date('2026-05-29T00:00:00Z'),
    updatedAt: new Date('2026-07-01T00:00:00Z'),
    ...overrides,
  };
}

describe('IntegrationRepository.findByTenantAndEmail', () => {
  it('does not filter on is_active, so a disconnected mailbox is still found', async () => {
    const { db, captured } = createFakeDb({ selected: [], updated: [] });

    await new IntegrationRepository(db).findByTenantAndEmail(TENANT_ID, 'gmail', EMAIL);

    // The regression this whole change exists to prevent: an is_active arm here
    // makes every reconnect miss the existing row and INSERT a duplicate.
    expect(renderWhere(captured)).not.toContain('is_active');
  });

  it('scopes the lookup to the tenant and source', async () => {
    const { db, captured } = createFakeDb({ selected: [], updated: [] });

    await new IntegrationRepository(db).findByTenantAndEmail(TENANT_ID, 'gmail', EMAIL);

    const sql = renderWhere(captured);
    expect(sql).toContain('"tenant_id"');
    expect(sql).toContain('"source"');
    expect(whereParams(captured)).toContain(TENANT_ID);
  });

  it('matches the mailbox under every email-bearing key', async () => {
    const { db, captured } = createFakeDb({ selected: [], updated: [] });

    await new IntegrationRepository(db).findByTenantAndEmail(TENANT_ID, 'gmail', EMAIL);

    // A mailbox stored under a later key must resolve here too. Covering only
    // `email` let such a row be found by the Gmail webhook but not by a
    // reconnect, so it forked its email_threads exactly as in ADR-006.
    // The jsonpath is bound as a parameter, so the key set shows up there.
    const params = whereParams(captured);
    for (const key of ['email', 'impersonatedUserEmail', 'userEmail']) {
      expect(params).toContain(`$[*] ? (@.key == "${key}").value`);
    }
  });

  it('matches case-insensitively, the way the unique index compares', async () => {
    const { db, captured } = createFakeDb({ selected: [], updated: [] });

    await new IntegrationRepository(db).findByTenantAndEmail(
      TENANT_ID,
      'gmail',
      'EmailSentiment@MyStartupCFO.com'
    );

    // Byte-exact containment would miss a row stored in different case, fall
    // through to INSERT, and then violate the lowercased unique index from
    // migration 015 — failing the OAuth callback instead of connecting.
    expect(renderWhere(captured)).toContain('lower(');
    expect(whereParams(captured)).toContain(EMAIL);
    expect(whereParams(captured)).not.toContain('EmailSentiment@MyStartupCFO.com');
  });

  it('binds the mailbox as a parameter rather than interpolating it', async () => {
    const { db, captured } = createFakeDb({ selected: [], updated: [] });

    // The webhook path resolves integrations from an externally supplied address.
    await new IntegrationRepository(db).findByTenantAndEmail(
      TENANT_ID,
      'gmail',
      "victim@example.com\"}]'::jsonb OR true --"
    );

    expect(renderWhere(captured)).not.toContain('victim@example.com');
  });

  it('matches nothing when the email is empty', async () => {
    const { db, captured } = createFakeDb({ selected: [], updated: [] });

    await new IntegrationRepository(db).findByTenantAndEmail(TENANT_ID, 'gmail', '');

    // Without the guard, JSON.stringify drops the undefined value and the
    // predicate degrades to "has an email key at all" — any tenant's row.
    expect(renderWhere(captured)).toContain('false');
    expect(renderWhere(captured)).not.toContain('@>');
  });

  it('prefers the connected row, then the newest, when duplicates exist', async () => {
    const { db, captured } = createFakeDb({ selected: [], updated: [] });

    await new IntegrationRepository(db).findByTenantAndEmail(TENANT_ID, 'gmail', EMAIL);

    // A tenant carrying pre-fix duplicates must revive the row holding the newest
    // email_threads, not the empty one created months earlier.
    const ordering = captured.orderBy.map(renderOrderTerm);
    expect(ordering[0]).toContain('is_active');
    expect(ordering[0]).toContain('desc');
    expect(ordering[1]).toContain('created_at');
    expect(ordering[1]).toContain('desc');
  });

  it('returns the row identity together with its connected state', async () => {
    const { db } = createFakeDb({
      selected: [{ id: INTEGRATION_ID, isActive: false }],
      updated: [],
    });

    const found = await new IntegrationRepository(db).findByTenantAndEmail(
      TENANT_ID,
      'gmail',
      EMAIL
    );

    expect(found).toEqual({ id: INTEGRATION_ID, isActive: false });
  });
});

describe('IntegrationRepository.updateKeysById', () => {
  it('merges new keys over the target row own parameters', async () => {
    const row = disconnectedRow();
    const { db, captured } = createFakeDb({ selected: [row], updated: [row] });

    await new IntegrationRepository(db).updateKeysById(INTEGRATION_ID, {
      keys: { email: EMAIL, refreshToken: 'new-refresh-token' },
    });

    // Parameters come from THIS row. The previous implementation merged from
    // getCredentials(tenantId, source), which returns an arbitrary active row —
    // with two mailboxes connected it copied the wrong one's settings across.
    expect(captured.set?.parameters).toEqual([
      { key: 'email', value: EMAIL },
      { key: 'blacklistEmails', value: ['mystartupcfo.com'] },
    ]);
  });

  it('keeps token columns in step so the newest refresh token wins', async () => {
    const row = disconnectedRow({ refreshToken: 'rotated-but-stale' });
    const { db, captured } = createFakeDb({ selected: [row], updated: [row] });

    await new IntegrationRepository(db).updateKeysById(INTEGRATION_ID, {
      keys: { refreshToken: 'new-refresh-token' },
    });

    // getCredentials prefers refresh_token and falls back to the legacy token,
    // so writing only one column would leave a stale token winning after OAuth.
    expect(captured.set?.refreshToken).toBe('new-refresh-token');
    expect(captured.set?.token).toBe('new-refresh-token');
  });

  it('keeps the stored token when the update carries none', async () => {
    const row = disconnectedRow();
    const { db, captured } = createFakeDb({ selected: [row], updated: [row] });

    await new IntegrationRepository(db).updateKeysById(INTEGRATION_ID, {
      keys: { blacklistEmails: ['example.com'] },
    });

    // A settings-only update must never clear credentials. Rewriting the token
    // the readers already resolve also pulls the two columns back into step.
    expect(captured.set?.refreshToken).toBe('old-refresh-token');
    expect(captured.set?.token).toBe('old-refresh-token');
  });

  it('does not write token columns at all when the row has no token', async () => {
    const row = disconnectedRow({ refreshToken: null, token: null });
    const { db, captured } = createFakeDb({ selected: [row], updated: [row] });

    await new IntegrationRepository(db).updateKeysById(INTEGRATION_ID, { keys: {} });

    // Absent means "unchanged", never an explicit NULL over the column.
    expect(captured.set).not.toHaveProperty('refreshToken');
    expect(captured.set).not.toHaveProperty('token');
  });

  it('never writes token material into the parameters JSONB', async () => {
    const row = disconnectedRow();
    const { db, captured } = createFakeDb({ selected: [row], updated: [row] });

    await new IntegrationRepository(db).updateKeysById(INTEGRATION_ID, {
      keys: { refreshToken: 'new-refresh-token' },
    });

    const keys = (captured.set?.parameters as { key: string }[]).map((p) => p.key);
    expect(keys).not.toContain('refreshToken');
    expect(keys).not.toContain('accessToken');
    expect(keys).not.toContain('accessTokenExpiresAt');
  });

  it('stores the mailbox lowercased so one address cannot become two rows', async () => {
    const row = disconnectedRow();
    const { db, captured } = createFakeDb({ selected: [row], updated: [row] });

    await new IntegrationRepository(db).updateKeysById(INTEGRATION_ID, {
      keys: { email: 'EmailSentiment@MyStartupCFO.com' },
    });

    const stored = captured.set?.parameters as { key: string; value: unknown }[];
    expect(stored.find((p) => p.key === 'email')?.value).toBe(EMAIL);
  });

  it('drops the cached access token when a new refresh token arrives', async () => {
    const row = disconnectedRow({ isActive: true });
    const { db, captured } = createFakeDb({ selected: [row], updated: [row] });

    await new IntegrationRepository(db).updateKeysById(INTEGRATION_ID, {
      keys: { refreshToken: 'new-refresh-token' },
    });

    // Re-authorizing a still-connected mailbox is how a revoked grant gets
    // repaired. The Gmail client trusts any stored access token expiring more
    // than 5 minutes out, so keeping one would 401 for up to an hour.
    expect(captured.set?.accessToken).toBeNull();
    expect(captured.set?.accessTokenExpiresAt).toBeNull();
  });

  it('keeps the cached access token on a settings-only update', async () => {
    const row = disconnectedRow({ isActive: true });
    const { db, captured } = createFakeDb({ selected: [row], updated: [row] });

    await new IntegrationRepository(db).updateKeysById(INTEGRATION_ID, {
      keys: { blacklistEmails: ['example.com'] },
    });

    // The merged token carries the row's existing value forward, so the trigger
    // has to be the caller-supplied one — otherwise saving a setting would force
    // a needless token refresh.
    expect(captured.set).not.toHaveProperty('accessToken');
    expect(captured.set).not.toHaveProperty('accessTokenExpiresAt');
  });

  it('retires service-account credentials when the mailbox moves to OAuth', async () => {
    const row = disconnectedRow({
      authType: 'service_account',
      parameters: [
        { key: 'email', value: EMAIL },
        { key: 'serviceAccountEmail', value: 'sa@project.iam.gserviceaccount.com' },
        { key: 'serviceAccountKey', value: { private_key: 'stale' } },
      ],
    });
    const { db, captured } = createFakeDb({ selected: [row], updated: [row] });

    await new IntegrationRepository(db).updateKeysById(
      INTEGRATION_ID,
      { keys: { email: EMAIL, refreshToken: 'new-refresh-token' } },
      { reactivate: false, authType: 'oauth' }
    );

    // GmailClientFactory tests the service-account fields BEFORE the OAuth
    // branch, so merging them forward would ignore the grant just made.
    const keys = (captured.set?.parameters as { key: string }[]).map((p) => p.key);
    expect(keys).not.toContain('serviceAccountEmail');
    expect(keys).not.toContain('serviceAccountKey');
    expect(captured.set?.authType).toBe('oauth');
  });

  it('leaves auth_type alone when the caller does not supply one', async () => {
    const row = disconnectedRow();
    const { db, captured } = createFakeDb({ selected: [row], updated: [row] });

    await new IntegrationRepository(db).updateKeysById(INTEGRATION_ID, { keys: {} });

    expect(captured.set).not.toHaveProperty('authType');
  });

  it('reactivating clears the stale Gmail sync cursor and watch bookkeeping', async () => {
    const row = disconnectedRow();
    const { db, captured } = createFakeDb({ selected: [row], updated: [row] });

    await new IntegrationRepository(db).updateKeysById(
      INTEGRATION_ID,
      { keys: { refreshToken: 'new-refresh-token' } },
      { reactivate: true }
    );

    expect(captured.set?.isActive).toBe(true);
    // last_run_token is a Gmail historyId. Gmail rejects ones older than about a
    // week, and incrementalSync only degrades to a full sync when the cursor is
    // absent — so reviving a months-old row without clearing it would throw.
    expect(captured.set?.lastRunToken).toBeNull();
    expect(captured.set?.lastRunAt).toBeNull();
    // The watch was stopped at disconnect; a stale future expiry suppresses renewal.
    expect(captured.set?.watchSetAt).toBeNull();
    expect(captured.set?.watchExpiresAt).toBeNull();
    expect(captured.set?.accessToken).toBeNull();
    expect(captured.set?.accessTokenExpiresAt).toBeNull();
  });

  it('leaves sync state alone on a routine credential update', async () => {
    const row = disconnectedRow({ isActive: true });
    const { db, captured } = createFakeDb({ selected: [row], updated: [row] });

    await new IntegrationRepository(db).updateKeysById(INTEGRATION_ID, {
      keys: { refreshToken: 'new-refresh-token' },
    });

    expect(captured.set).not.toHaveProperty('isActive');
    expect(captured.set).not.toHaveProperty('lastRunToken');
    expect(captured.set).not.toHaveProperty('watchExpiresAt');
  });

  it('rejects an unknown integration id instead of writing blind', async () => {
    const { db } = createFakeDb({ selected: [], updated: [] });

    await expect(
      new IntegrationRepository(db).updateKeysById(INTEGRATION_ID, { keys: {} })
    ).rejects.toThrow(INTEGRATION_ID);
  });
});
