/**
 * Run the stored context-search-string queries against the LIVE Gmail mailbox
 * and report what each actually retrieves.
 *
 * This is the test the mirror could never provide: whether these queries return
 * anything useful at real mailbox scale, and whether the self-hit the sanitizer
 * was built to avoid actually shows up.
 *
 * Read-only — Gmail is only ever read, nothing is written to Gmail or the DB.
 */
import dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config({ path: resolve(process.cwd(), '.env.local') });
dotenv.config({ path: resolve(process.cwd(), '.env') });

import { createDatabase, sql } from '@crm/database';

const MAILBOX = 'npradhan@mystartupcfo.com';
const MAX_RESULTS = 10;

interface Stored {
  query: string;
  intent: string;
  subject: string;
  from_email: string;
  received_at: string;
  provider_thread_id: string;
  message_id: string;
}

async function accessTokenFor(db: any, mailbox: string): Promise<string> {
  const rows = (await db.execute(sql`
    SELECT refresh_token, token, parameters
    FROM integrations
    WHERE source = 'gmail' AND is_active = true
  `)) as any[];

  const clientId = process.env.GOOGLE_CLIENT_ID as string;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET as string;

  for (const row of rows) {
    const params = Object.fromEntries((row.parameters ?? []).map((p: any) => [p.key, p.value]));
    if (String(params.email ?? '').toLowerCase() !== mailbox) continue;

    const refreshToken = row.refresh_token ?? row.token;
    if (!refreshToken) continue;

    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }),
    });
    if (!res.ok) continue;
    return ((await res.json()) as { access_token: string }).access_token;
  }
  throw new Error(`No working refresh token for ${mailbox}`);
}

async function gmail(path: string, token: string): Promise<any> {
  const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 160)}`);
  return res.json();
}

async function main(): Promise<void> {
  const db = createDatabase({});
  const token = await accessTokenFor(db, MAILBOX);

  const stored = (await db.execute(sql`
    SELECT a.result->>'query' AS query,
           a.result->>'intent' AS intent,
           e.subject, e.from_email, e.received_at, e.message_id,
           t.provider_thread_id
    FROM email_analyses a
    JOIN emails e ON e.id = a.email_id
    JOIN email_threads t ON t.id = e.thread_id
    WHERE a.analysis_type = 'context-search-string'
    ORDER BY e.received_at ASC
  `)) as unknown as Stored[];

  console.log(`Mailbox: ${MAILBOX}   queries: ${stored.length}\n`);

  let totalHits = 0;
  let emptyQueries = 0;

  for (const s of stored) {
    console.log('='.repeat(94));
    console.log(`SOURCE : ${String(s.received_at).slice(0, 16)}  ${s.from_email}`);
    console.log(`         ${s.subject}`);
    console.log(`INTENT : ${s.intent}`);
    console.log(`QUERY  : ${s.query}`);

    let list: any;
    try {
      list = await gmail(
        `messages?q=${encodeURIComponent(s.query)}&maxResults=${MAX_RESULTS}`,
        token
      );
    } catch (err: any) {
      console.log(`RESULT : ERROR — ${err.message}\n`);
      continue;
    }

    const ids: Array<{ id: string; threadId: string }> = list.messages ?? [];
    const estimate = list.resultSizeEstimate ?? 0;
    if (ids.length === 0) {
      emptyQueries++;
      console.log(`RESULT : 0 matches  (estimate ${estimate})\n`);
      continue;
    }
    totalHits += ids.length;
    console.log(`RESULT : ${ids.length} returned (estimate ${estimate})`);

    // Hydrate metadata — the same per-candidate cost the drop bar would pay.
    for (const m of ids) {
      const meta = await gmail(
        `messages/${m.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`,
        token
      );
      const headers: Array<{ name: string; value: string }> = meta.payload?.headers ?? [];
      const h = (n: string): string =>
        headers.find((x) => x.name.toLowerCase() === n.toLowerCase())?.value ?? '';
      const sameThread = m.threadId === s.provider_thread_id;
      const isSelf = m.id === s.message_id;
      const marker = isSelf ? ' <-- THE SOURCE EMAIL ITSELF' : sameThread ? ' <-- same thread' : '';
      console.log(
        `   ${h('Date').slice(0, 22).padEnd(24)} ${h('From').slice(0, 34).padEnd(36)} ${h('Subject').slice(0, 44)}${marker}`
      );
    }
    console.log();
  }

  console.log('='.repeat(94));
  console.log(`Queries returning nothing : ${emptyQueries}/${stored.length}`);
  console.log(`Total candidates returned : ${totalHits}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
