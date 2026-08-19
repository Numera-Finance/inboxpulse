/**
 * Temporarily isolate ONE gmail mailbox as the tenant's sole active integration,
 * so the sync/credential-resolution path (getCredentials -> limit(1) active)
 * deterministically targets it — then restore the others afterward.
 *
 * The sync + credential lookups key off (tenantId, source, isActive) with no
 * ordering, so with two active gmail rows the resolved mailbox is arbitrary.
 * This flips isActive to pin exactly the mailbox we want for a one-off backfill.
 *
 * Modes (clone DB only):
 *   ISOLATE_EMAIL=npradhan@mystartupcfo.com  bun scripts/set-active-mailbox.ts
 *     -> keeps the row whose email == ISOLATE_EMAIL active, deactivates every
 *        other currently-active gmail row, and prints their ids (for restore).
 *   REACTIVATE_IDS=<id,id>  bun scripts/set-active-mailbox.ts
 *     -> sets isActive=true on exactly those ids.
 *   STATUS=1  bun scripts/set-active-mailbox.ts   -> just print active gmail rows.
 */
import dotenv from 'dotenv';
import { resolve } from 'path';
dotenv.config({ path: resolve(process.cwd(), '.env.local') });
dotenv.config({ path: resolve(process.cwd(), '.env') });

import { createDatabase, sql } from '@crm/database';

const TENANT_ID = process.env.PROBE_TENANT_ID ?? '9f34e10b-27d1-457a-bcdc-590f2eb9fa4a';

interface Row { id: string; email: string; is_active: boolean }

async function activeGmailRows(db: ReturnType<typeof createDatabase>): Promise<Row[]> {
  const rows = (await db.execute(sql`
    SELECT i.id,
           (SELECT p->>'value' FROM jsonb_array_elements(i.parameters) p WHERE p->>'key'='email' LIMIT 1) AS email,
           i.is_active
    FROM integrations i
    WHERE i.tenant_id = ${TENANT_ID} AND i.source = 'gmail' AND i.is_active = true
    ORDER BY i.last_run_at DESC NULLS LAST
  `)) as unknown as Row[];
  return rows;
}

async function main(): Promise<void> {
  const db = createDatabase({});

  if (process.env.STATUS) {
    console.log('ACTIVE gmail rows:', JSON.stringify(await activeGmailRows(db), null, 2));
    process.exit(0);
  }

  if (process.env.REACTIVATE_IDS) {
    const ids = process.env.REACTIVATE_IDS.split(',').map((s) => s.trim()).filter(Boolean);
    for (const id of ids) {
      await db.execute(sql`UPDATE integrations SET is_active = true, updated_at = now() WHERE id = ${id}`);
    }
    console.log(`Reactivated ${ids.length} integration(s):`, ids.join(', '));
    console.log('Now active:', JSON.stringify(await activeGmailRows(db), null, 2));
    process.exit(0);
  }

  const keepEmail = process.env.ISOLATE_EMAIL;
  if (!keepEmail) {
    console.error('Set ISOLATE_EMAIL, REACTIVATE_IDS, or STATUS. Aborting.');
    process.exit(1);
  }

  const before = await activeGmailRows(db);
  const keep = before.filter((r) => (r.email ?? '').toLowerCase() === keepEmail.toLowerCase());
  const drop = before.filter((r) => (r.email ?? '').toLowerCase() !== keepEmail.toLowerCase());

  if (keep.length === 0) {
    console.error(`No ACTIVE gmail integration with email=${keepEmail}. Active rows:`, JSON.stringify(before, null, 2));
    console.error('Complete the OAuth consent for that mailbox first.');
    process.exit(2);
  }
  if (keep.length > 1) {
    console.error(`Multiple active rows for ${keepEmail}; refusing to guess:`, JSON.stringify(keep, null, 2));
    process.exit(3);
  }

  for (const r of drop) {
    await db.execute(sql`UPDATE integrations SET is_active = false, updated_at = now() WHERE id = ${r.id}`);
  }

  console.log(`Isolated ${keepEmail} (id=${keep[0].id}) as the sole active gmail integration.`);
  console.log(`Deactivated ${drop.length} row(s). RESTORE with:`);
  console.log(`  REACTIVATE_IDS=${drop.map((r) => r.id).join(',')} bun scripts/set-active-mailbox.ts`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
