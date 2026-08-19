/**
 * Pull a sample of un-analyzed (pending) INBOX emails and confirm they have
 * bodies to analyze. Read-only. Run from apps/api: bun scripts/pending-sample.ts
 */
import dotenv from 'dotenv';
import { resolve } from 'path';
dotenv.config({ path: resolve(process.cwd(), '.env.local') });
dotenv.config({ path: resolve(process.cwd(), '.env') });

import { createDatabase, sql } from '@crm/database';

const TENANT_ID = process.env.PROBE_TENANT_ID ?? '9f34e10b-27d1-457a-bcdc-590f2eb9fa4a';

async function main(): Promise<void> {
  const db = createDatabase({});

  const [counts] = (await db.execute(sql`
    SELECT
      count(*) FILTER (WHERE analysis_status = 1)::text pending1,
      count(*) FILTER (WHERE analysis_status = 2)::text processing2,
      count(*) FILTER (WHERE (analysis_status IS NULL OR analysis_status NOT IN (3))
                        AND (body IS NULL OR length(body) = 0))::text unanalyzed_no_body
    FROM emails WHERE tenant_id = ${TENANT_ID}
  `)) as unknown as Array<Record<string, string>>;
  console.log('PENDING COUNTS:', counts);

  const rows = (await db.execute(sql`
    SELECT id, analysis_status, received_at, from_email, left(subject,50) subject,
           (body IS NOT NULL AND length(body) > 0) AS has_body, length(body) blen
    FROM emails
    WHERE tenant_id = ${TENANT_ID} AND (analysis_status IS NULL OR analysis_status <> 3)
    ORDER BY received_at DESC LIMIT 8
  `)) as unknown as Array<Record<string, unknown>>;
  for (const r of rows) {
    console.log(
      `  id=${r.id} st=${r.analysis_status} body=${r.has_body}(${r.blen}) ${String(r.from_email)} | ${String(r.subject)}`
    );
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
