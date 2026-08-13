/**
 * Apply InboxPulse analysis flags to a Gmail mailbox as native, colored Gmail
 * labels — so they render directly in the user's inbox rows.
 *
 * Reads the analyzed emails for a specific integration (mailbox) from the clone
 * DB, maps each email's `signals` to a set of `InboxPulse/<Flag>` labels,
 * ensures those labels exist (creating them with colors, best-effort), and
 * applies them to the exact messages via users.messages.modify(addLabelIds).
 *
 * Requires the mailbox's OAuth token to carry gmail.modify (re-consent first).
 * Everything it creates is namespaced under `InboxPulse/` so it's trivially
 * removable. Idempotent: re-running only adds missing labels.
 *
 * Run from apps/api:
 *   INTEGRATION_ID=<npradhan gmail integration id> bun scripts/apply-gmail-labels.ts
 *   DRY_RUN=1 ... to preview without writing to Gmail.
 */
import dotenv from 'dotenv';
import { resolve } from 'path';
dotenv.config({ path: resolve(process.cwd(), '.env.local') });
dotenv.config({ path: resolve(process.cwd(), '.env') });

import { createDatabase, sql } from '@crm/database';
import { google, gmail_v1 } from 'googleapis';

const INTEGRATION_ID = process.env.INTEGRATION_ID ?? '019f957c-d3b0-747d-a510-36fb66fb0fa3';
const DRY_RUN = Boolean(process.env.DRY_RUN);

/** Gmail label spec keyed by a stable name; color uses Gmail's allowed palette. */
interface LabelSpec {
  name: string; // full Gmail label name, e.g. "InboxPulse/At risk"
  bg: string;
  text: string;
}

const NS = 'InboxPulse';
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

/** Map an email's signal codes to the set of label specs it should carry. */
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
  // Classification (mutually exclusive in practice) — skip 64 Business (the
  // "normal" tag) and 3 Neutral (the default) to avoid labelling everything.
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
  const json = (await res.json()) as { access_token?: string; scope?: string; error?: string };
  if (!res.ok || !json.access_token) throw new Error(`token refresh failed: ${JSON.stringify(json).slice(0, 200)}`);
  if (!json.scope?.includes('gmail.modify')) {
    throw new Error(
      `token is missing gmail.modify scope (has: ${json.scope}). Re-consent with the write scope first.`,
    );
  }
  return json.access_token;
}

/** Ensure a label exists; return its id. Creates with color, falling back to no color on a palette rejection. */
async function ensureLabel(
  gmail: gmail_v1.Gmail,
  existing: Map<string, string>,
  spec: LabelSpec,
): Promise<string> {
  const found = existing.get(spec.name);
  if (found) return found;

  const base: gmail_v1.Schema$Label = {
    name: spec.name,
    labelListVisibility: 'labelShow',
    messageListVisibility: 'show',
  };
  try {
    const res = await gmail.users.labels.create({
      userId: 'me',
      requestBody: { ...base, color: { backgroundColor: spec.bg, textColor: spec.text } },
    });
    existing.set(spec.name, res.data.id as string);
    return res.data.id as string;
  } catch (err: unknown) {
    // Most likely an unaccepted color combo — retry without color so the label
    // still gets created (just without the palette tint).
    const res = await gmail.users.labels.create({ userId: 'me', requestBody: base });
    existing.set(spec.name, res.data.id as string);
    console.warn(`  (created "${spec.name}" without color — palette rejected)`);
    return res.data.id as string;
  }
}

async function main(): Promise<void> {
  const db = createDatabase({});

  const [itg] = (await db.execute(sql`
    SELECT refresh_token, token,
           (SELECT p->>'value' FROM jsonb_array_elements(parameters) p WHERE p->>'key'='email' LIMIT 1) AS email
    FROM integrations WHERE id = ${INTEGRATION_ID}
  `)) as unknown as Array<{ refresh_token: string | null; token: string | null; email: string }>;
  if (!itg) throw new Error(`integration ${INTEGRATION_ID} not found`);
  const refreshToken = itg.refresh_token || itg.token;
  if (!refreshToken) throw new Error('integration has no refresh token');

  const rows = (await db.execute(sql`
    SELECT message_id, signals, left(subject,60) AS subject
    FROM emails
    WHERE integration_id = ${INTEGRATION_ID} AND analysis_status = 3
      AND array_length(signals, 1) > 0
    ORDER BY received_at DESC
  `)) as unknown as Array<{ message_id: string; signals: number[]; subject: string }>;

  console.log(`Mailbox ${itg.email} — ${rows.length} analyzed email(s). DRY_RUN=${DRY_RUN}`);

  // DRY_RUN validates the DB read + signal→label plan without any Gmail/token
  // calls, so it works before the write-scope re-consent has happened.
  let gmail: gmail_v1.Gmail | null = null;
  const existing = new Map<string, string>();
  if (!DRY_RUN) {
    const accessToken = await accessTokenFor(refreshToken);
    const auth = new google.auth.OAuth2();
    auth.setCredentials({ access_token: accessToken });
    gmail = google.gmail({ version: 'v1', auth });
    const list = await gmail.users.labels.list({ userId: 'me' });
    for (const l of list.data.labels ?? []) if (l.name && l.id) existing.set(l.name, l.id);
  }

  let labeled = 0;
  const perLabelCount: Record<string, number> = {};

  for (const row of rows) {
    const specs = specsForSignals(row.signals ?? []);
    if (specs.length === 0) continue;

    const labelIds: string[] = [];
    for (const spec of specs) {
      const id = DRY_RUN || !gmail ? (existing.get(spec.name) ?? '(new)') : await ensureLabel(gmail, existing, spec);
      labelIds.push(id);
      perLabelCount[spec.name] = (perLabelCount[spec.name] ?? 0) + 1;
    }

    const names = specs.map((s) => s.name.replace(`${NS}/`, '')).join(', ');
    console.log(`  [${row.signals.join(',')}] ${names.padEnd(28)} ← ${row.subject}`);

    if (!DRY_RUN && gmail) {
      await gmail.users.messages.modify({
        userId: 'me',
        id: row.message_id,
        requestBody: { addLabelIds: labelIds },
      });
      labeled++;
    }
  }

  console.log(`\n${DRY_RUN ? 'WOULD LABEL' : 'LABELED'} ${DRY_RUN ? rows.filter((r) => specsForSignals(r.signals ?? []).length).length : labeled} message(s).`);
  console.log('Per-label counts:', JSON.stringify(perLabelCount, null, 2));
  process.exit(0);
}

main().catch((e) => {
  console.error('FAILED:', e instanceof Error ? e.message : e);
  process.exit(1);
});
