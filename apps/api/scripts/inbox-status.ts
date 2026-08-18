/**
 * Ground-truth report on the tenant's ingested emails: total, analysis coverage,
 * how many carry the Gmail INBOX label, and how those INBOX emails break down by
 * analysis status. Read-only.
 *
 * Run from apps/api:  bun scripts/inbox-status.ts
 */
import dotenv from 'dotenv';
import { resolve } from 'path';
dotenv.config({ path: resolve(process.cwd(), '.env.local') });
dotenv.config({ path: resolve(process.cwd(), '.env') });

import { createDatabase, sql } from '@crm/database';

const TENANT_ID = process.env.PROBE_TENANT_ID ?? '9f34e10b-27d1-457a-bcdc-590f2eb9fa4a';

async function q<T>(db: ReturnType<typeof createDatabase>, s: ReturnType<typeof sql>): Promise<T[]> {
  return (await db.execute(s)) as unknown as T[];
}

async function main(): Promise<void> {
  const db = createDatabase({});

  const [totals] = await q<{ total: string; analyzed: string; with_signals: string }>(
    db,
    sql`SELECT count(*)::text total,
               count(*) FILTER (WHERE analysis_status = 3)::text analyzed,
               count(*) FILTER (WHERE array_length(signals,1) > 0)::text with_signals
        FROM emails WHERE tenant_id = ${TENANT_ID}`
  );
  console.log('ALL EMAILS:', totals);

  const [inbox] = await q<{ total: string; analyzed: string; pending: string; null_status: string }>(
    db,
    sql`SELECT count(*)::text total,
               count(*) FILTER (WHERE analysis_status = 3)::text analyzed,
               count(*) FILTER (WHERE analysis_status IN (1,2))::text pending,
               count(*) FILTER (WHERE analysis_status IS NULL)::text null_status
        FROM emails
        WHERE tenant_id = ${TENANT_ID} AND 'INBOX' = ANY(labels)`
  );
  console.log("EMAILS WITH 'INBOX' LABEL:", inbox);

  // Distinct label values present, to confirm INBOX is actually populated.
  const labelRows = await q<{ label: string; n: string }>(
    db,
    sql`SELECT unnest(labels) label, count(*)::text n
        FROM emails WHERE tenant_id = ${TENANT_ID}
        GROUP BY 1 ORDER BY count(*) DESC LIMIT 25`
  );
  console.log('TOP LABELS:', labelRows);

  // Recent INBOX emails, newest first — a sense of what "the inbox" contains.
  const recent = await q<{
    received_at: string; from_email: string; subject: string;
    analysis_status: number | null; signals: number[] | null; is_customer_email: boolean | null;
  }>(
    db,
    sql`SELECT received_at, from_email, left(subject,60) subject, analysis_status, signals, is_customer_email
        FROM emails
        WHERE tenant_id = ${TENANT_ID} AND 'INBOX' = ANY(labels)
        ORDER BY received_at DESC LIMIT 15`
  );
  console.log('RECENT INBOX EMAILS:');
  for (const r of recent) {
    console.log(
      `  ${new Date(r.received_at).toISOString().slice(0, 10)}  st=${r.analysis_status ?? '-'} ` +
        `cust=${r.is_customer_email ?? '-'} sig=[${(r.signals ?? []).join(',')}]  ${r.from_email}  ${r.subject}`
    );
  }

  // Un-analyzed INBOX customer emails, by month — the actual work backlog.
  const backlog = await q<{ month: string; n: string }>(
    db,
    sql`SELECT to_char(date_trunc('month', received_at), 'YYYY-MM') AS ym, count(*)::text n
        FROM emails
        WHERE tenant_id = ${TENANT_ID} AND 'INBOX' = ANY(labels)
          AND (analysis_status IS NULL OR analysis_status <> 3)
        GROUP BY 1 ORDER BY 1 DESC LIMIT 12`
  );
  console.log('UN-ANALYZED INBOX BACKLOG BY MONTH:', backlog);

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
