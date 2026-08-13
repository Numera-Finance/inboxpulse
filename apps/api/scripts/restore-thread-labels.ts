/**
 * Re-apply InboxPulse labels to the messages of ONE thread.
 *
 * Companion to apply-gmail-labels.ts, which sweeps the whole mailbox. This is
 * for the narrow case of putting back a label that was removed from a single
 * thread by hand: same signal→label mapping, scoped to messages whose subject
 * matches, so it can't touch anything else in the mailbox.
 *
 * Only ever calls addLabelIds — it never removes a label from anything.
 * The database is the source of truth: labels are derived from emails.signals,
 * which a Gmail-side removal does not affect.
 *
 * Run from apps/api (DRY RUN by default — no Gmail calls at all):
 *   SUBJECT='US New joiners' bun scripts/restore-thread-labels.ts
 *
 * To actually write:
 *   SUBJECT='US New joiners' APPLY=1 bun scripts/restore-thread-labels.ts
 */
import dotenv from 'dotenv';
import { resolve } from 'path';
dotenv.config({ path: resolve(process.cwd(), '.env.local') });
dotenv.config({ path: resolve(process.cwd(), '.env') });

import { createDatabase, sql } from '@crm/database';
import { google, gmail_v1 } from 'googleapis';

const INTEGRATION_ID = process.env.INTEGRATION_ID;
const SUBJECT = process.env.SUBJECT ?? '';
const APPLY = Boolean(process.env.APPLY);

const NS = 'InboxPulse';

interface LabelSpec {
  name: string;
  bg: string;
  text: string;
}

/** Mirrors SPEC in apply-gmail-labels.ts — keep the two in step. */
const SPEC = {
  atRisk: { name: `${NS}/At risk`, bg: '#fb4c2f', text: '#ffffff' },
  churn: { name: `${NS}/Churn risk`, bg: '#ffad47', text: '#ffffff' },
  upsell: { name: `${NS}/Upsell`, bg: '#16a765', text: '#ffffff' },
  kudos: { name: `${NS}/Kudos`, bg: '#42d692', text: '#ffffff' },
  competitor: { name: `${NS}/Competitor`, bg: '#a479e2', text: '#ffffff' },
  negative: { name: `${NS}/Negative`, bg: '#fb4c2f', text: '#ffffff' },
  positive: { name: `${NS}/Positive`, bg: '#16a765', text: '#ffffff' },
  automated: { name: `${NS}/Automated`, bg: '#999999', text: '#ffffff' },
  spam: { name: `${NS}/Spam`, bg: '#999999', text: '#ffffff' },
  marketing: { name: `${NS}/Marketing`, bg: '#999999', text: '#ffffff' },
  transactional: { name: `${NS}/Transactional`, bg: '#999999', text: '#ffffff' },
} satisfies Record<string, LabelSpec>;

function specsForSignals(signals: number[]): LabelSpec[] {
  const s = new Set(signals);
  const out: LabelSpec[] = [];
  if (s.has(10)) out.push(SPEC.atRisk);
  // CHURN_LOW (30) is deliberately excluded. It is not a flag: 28,226 emails
  // carry it against 4,015 at medium or above, and a sample of low rows have
  // reasoning that says in terms "no signs of churn". The panel stopped
  // treating low as a flag for that reason; a LABEL is worse than a panel
  // section, because it writes a red marker into someone's actual mailbox and
  // 87% of them would be wrong.
  if (s.has(31) || s.has(32) || s.has(33)) out.push(SPEC.churn);
  if (s.has(50)) out.push(SPEC.competitor);
  if (s.has(20)) out.push(SPEC.upsell);
  if (s.has(40)) out.push(SPEC.kudos);
  if (s.has(2)) out.push(SPEC.negative);
  if (s.has(1)) out.push(SPEC.positive);
  if (s.has(60)) out.push(SPEC.spam);
  else if (s.has(61)) out.push(SPEC.marketing);
  else if (s.has(62)) out.push(SPEC.transactional);
  else if (s.has(63)) out.push(SPEC.automated);
  return out;
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
  const json = (await res.json()) as { access_token?: string; scope?: string };
  if (!res.ok || !json.access_token) {
    throw new Error(`token refresh failed: ${JSON.stringify(json).slice(0, 200)}`);
  }
  if (!json.scope?.includes('gmail.modify')) {
    throw new Error(`token lacks gmail.modify (has: ${json.scope}). Re-consent with the write scope first.`);
  }
  return json.access_token;
}

async function main(): Promise<void> {
  if (!SUBJECT) throw new Error('SUBJECT env var is required (substring match on the thread subject)');

  const db = createDatabase({});

  const rows = (await db.execute(sql`
    SELECT message_id, signals, left(subject, 70) AS subject
    FROM emails
    WHERE integration_id = ${INTEGRATION_ID}
      AND subject ILIKE ${'%' + SUBJECT + '%'}
      AND array_length(signals, 1) > 0
    ORDER BY received_at
  `)) as unknown as Array<{ message_id: string; signals: number[]; subject: string }>;

  console.log(`Matched ${rows.length} analyzed message(s) for subject ~ "${SUBJECT}". APPLY=${APPLY}\n`);

  const plan = rows
    .map((r) => ({ ...r, specs: specsForSignals(r.signals ?? []) }))
    .filter((r) => r.specs.length > 0);

  for (const r of plan) {
    console.log(
      `  [${r.signals.join(',')}] ${r.specs.map((s) => s.name).join(', ').padEnd(34)} ← ${r.subject}`
    );
  }

  if (!APPLY) {
    console.log(`\nDRY RUN — nothing sent to Gmail. Re-run with APPLY=1 to add these labels.`);
    process.exit(0);
  }

  const [itg] = (await db.execute(sql`
    SELECT refresh_token, token,
           (SELECT p->>'value' FROM jsonb_array_elements(parameters) p WHERE p->>'key'='email' LIMIT 1) AS email
    FROM integrations WHERE id = ${INTEGRATION_ID}
  `)) as unknown as Array<{ refresh_token: string | null; token: string | null; email: string }>;
  if (!itg) throw new Error(`integration ${INTEGRATION_ID} not found`);
  const refreshToken = itg.refresh_token || itg.token;
  if (!refreshToken) throw new Error('integration has no refresh token');

  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: await accessTokenFor(refreshToken) });
  const gmail: gmail_v1.Gmail = google.gmail({ version: 'v1', auth });

  const existing = new Map<string, string>();
  const list = await gmail.users.labels.list({ userId: 'me' });
  for (const l of list.data.labels ?? []) if (l.name && l.id) existing.set(l.name, l.id);

  let applied = 0;
  for (const r of plan) {
    const labelIds: string[] = [];
    for (const spec of r.specs) {
      let id = existing.get(spec.name);
      if (!id) {
        const created = await gmail.users.labels.create({
          userId: 'me',
          requestBody: {
            name: spec.name,
            labelListVisibility: 'labelShow',
            messageListVisibility: 'show',
            color: { backgroundColor: spec.bg, textColor: spec.text },
          },
        });
        id = created.data.id as string;
        existing.set(spec.name, id);
      }
      labelIds.push(id);
    }
    await gmail.users.messages.modify({
      userId: 'me',
      id: r.message_id,
      requestBody: { addLabelIds: labelIds },
    });
    applied++;
  }

  console.log(`\nRestored labels on ${applied} message(s) in ${itg.email}.`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
