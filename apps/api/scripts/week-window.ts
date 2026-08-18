/**
 * Report on emails received in the past N days for the tenant: how many exist,
 * how many are already analyzed vs pending, plus a day-by-day breakdown and the
 * exact list of pending IDs (written to scratchpad for the analyze step).
 * Read-only except for writing the ID list file. Run from apps/api.
 */
import dotenv from 'dotenv';
import { resolve } from 'path';
import { writeFileSync } from 'fs';
dotenv.config({ path: resolve(process.cwd(), '.env.local') });
dotenv.config({ path: resolve(process.cwd(), '.env') });

import { createDatabase, sql } from '@crm/database';

const TENANT_ID = process.env.PROBE_TENANT_ID ?? '9f34e10b-27d1-457a-bcdc-590f2eb9fa4a';
const SINCE_DAYS = Number(process.env.SINCE_DAYS ?? '7');
const OUT = process.env.PENDING_OUT ?? 'C:/Users/NPRADH~1/AppData/Local/Temp/claude/c--Users-npradhan-mystartupcf-Downloads-7-21-inboxpulse/e7e8f0e5-59f3-4f5b-8d12-fb11f70bd4e0/scratchpad/pending-week-ids.txt';

async function main(): Promise<void> {
  const db = createDatabase({});
  const cutoff = sql`now() - (${SINCE_DAYS} || ' days')::interval`;

  const [tot] = (await db.execute(sql`
    SELECT count(*)::text total,
           count(*) FILTER (WHERE analysis_status = 3)::text analyzed,
           count(*) FILTER (WHERE analysis_status IS DISTINCT FROM 3)::text pending
    FROM emails WHERE tenant_id = ${TENANT_ID} AND received_at >= ${cutoff}
  `)) as unknown as Array<Record<string, string>>;
  console.log(`PAST ${SINCE_DAYS} DAYS:`, tot);

  const byDay = (await db.execute(sql`
    SELECT to_char(date_trunc('day', received_at),'YYYY-MM-DD') AS d,
           count(*)::text total,
           count(*) FILTER (WHERE analysis_status IS DISTINCT FROM 3)::text pending
    FROM emails WHERE tenant_id = ${TENANT_ID} AND received_at >= ${cutoff}
    GROUP BY 1 ORDER BY 1 DESC
  `)) as unknown as Array<Record<string, string>>;
  console.log('BY DAY (total / pending):');
  for (const r of byDay) console.log(`  ${r.d}  total=${r.total}  pending=${r.pending}`);

  const ids = (await db.execute(sql`
    SELECT id FROM emails
    WHERE tenant_id = ${TENANT_ID} AND received_at >= ${cutoff}
      AND analysis_status IS DISTINCT FROM 3
      AND body IS NOT NULL AND length(body) > 0
    ORDER BY received_at ASC
  `)) as unknown as Array<{ id: string }>;
  writeFileSync(OUT, ids.map((r) => r.id).join('\n'));
  console.log(`Wrote ${ids.length} pending (with-body) past-week email IDs to:\n  ${OUT}`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
