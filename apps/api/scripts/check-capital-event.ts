/**
 * Run the real detector over the real corpus.
 *
 * Unit tests prove the rules do what I wrote them to do. This proves what they
 * do to 80,000 threads of actual mail, which is a different question and the
 * one that decides whether the feature ships.
 */
// pnpm keeps postgres.js under packages/database; import by path so this
// script runs from the repo root without a workspace dependency of its own.
import postgres from '../../../packages/database/node_modules/postgres/src/index.js';
import { detectCapitalEvent } from '../src/emails/capital-event';

const url = process.env.DATABASE_URL;
if (!url) { console.error('DATABASE_URL required (production is :5434)'); process.exit(1); }
const sql = postgres(url, { max: 2, idle_timeout: 10 });

const rows = await sql<{ thread_id: string; subject: string | null; body: string | null; from_email: string | null }[]>`
  SELECT DISTINCT ON (e.thread_id) e.thread_id, e.subject, left(e.body, 6000) AS body, e.from_email
  FROM emails e
  WHERE e.is_customer_email
    AND lower(coalesce(e.subject,'') || ' ' || left(coalesce(e.body,''), 6000))
        ~ '(data ?room|term ?sheet|letter of intent|fundrais|raising|series [abc]|seed round|financing|409a|cap table|convertible|safe agreement|due diligence)'
  ORDER BY e.thread_id, e.received_at
`;

let fired = 0;
const byFlag: Record<string, number> = {};
const samples: string[] = [];
for (const r of rows) {
  const hit = detectCapitalEvent({ subject: r.subject, body: r.body, fromEmail: r.from_email });
  if (!hit) continue;
  fired += 1;
  byFlag[hit.flag] = (byFlag[hit.flag] ?? 0) + 1;
  if (samples.length < 40) {
    samples.push(`${hit.flag.padEnd(11)} ${('"' + hit.phrase + '"').padEnd(26)} ${(r.from_email ?? '').split('@')[1]?.padEnd(20)} ${(r.subject ?? '').slice(0, 40)}`);
  }
}

console.log(`\n  candidate threads scanned : ${rows.length}`);
console.log(`  detector fired on         : ${fired}  (${((100 * fired) / rows.length).toFixed(1)}% of candidates)`);
console.log(`  by flag                   : ${JSON.stringify(byFlag)}`);
console.log('\n  sample of what fired:');
for (const s of samples) console.log(`    ${s}`);
await sql.end();
