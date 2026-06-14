/**
 * Integration tests for first-reply / time-to-response (TAT) tracking.
 *
 * These exercise the REAL EmailService + repositories against a REAL Postgres,
 * covering the behavior that unit tests can't: which emails get stored, how
 * firstReplyAt is populated, the lastMessageAt bump, the reply-only branch, and
 * the no-domains short-circuit.
 *
 * ── How to run ────────────────────────────────────────────────────────────
 *   1. Point at a DISPOSABLE Postgres (the setup DROPs/recreates the emails,
 *      email_threads, tenants and integrations tables — do NOT use a real DB):
 *
 *        export TEST_DATABASE_URL=postgres://user:pass@localhost:5432/crm_test
 *
 *   2. Run just this suite:
 *
 *        TEST_DATABASE_URL=$TEST_DATABASE_URL \
 *          pnpm --filter @crm/api exec vitest run first-reply.integration
 *
 * When TEST_DATABASE_URL is unset the whole suite is skipped, so `pnpm test`
 * stays green in CI without a database.
 */
import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { eq } from 'drizzle-orm';
import type { Email, EmailCollection } from '@crm/shared';
import type { FirstReplyMarker } from '@crm/clients';

// Neutralize the Inngest analysis trigger. The service dynamically imports
// '../inngest/client'; this mock resolves to the same module id.
vi.mock('../inngest/client', () => ({
  inngest: { send: vi.fn().mockResolvedValue({ ids: [] }) },
}));

const TEST_DB = process.env.TEST_DATABASE_URL;

// Point the shared db factory at the test DB BEFORE it's imported/initialized.
if (TEST_DB) {
  process.env.DATABASE_URL = TEST_DB;
  process.env.DRIZZLE_LOG = 'false';
}

import { createDatabase, getDatabaseClient, type Database } from '@crm/database';
import { EmailService } from '../emails/service';
import { EmailRepository } from '../emails/repository';
import { EmailThreadRepository } from '../emails/thread-repository';
import type { TenantRepository } from '../tenants/repository';
import type { ContactRepository } from '../contacts/repository';
import { emails, emailThreads } from '../emails/schema';

const SQL_DIR = resolve(__dirname, '../../sql');
const TENANT_ID = '00000000-0000-0000-0000-0000000000a1';
const INTEGRATION_ID = '00000000-0000-0000-0000-0000000000b1';
const THREAD = 'gmail-thread-1';

// ── builders ────────────────────────────────────────────────────────────────
function mkEmail(over: Partial<Email> & { messageId: string; receivedAt: Date }): Email {
  return {
    provider: 'gmail',
    threadId: THREAD,
    subject: 'Subject',
    body: `body-${over.messageId}`, // unique so content-hash dedup doesn't fire
    from: { email: 'customer@acme.com' },
    tos: [{ email: 'support@tenant.com' }],
    priority: 'normal',
    labels: ['INBOX'],
    ...over,
  };
}

function mkCollection(items: Email[], threadId = THREAD): EmailCollection {
  const times = items.map((e) => new Date(e.receivedAt).getTime());
  return {
    thread: {
      provider: 'gmail',
      threadId,
      subject: items[0]?.subject ?? 'Subject',
      firstMessageAt: new Date(Math.min(...times)),
      lastMessageAt: new Date(Math.max(...times)),
      metadata: {},
    },
    emails: items,
  };
}

const t = (iso: string): Date => new Date(iso);

describe.skipIf(!TEST_DB)('first-reply / TAT integration', () => {
  let db: Database;
  let client: ReturnType<typeof getDatabaseClient>;
  let service: EmailService;

  // The stubbed tenant repo returns whatever domains the current test wants.
  let tenantDomains: string[] | null = ['tenant.com'];
  const tenantRepo = {
    findById: async () => ({ id: TENANT_ID, domains: tenantDomains }),
  } as unknown as TenantRepository;
  const contactRepo = {} as unknown as ContactRepository;

  const insert = (collections: EmailCollection[]) =>
    service.bulkInsertWithThreads(TENANT_ID, INTEGRATION_ID, collections);

  const storedEmails = () => db.select().from(emails).where(eq(emails.tenantId, TENANT_ID));
  const thread = async () =>
    (await db.select().from(emailThreads).where(eq(emailThreads.tenantId, TENANT_ID)))[0];

  beforeAll(async () => {
    db = createDatabase({}) as unknown as Database;
    client = getDatabaseClient();

    // Build the minimal FK closure: tenants → integrations → email_threads → emails.
    for (const f of ['tenants', 'integrations', 'email_threads', 'emails']) {
      await client.unsafe(readFileSync(resolve(SQL_DIR, `${f}.sql`), 'utf-8'));
    }
    await client.unsafe(
      `INSERT INTO tenants (id, name, domains) VALUES ('${TENANT_ID}', 'Test', '{tenant.com}') ON CONFLICT (id) DO NOTHING;`
    );
    await client.unsafe(
      `INSERT INTO integrations (id, tenant_id, source, auth_type, parameters)
       VALUES ('${INTEGRATION_ID}', '${TENANT_ID}', 'gmail', 'oauth', '{}') ON CONFLICT (id) DO NOTHING;`
    );

    service = new EmailService(
      new EmailRepository(db),
      new EmailThreadRepository(db),
      tenantRepo,
      contactRepo,
      db
    );
  });

  beforeEach(async () => {
    tenantDomains = ['tenant.com'];
    await client.unsafe('TRUNCATE emails, email_threads CASCADE;');
  });

  afterAll(async () => {
    await client.end({ timeout: 5 });
  });

  it('stores the customer email and leaves first_reply_at null until a reply arrives', async () => {
    await insert([mkCollection([mkEmail({ messageId: 'c1', receivedAt: t('2026-01-01T09:00:00Z') })])]);

    const rows = await storedEmails();
    expect(rows).toHaveLength(1);
    expect(rows[0].isCustomerEmail).toBe(true);
    expect(rows[0].firstReplyAt).toBeNull();
  });

  it('a later reply sets first_reply_at and is NOT stored; thread last_message_at advances', async () => {
    await insert([mkCollection([mkEmail({ messageId: 'c1', receivedAt: t('2026-01-01T09:00:00Z') })])]);

    // Reply arrives in a separate batch (reply-only).
    await insert([
      mkCollection([
        mkEmail({
          messageId: 'r1',
          from: { email: 'agent@tenant.com' },
          tos: [{ email: 'customer@acme.com' }],
          labels: ['SENT'],
          receivedAt: t('2026-01-01T11:00:00Z'),
        }),
      ]),
    ]);

    const rows = await storedEmails();
    expect(rows).toHaveLength(1); // reply not stored
    expect(rows.some((r) => (r.labels ?? []).includes('SENT'))).toBe(false);
    expect(rows[0].firstReplyAt?.toISOString()).toBe('2026-01-01T11:00:00.000Z');
    expect((await thread())!.lastMessageAt.toISOString()).toBe('2026-01-01T11:00:00.000Z');
  });

  it('customer email + reply in the same batch sets first_reply_at, stores only the customer email', async () => {
    await insert([
      mkCollection([
        mkEmail({ messageId: 'c1', receivedAt: t('2026-01-01T09:00:00Z') }),
        mkEmail({
          messageId: 'r1',
          from: { email: 'agent@tenant.com' },
          tos: [{ email: 'customer@acme.com' }],
          labels: ['SENT'],
          receivedAt: t('2026-01-01T10:00:00Z'),
        }),
      ]),
    ]);

    const rows = await storedEmails();
    expect(rows).toHaveLength(1);
    expect(rows[0].messageId).toBe('c1');
    expect(rows[0].firstReplyAt?.toISOString()).toBe('2026-01-01T10:00:00.000Z');
  });

  it('a reply that arrives before its thread exists is not recorded and nothing is stored', async () => {
    await insert([
      mkCollection([
        mkEmail({
          messageId: 'r1',
          from: { email: 'agent@tenant.com' },
          tos: [{ email: 'customer@acme.com' }],
          labels: ['SENT'],
          receivedAt: t('2026-01-01T11:00:00Z'),
        }),
      ]),
    ]);

    expect(await storedEmails()).toHaveLength(0);
    expect(await thread()).toBeUndefined();
  });

  it('an internal-only note does not set first_reply_at but still advances last_message_at', async () => {
    await insert([mkCollection([mkEmail({ messageId: 'c1', receivedAt: t('2026-01-01T09:00:00Z') })])]);
    await insert([
      mkCollection([
        mkEmail({
          messageId: 'n1',
          from: { email: 'agent@tenant.com' },
          tos: [{ email: 'colleague@tenant.com' }], // internal only — no external recipient
          labels: ['SENT'],
          receivedAt: t('2026-01-01T10:00:00Z'),
        }),
      ]),
    ]);

    const rows = await storedEmails();
    expect(rows[0].firstReplyAt).toBeNull(); // mitigation 1
    expect((await thread())!.lastMessageAt.toISOString()).toBe('2026-01-01T10:00:00.000Z'); // still activity
  });

  it('an auto-submitted reply does not set first_reply_at', async () => {
    await insert([mkCollection([mkEmail({ messageId: 'c1', receivedAt: t('2026-01-01T09:00:00Z') })])]);
    await insert([
      mkCollection([
        mkEmail({
          messageId: 'a1',
          from: { email: 'noreply@tenant.com' },
          tos: [{ email: 'customer@acme.com' }],
          labels: ['SENT'],
          metadata: { autoSubmitted: 'auto-replied' },
          receivedAt: t('2026-01-01T09:05:00Z'),
        }),
      ]),
    ]);

    expect((await storedEmails())[0].firstReplyAt).toBeNull(); // mitigation 2
  });

  it('each customer email gets the first reply AFTER it (MIN correctness)', async () => {
    await insert([
      mkCollection([
        mkEmail({ messageId: 'c1', receivedAt: t('2026-01-01T09:00:00Z') }),
        mkEmail({
          messageId: 'r1',
          from: { email: 'agent@tenant.com' },
          tos: [{ email: 'customer@acme.com' }],
          labels: ['SENT'],
          receivedAt: t('2026-01-01T10:00:00Z'),
        }),
        mkEmail({ messageId: 'c2', receivedAt: t('2026-01-01T11:00:00Z') }),
        mkEmail({
          messageId: 'r2',
          from: { email: 'agent@tenant.com' },
          tos: [{ email: 'customer@acme.com' }],
          labels: ['SENT'],
          receivedAt: t('2026-01-01T12:00:00Z'),
        }),
      ]),
    ]);

    const rows = await storedEmails();
    const byId = Object.fromEntries(rows.map((r) => [r.messageId, r]));
    expect(rows).toHaveLength(2);
    expect(byId.c1.firstReplyAt?.toISOString()).toBe('2026-01-01T10:00:00.000Z'); // r1
    expect(byId.c2.firstReplyAt?.toISOString()).toBe('2026-01-01T12:00:00.000Z'); // r2, not r1
  });

  it('with no tenant domains, reply detection is disabled: everything is stored and first_reply_at stays null', async () => {
    tenantDomains = null;
    await insert([
      mkCollection([
        mkEmail({ messageId: 'c1', receivedAt: t('2026-01-01T09:00:00Z') }),
        mkEmail({
          messageId: 'r1',
          from: { email: 'agent@tenant.com' },
          tos: [{ email: 'customer@acme.com' }],
          labels: ['SENT'],
          receivedAt: t('2026-01-01T10:00:00Z'),
        }),
      ]),
    ]);

    const rows = await storedEmails();
    expect(rows).toHaveLength(2); // mitigation 3 — sent email stored, not dropped
    expect(rows.every((r) => r.firstReplyAt === null)).toBe(true);
  });

  // ── header-only marker path (blacklisted tenant-domain replies) ─────────────
  // These replies are dropped by the Gmail blacklist before being fetched, so
  // the sync forwards only header metadata. applyFirstReplyMarkers must set
  // first_reply_at without ever creating an email row.
  describe('first-reply markers', () => {
    const mkMarker = (
      over: Partial<FirstReplyMarker> & { receivedAt: string }
    ): FirstReplyMarker => ({
      providerThreadId: THREAD,
      fromEmail: 'agent@tenant.com',
      tos: [{ email: 'customer@acme.com' }],
      ccs: [],
      labels: [],
      autoSubmitted: null,
      precedence: null,
      ...over,
    });

    const applyMarkers = (markers: FirstReplyMarker[]) =>
      service.applyFirstReplyMarkers(TENANT_ID, INTEGRATION_ID, markers);

    it('sets first_reply_at on the answered customer email and stores no new row', async () => {
      await insert([mkCollection([mkEmail({ messageId: 'c1', receivedAt: t('2026-01-01T09:00:00Z') })])]);

      const res = await applyMarkers([mkMarker({ receivedAt: '2026-01-01T11:00:00Z' })]);

      expect(res.updatedCount).toBe(1);
      const rows = await storedEmails();
      expect(rows).toHaveLength(1); // marker never creates a row
      expect(rows[0].firstReplyAt?.toISOString()).toBe('2026-01-01T11:00:00.000Z');
    });

    it('ignores an internal-only marker (no external recipient)', async () => {
      await insert([mkCollection([mkEmail({ messageId: 'c1', receivedAt: t('2026-01-01T09:00:00Z') })])]);

      const res = await applyMarkers([
        mkMarker({ tos: [{ email: 'colleague@tenant.com' }], receivedAt: '2026-01-01T10:00:00Z' }),
      ]);

      expect(res.updatedCount).toBe(0);
      expect((await storedEmails())[0].firstReplyAt).toBeNull();
    });

    it('ignores an auto-submitted marker', async () => {
      await insert([mkCollection([mkEmail({ messageId: 'c1', receivedAt: t('2026-01-01T09:00:00Z') })])]);

      const res = await applyMarkers([
        mkMarker({ autoSubmitted: 'auto-replied', receivedAt: '2026-01-01T09:05:00Z' }),
      ]);

      expect(res.updatedCount).toBe(0);
      expect((await storedEmails())[0].firstReplyAt).toBeNull();
    });

    it('is a no-op for a thread that does not exist', async () => {
      const res = await applyMarkers([
        mkMarker({ providerThreadId: 'no-such-thread', receivedAt: '2026-01-01T11:00:00Z' }),
      ]);

      expect(res.updatedCount).toBe(0);
      expect(await storedEmails()).toHaveLength(0);
    });

    it('does not overwrite an existing first_reply_at', async () => {
      await insert([mkCollection([mkEmail({ messageId: 'c1', receivedAt: t('2026-01-01T09:00:00Z') })])]);

      await applyMarkers([mkMarker({ receivedAt: '2026-01-01T11:00:00Z' })]);
      const res = await applyMarkers([mkMarker({ receivedAt: '2026-01-01T10:00:00Z' })]);

      expect(res.updatedCount).toBe(0);
      expect((await storedEmails())[0].firstReplyAt?.toISOString()).toBe('2026-01-01T11:00:00.000Z');
    });

    it('ignores a marker timestamped before the customer email (reply must be after)', async () => {
      await insert([mkCollection([mkEmail({ messageId: 'c1', receivedAt: t('2026-01-01T09:00:00Z') })])]);

      const res = await applyMarkers([mkMarker({ receivedAt: '2026-01-01T08:00:00Z' })]);

      expect(res.updatedCount).toBe(0);
      expect((await storedEmails())[0].firstReplyAt).toBeNull();
    });

    it('disabled when the tenant has no domains configured', async () => {
      tenantDomains = null;
      await insert([mkCollection([mkEmail({ messageId: 'c1', receivedAt: t('2026-01-01T09:00:00Z') })])]);
      tenantDomains = null; // applyFirstReplyMarkers re-reads tenant domains

      const res = await applyMarkers([mkMarker({ receivedAt: '2026-01-01T11:00:00Z' })]);

      expect(res.updatedCount).toBe(0);
    });
  });
});
