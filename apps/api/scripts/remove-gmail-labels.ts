/**
 * Remove every label InboxPulse has written to a Gmail mailbox.
 *
 * This existed only as a claim. `apply-gmail-labels.ts` says the labels are
 * "namespaced under InboxPulse/ so they're trivially removable", and
 * `restore-thread-labels.ts` only ever calls addLabelIds — nothing in the
 * repository could take a label off. A sweep that cannot be undone should never
 * have been runnable, and it was: a run against one mailbox put roughly 103,000
 * labels on it (Automated 64,992 + Churn risk 32,241 + Spam 6,157), including
 * "Churn risk · Low" on a message reading "Works for me as well. Thank you."
 *
 * Deleting the LABEL is what makes this cheap. Gmail removes a deleted label
 * from every message that carried it, so teardown is one call per label rather
 * than one per message — which is the whole payoff of namespacing, and the
 * reason it is safe to experiment with labels at all.
 *
 * Only touches labels whose name starts with `InboxPulse/`. It will not delete
 * a user's own labels, and it names every label before deleting it.
 *
 * Run from apps/api:
 *   DRY_RUN=1 INTEGRATION_ID=<id> bun scripts/remove-gmail-labels.ts   # preview
 *   INTEGRATION_ID=<id> bun scripts/remove-gmail-labels.ts             # delete
 *
 * Find the id, and check WHOSE mailbox it is, first:
 *   select id, parameters->0->>'value' from integrations where is_active;
 */
import dotenv from 'dotenv';
import { resolve } from 'path';
dotenv.config({ path: resolve(process.cwd(), '.env.local') });
dotenv.config({ path: resolve(process.cwd(), '.env') });

import { createDatabase, sql } from '@crm/database';
import { google } from 'googleapis';

const INTEGRATION_ID = process.env.INTEGRATION_ID;
const DRY_RUN = Boolean(process.env.DRY_RUN);
const NS = 'InboxPulse/';

if (!INTEGRATION_ID) {
  console.error(
    'INTEGRATION_ID is required — this modifies a real mailbox.\n' +
      '  DRY_RUN=1 INTEGRATION_ID=<id> bun scripts/remove-gmail-labels.ts\n' +
      'Find the id and whose mailbox it is:\n' +
      "  select id, parameters->0->>'value' from integrations where is_active;",
  );
  process.exit(1);
}

async function accessTokenFor(refreshToken: string): Promise<string> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID as string,
      client_secret: process.env.GOOGLE_CLIENT_SECRET as string,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  const json = (await res.json()) as { access_token?: string; error_description?: string };
  if (!json.access_token) throw new Error(`token refresh failed: ${json.error_description ?? 'unknown'}`);
  return json.access_token;
}

async function main(): Promise<void> {
  const db = createDatabase(process.env.DATABASE_URL as string);

  const rows = (await db.execute(sql`
    SELECT token, parameters->0->>'value' AS mailbox
    FROM integrations WHERE id = ${INTEGRATION_ID}
  `)) as unknown as Array<{ token: string | null; mailbox: string | null }>;

  const row = rows[0];
  if (!row?.token) throw new Error(`no refresh token for integration ${INTEGRATION_ID}`);

  // Say whose mailbox this is before touching it. The apply script defaulted to
  // a colleague's id, so "which mailbox am I about to change" is a question the
  // operator should never have to go and look up.
  console.log(`mailbox: ${row.mailbox ?? '(unknown)'}${DRY_RUN ? '   [DRY RUN]' : ''}`);

  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: await accessTokenFor(row.token) });
  const gmail = google.gmail({ version: 'v1', auth });

  const list = await gmail.users.labels.list({ userId: 'me' });
  const ours = (list.data.labels ?? []).filter((l) => (l.name ?? '').startsWith(NS));

  if (!ours.length) {
    console.log('no InboxPulse labels on this mailbox — nothing to do');
    return;
  }

  console.log(`found ${ours.length} label(s) to remove:`);
  for (const l of ours) console.log(`  ${l.name}  (${l.messagesTotal ?? '?'} messages)`);

  if (DRY_RUN) {
    console.log('\nDRY RUN — nothing deleted. Re-run without DRY_RUN to remove.');
    return;
  }

  for (const l of ours) {
    // Deleting the label detaches it from every message that carried it.
    await gmail.users.labels.delete({ userId: 'me', id: l.id as string });
    console.log(`  removed ${l.name}`);
  }
  console.log(`\ndone — ${ours.length} label(s) removed from ${row.mailbox ?? 'the mailbox'}`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
