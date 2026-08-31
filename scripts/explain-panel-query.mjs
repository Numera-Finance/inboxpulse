#!/usr/bin/env node
/**
 * Turn a Drizzle `sql` template in account-context.ts into runnable SQL, so a
 * panel query can be EXPLAINed against production.
 *
 * Why this exists: on 2026-08-19 the fires snapshot was recorded at 14.4s and I
 * spent three hypotheses guessing why — a slow base query, a re-executed CTE, a
 * generic plan from parameterisation. All three were wrong, and each could have
 * been settled in a minute by running the actual statement. The obstacle was
 * only that the query is 236 lines of template literal with ten `${}` holes in
 * it, which is enough friction to make guessing feel cheaper. It is not.
 *
 * The holes are filled from the same helpers the runtime uses, so what this
 * prints is what Postgres receives — not an approximation that might explain a
 * different query than the one that is slow.
 *
 * Usage:
 *   node scripts/explain-panel-query.mjs fires            # print the SQL
 *   node scripts/explain-panel-query.mjs fires --run      # run it, report timing
 *   node scripts/explain-panel-query.mjs fires --explain  # EXPLAIN ANALYZE
 *   node scripts/explain-panel-query.mjs fires --prepared # as a prepared statement,
 *                                                         # 7x, to expose a generic plan
 *
 * Env: DATABASE_URL (production is :5434; .env.local points at the :5433 clone).
 * TENANT_ID defaults to the MyStartupCFO tenant.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SERVICES = {
  fires: 'export class FiresService',
  waiting: 'export class WaitingClientsService',
  stirring: 'export class StirringService',
  pulse: 'export class DangerPulseService',
  slow: 'export class SlowRespondersService',
  'negative-share': 'export class NegativeShareService',
};

const which = process.argv[2];
if (!SERVICES[which]) {
  console.error(`usage: node scripts/explain-panel-query.mjs <${Object.keys(SERVICES).join('|')}> [--run|--explain|--prepared]`);
  process.exit(1);
}

const TENANT = process.env.TENANT_ID || '9f34e10b-27d1-457a-bcdc-590f2eb9fa4a';
const DAYS = process.env.DAYS || '90';
const SRC = 'apps/api/src/addon/account-context.ts';
const src = readFileSync(SRC, 'utf8');

/** The first `this.db.execute(sql\`…\`)` inside the named service. */
function extractTemplate(className) {
  const from = src.indexOf(className);
  if (from < 0) throw new Error(`${className} not found in ${SRC}`);
  const open = src.indexOf('this.db.execute(sql`', from);
  if (open < 0) throw new Error(`no sql template in ${className}`);
  let i = open + 'this.db.execute(sql`'.length;
  const start = i;
  // Walk to the closing backtick, honouring escapes. Nested ${} may contain
  // backticks of their own, so track template-expression depth.
  let depth = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === '\\') { i += 2; continue; }
    if (c === '$' && src[i + 1] === '{') { depth += 1; i += 2; continue; }
    if (c === '}' && depth > 0) { depth -= 1; i += 1; continue; }
    if (c === '`' && depth === 0) break;
    i += 1;
  }
  return src.slice(start, i);
}

/** The SQL each helper in account-context.ts produces, inlined. */
function fragments() {
  const domains = /PUBLIC_MAIL_DOMAINS\s*=\s*\[(.*?)\]/s.exec(src);
  const list = [...domains[1].matchAll(/'([^']+)'/g)].map((m) => `'${m[1]}'`).join(', ');
  return {
    '${ownableDomain()}': `AND lower(cd.domain) <> ALL(ARRAY[${list}]::text[])`,
    '${weAreOnTheThread()}':
      "AND EXISTS (SELECT 1 FROM emails e2 JOIN email_participants pp ON pp.email_id = e2.id " +
      "AND pp.participant_type = 'user' WHERE e2.thread_id = e.thread_id AND e2.tenant_id = e.tenant_id)",
    '${weWereAddressed()}':
      "AND EXISTS (SELECT 1 FROM email_participants me WHERE me.email_id = e.id " +
      "AND me.participant_type = 'user' AND me.direction IN ('to','cc'))",
    '${notAlreadyResolved()}':
      "AND NOT EXISTS (SELECT 1 FROM tasks k WHERE k.email_id = e.id AND k.status = 1)",
    // isAClient(): customer_relationships exists in production, so the filter is live.
    '${clientFilter}':
      `AND NOT EXISTS (SELECT 1 FROM customer_relationships cr WHERE cr.customer_id = c.id AND cr.tenant_id = '${TENANT}')`,
    // The cron computes the tenant-wide superset, so no viewer scope.
    '${scope}': '',
    '${tenantId}': `'${TENANT}'`,
    '${days}': DAYS,
    '${limit}': '200',
    // NegativeShareService's sample floor. The ranking is meaningless without
    // one — at 10 analysed messages the top row is six angry emails out of
    // eleven — so it is filled with the value the route actually clamps to.
    '${floor}': '30',
    '${OWN_DOMAIN_MIN_STAFF}': '3',

    // Three services were unresolvable until these were added, so `--run` and
    // `--explain` simply refused for half the panel. Each is a local in its
    // service rather than a shared helper, which is why they were missed.
    '${opts.days}': DAYS,
    '${opts.limit}': '200',
    // WaitingClientsService's own-name exclusion. The runtime passes
    // ownDomains: ['mystartupcfo.com','numerafinance.com'] and compares the
    // first label of each against customers.name.
    '${own}': "AND lower(c.name) <> ALL(ARRAY['mystartupcfo','numerafinance']::text[])",
    // SlowRespondersService's sample floor — a median over four threads names a
    // person on the strength of an anecdote.
    '${minThreads}': '5',
    // DangerPulseService reuses one FROM+WHERE across several aggregates.
    '${base}':
      "FROM emails e JOIN email_analyses a ON a.email_id = e.id AND a.analysis_type = 'sentiment' " +
      `WHERE e.tenant_id = '${TENANT}' AND e.is_customer_email AND e.first_reply_at IS NOT NULL ` +
      `AND e.first_reply_at > e.received_at AND e.received_at > now() - (${DAYS} || ' days')::interval ` +
      "AND EXISTS (SELECT 1 FROM emails e2 JOIN email_participants pp ON pp.email_id = e2.id " +
      "AND pp.participant_type = 'user' WHERE e2.thread_id = e.thread_id AND e2.tenant_id = e.tenant_id) " +
      "AND EXISTS (SELECT 1 FROM email_participants me WHERE me.email_id = e.id " +
      "AND me.participant_type = 'user' AND me.direction IN ('to','cc'))",
  };
}

let q = extractTemplate(SERVICES[which]);
for (const [hole, fill] of Object.entries(fragments())) q = q.split(hole).join(fill);
// `\\s+` in the TS source is `\s+` by the time Postgres sees it.
q = q.replaceAll('\\\\s+', '\\s+');

const unresolved = [...q.matchAll(/\$\{[^}]*\}/g)].map((m) => m[0]);
if (unresolved.length) {
  console.error(`Unresolved placeholders — add them to fragments(): ${[...new Set(unresolved)].join(', ')}`);
  process.exit(1);
}

const mode = process.argv[3] || '--print';
if (mode === '--print') { console.log(q); process.exit(0); }

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is required. Production is :5434 — .env.local points at the :5433 clone:');
  console.error("  export DATABASE_URL=\"$(grep -m1 '^DATABASE_URL=' apps/api/.env.local | cut -d= -f2- | sed 's/:5433/:5434/')\"");
  process.exit(1);
}

const file = join(tmpdir(), `panel-${which}-${mode.replace(/-/g, '')}.sql`);
const psql = (sqlText) => {
  writeFileSync(file, sqlText);
  const t0 = Date.now();
  const out = execFileSync('psql', [process.env.DATABASE_URL, '-tA', '-f', file], {
    encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  });
  return { out, wall: Date.now() - t0 };
};

if (mode === '--run') {
  const { out, wall } = psql(`${q};\n`);
  const rows = out.split('\n').filter(Boolean).length;
  console.log(`  ${which}: ${rows} rows in ${wall}ms wall (includes transfer)`);
} else if (mode === '--explain') {
  const { out } = psql(`EXPLAIN (ANALYZE, BUFFERS, TIMING)\n${q};\n`);
  for (const line of out.split('\n')) {
    if (/Execution Time|Planning Time/.test(line)) console.log(`  ${line.trim()}`);
  }
  // The costliest nodes, weighted by loops — a 3ms node run 400 times is the problem.
  const nodes = [...out.matchAll(/(->.*?)\(actual time=[\d.]+\.\.([\d.]+) rows=[\d.]+ loops=(\d+)\)/g)]
    .map((m) => ({ total: parseFloat(m[2]) * parseInt(m[3], 10), label: m[1].trim().slice(0, 80) }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 6);
  console.log('  --- costliest nodes (actual x loops) ---');
  for (const n of nodes) console.log(`  ${String(Math.round(n.total)).padStart(7)}ms  ${n.label}`);
} else if (mode === '--prepared') {
  // Parameterised, then executed past the fifth run, which is where Postgres may
  // switch from a custom plan to a generic one. Ruled that out for fires: seven
  // runs held 708-838ms.
  let pq = q.split(`'${TENANT}'`).join('$1').split(`(${DAYS} || ' days')::interval`).join("($2 || ' days')::interval");
  pq = pq.split(`('${DAYS}' || ' days')::interval`).join("($2 || ' days')::interval");
  let script = `PREPARE panel_q (uuid, text) AS\n${pq};\n`;
  for (let i = 1; i <= 7; i += 1) {
    script += `\\echo === run ${i}\nEXPLAIN (ANALYZE, TIMING OFF) EXECUTE panel_q('${TENANT}','${DAYS}');\n`;
  }
  const { out } = psql(script);
  for (const line of out.split('\n')) {
    if (/^=== run|Execution Time|ERROR/.test(line.trim())) console.log(`  ${line.trim()}`);
  }
} else {
  console.error(`unknown mode ${mode}`);
  process.exit(1);
}
