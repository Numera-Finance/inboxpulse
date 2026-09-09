/**
 * Mark historical mail with Signal.CAPITAL_EVENT (70).
 *
 * The detector makes no model call, so this costs database time and nothing
 * else. Re-running the LLM analysis over the same corpus would be about $19 at
 * $0.000108 a call, and would overwrite existing sentiment and churn signals,
 * which is a far larger blast radius than adding one integer.
 *
 * Three safety properties, in the order they matter:
 *
 *   1. DRY_RUN unless told otherwise. Prints what it would change and exits.
 *   2. ADDS ONLY. `signals || 70` appends; nothing is removed or replaced, so a
 *      bug here cannot destroy a sentiment or churn signal.
 *   3. Skips `signals_overridden`. A human correction outranks this.
 *
 * Usage:
 *   bun run apps/api/scripts/backfill-capital-event.ts            # dry run
 *   APPLY=1 bun run apps/api/scripts/backfill-capital-event.ts    # write
 */
import postgres from '../../../packages/database/node_modules/postgres/src/index.js';
import { detectCapitalEvent } from '../src/emails/capital-event';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL required. Production is :5434; .env.local points at the :5433 clone.');
  process.exit(1);
}
const APPLY = process.env.APPLY === '1';
const sql = postgres(url, { max: 2, idle_timeout: 20 });

const dbName = (await sql`select current_database() as d`)[0].d;
const total = (await sql`select count(*)::int as n from emails`)[0].n;
console.log(`\n  database ${dbName}, ${total.toLocaleString()} emails`);
console.log(`  mode: ${APPLY ? 'APPLY (writing)' : 'DRY RUN (no writes)'}\n`);

/**
 * Narrow in SQL before running the detector in JS. The detector is the
 * authority on what counts; this is only a cheap net so we do not pull 174,000
 * bodies into memory to reject most of them.
 */
const candidates = await sql<
  { id: string; subject: string | null; body: string | null; from_email: string | null; signals: number[] | null; overridden: boolean | null }[]
>`
  SELECT e.id, e.subject, left(e.body, 6000) AS body, e.from_email, e.signals,
         e.signals_overridden AS overridden
  FROM emails e
  WHERE lower(coalesce(e.subject,'') || ' ' || left(coalesce(e.body,''), 6000))
        ~ '(data ?room|term ?sheet|letter of intent|fundrais|raising|financing|dfinsolutions|suralink)'
`;
console.log(`  candidates from the SQL net : ${candidates.length.toLocaleString()}`);

const toMark: string[] = [];
let alreadyHad = 0;
let skippedOverridden = 0;
const byFlag: Record<string, number> = {};

for (const row of candidates) {
  const hit = detectCapitalEvent({ subject: row.subject, body: row.body, fromEmail: row.from_email });
  if (!hit) continue;
  byFlag[hit.flag] = (byFlag[hit.flag] ?? 0) + 1;
  if (row.overridden) { skippedOverridden += 1; continue; }
  if ((row.signals ?? []).includes(70)) { alreadyHad += 1; continue; }
  toMark.push(row.id);
}

console.log(`  detector fired on           : ${toMark.length + alreadyHad + skippedOverridden}`);
console.log(`  by flag                     : ${JSON.stringify(byFlag)}`);
console.log(`  already carried signal 70   : ${alreadyHad}`);
console.log(`  skipped (human override)    : ${skippedOverridden}`);
console.log(`  to mark                     : ${toMark.length}\n`);

if (!APPLY) {
  console.log('  DRY RUN — nothing written. Re-run with APPLY=1 to write.\n');
  await sql.end();
  process.exit(0);
}

// Append only. array_append is a no-op guard against double-marking if this is
// re-run, since the query already excludes rows carrying 70.
let written = 0;
const BATCH = 500;
for (let i = 0; i < toMark.length; i += BATCH) {
  const batch = toMark.slice(i, i + BATCH);
  const res = await sql`
    UPDATE emails
       SET signals = array_append(coalesce(signals, ARRAY[]::integer[]), 70)
     WHERE id = ANY(${batch}::uuid[])
       AND NOT (coalesce(signals, ARRAY[]::integer[]) @> ARRAY[70]::integer[])
       AND coalesce(signals_overridden, false) = false
  `;
  written += res.count ?? 0;
  process.stdout.write(`\r  written ${written}/${toMark.length}`);
}
console.log(`\n\n  done: ${written} emails marked with Signal.CAPITAL_EVENT\n`);
await sql.end();
