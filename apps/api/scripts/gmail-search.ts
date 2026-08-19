/**
 * Read-only Gmail search over a specific integration's mailbox (direct token).
 * Lists matching threads with message counts, subjects, and senders — used to
 * scope what to ingest. Requires the mailbox token (readonly is enough).
 *
 * Run from apps/api:  QUERY='subject:(Proposed InboxPulse design)' bun scripts/gmail-search.ts
 */
import dotenv from 'dotenv';
import { resolve } from 'path';
dotenv.config({ path: resolve(process.cwd(), '.env.local') });
dotenv.config({ path: resolve(process.cwd(), '.env') });

import { createDatabase, sql } from '@crm/database';
import { google } from 'googleapis';

const INTEGRATION_ID = process.env.INTEGRATION_ID ?? '019f957c-d3b0-747d-a510-36fb66fb0fa3';
const QUERY = process.env.QUERY ?? 'InboxPulse';

function header(msg: any, name: string): string {
  const h = (msg?.payload?.headers ?? []).find((x: any) => x.name?.toLowerCase() === name.toLowerCase());
  return h?.value ?? '';
}

async function main(): Promise<void> {
  const db = createDatabase({});
  const [itg] = (await db.execute(sql`SELECT refresh_token, token FROM integrations WHERE id = ${INTEGRATION_ID}`)) as unknown as Array<{ refresh_token: string | null; token: string | null }>;
  const rt = itg.refresh_token || itg.token;
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID as string, client_secret: process.env.GOOGLE_CLIENT_SECRET as string, refresh_token: rt as string, grant_type: 'refresh_token' }),
  });
  const tok = (await res.json()).access_token as string;
  const auth = new google.auth.OAuth2(); auth.setCredentials({ access_token: tok });
  const gmail = google.gmail({ version: 'v1', auth });

  const tl = await gmail.users.threads.list({ userId: 'me', q: QUERY, maxResults: 25 });
  const threads = tl.data.threads ?? [];
  console.log(`QUERY="${QUERY}" → ${threads.length} thread(s)\n`);

  for (const t of threads) {
    const th = await gmail.users.threads.get({ userId: 'me', id: t.id as string, format: 'metadata', metadataHeaders: ['Subject', 'From', 'Date'] });
    const msgs = th.data.messages ?? [];
    const subj = header(msgs[0], 'Subject');
    console.log(`thread ${t.id}  (${msgs.length} msg)  "${subj}"`);
    for (const m of msgs) {
      console.log(`   - ${header(m, 'Date').slice(0, 25).padEnd(26)} ${header(m, 'From').slice(0, 45)}  | ${header(m, 'Subject').slice(0, 45)}  [id=${m.id}]`);
    }
    console.log('');
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
