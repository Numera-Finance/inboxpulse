#!/usr/bin/env node
/**
 * Run read-only SQL against the QA clone: one connection, one batch, timed.
 *
 * WHY THIS EXISTS, measured rather than assumed. The last metric-analyst run
 * took 26.8 minutes wall-clock and spent **8.9 seconds** of that executing SQL.
 * The other 99.4% was composing — and two thirds of the composing was rebuilding
 * things this repository already contains:
 *
 *   ~7 min   writing a connection runner from scratch (env loading, the db.ts
 *            import, the read-only guard, timing, JSON output) — ~30 lines that
 *            are identical every time and are now the file you are reading.
 *   ~19 min  hand-writing exclusion predicates in raw SQL. Every one of them
 *            already exists as a TypeScript helper in account-context.ts, and
 *            getting any of them wrong produces MORE rows, not an error.
 *
 * So this script is the plumbing plus the predicates, and `--facts` is the
 * standing corpus probe that answers in ~2s what batch 2 used to spend eight
 * minutes deriving.
 *
 * READ-ONLY, ENFORCED BEFORE THE WIRE. Every statement is checked against a
 * deny regex and refused locally, so a mistake cannot reach the database. This
 * is a QA-only project and nothing here may write.
 *
 * Usage:
 *   node scripts/qa-query.mjs --facts
 *       The standing probe: instance identity, window bounds, the firm negative
 *       baseline, sentiment coverage and its spread, the analysis blind tail,
 *       tenant count. Everything a metric needs before it can be honest.
 *
 *   node scripts/qa-query.mjs queries.json [out.json]
 *       queries.json is [["name","SELECT …"], …]. One connection, run in order,
 *       each timed, results printed and written to out.json.
 *
 *   node scripts/qa-query.mjs --predicates
 *       Print the checklist predicates as pasteable SQL. These are extracted
 *       from account-context.ts at run time, so they cannot drift from what the
 *       shipped services actually apply.
 *
 * Env: reads apps/api/.env.local. TENANT_ID defaults to the only tenant in the
 * corpus. Connects through packages/database/src/db.ts, which loads the three
 * client certs — a successful mTLS handshake is itself evidence of the clone,
 * because those certs are signed by the clone's own CA and cannot authenticate
 * against production.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TENANT = process.env.TENANT_ID || '9f34e10b-27d1-457a-bcdc-590f2eb9fa4a';

for (const line of readFileSync(join(REPO, 'apps/api/.env.local'), 'utf-8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}

/**
 * Refused locally, never sent.
 *
 * Word-boundary anchored so a column called `updated_at` or a CTE named
 * `created` does not trip it — the guard has to be usable or it gets bypassed,
 * and a bypassed guard is worse than none.
 */
const FORBIDDEN =
  /\b(insert|update|delete|drop|alter|truncate|grant|revoke|vacuum|reindex|cluster)\s/i;
const FORBIDDEN_PAIR = /\b(create|refresh|copy)\s+(table|index|view|materialized|schema|database|from|to)\b/i;

/**
 * Comments are stripped before the guard runs.
 *
 * The queries in this repo carry long English commentary, and prose about the
 * data trips a keyword guard constantly: "Excluding it would **drop** 59 of the
 * 200 clients" refused a pure `SELECT`. That matters more than it looks — a
 * guard that cries wolf is a guard somebody switches off, and then it is not
 * protecting anything. A `--` or block comment cannot execute, so its contents
 * are not the guard's business.
 *
 * This defends against a MISTAKE, not an adversary: whoever writes the query is
 * the operator. A `--` deliberately buried inside a string literal to hide a
 * write from this function would work, and is not a threat model that applies.
 */
function stripComments(q) {
  return q.replace(/--[^\n]*/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ');
}

function guard(name, q) {
  const bare = stripComments(q);
  if (FORBIDDEN.test(bare) || FORBIDDEN_PAIR.test(bare)) {
    throw new Error(`GUARD refused "${name}" — this project is read-only against the clone.`);
  }
}

/* ------------------------------------------------------------------ *
 * The checklist predicates, lifted from the shipped services.
 *
 * Extracted from account-context.ts rather than copied, so a predicate
 * changed there changes here. A hand-copied constant is exactly the
 * `blueoceanps` mistake: a claim about the data frozen into a file where
 * nobody looks at it again.
 * ------------------------------------------------------------------ */
const AC = readFileSync(join(REPO, 'apps/api/src/addon/account-context.ts'), 'utf-8');

function publicMailDomains() {
  const m = /PUBLIC_MAIL_DOMAINS\s*=\s*\[(.*?)\]/s.exec(AC);
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => `'${x[1]}'`).join(', ');
}

const P = {
  /** Item 1. Somebody from the firm on the thread — ADR-020. Needs alias `e`. */
  weAreOnTheThread: `AND EXISTS (SELECT 1 FROM emails e2 JOIN email_participants pp
      ON pp.email_id = e2.id AND pp.participant_type = 'user'
     WHERE e2.thread_id = e.thread_id AND e2.tenant_id = e.tenant_id)`,

  /** Item 2. The message ASKED US something. Only for "we failed to X" metrics. */
  weWereAddressed: `AND EXISTS (SELECT 1 FROM email_participants me
     WHERE me.email_id = e.id AND me.participant_type = 'user'
       AND me.direction IN ('to','cc'))`,

  /** Item 3. A customer claims gmail.com and would answer for every consumer sender. */
  ownableDomain: `AND lower(cd.domain) <> ALL(ARRAY[${publicMailDomains()}]::text[])`,

  /** Item 4. Our own entities, DERIVED from staff count. Never a hardcoded list. */
  notOurOwnDomain: `AND NOT EXISTS (
       SELECT 1 FROM customer_domains cd2
        WHERE cd2.customer_id = c.id
          AND lower(cd2.domain) IN (
            SELECT split_part(lower(u2.email),'@',2) FROM users u2
             WHERE u2.tenant_id = '${TENANT}' AND u2.email LIKE '%@%'
             GROUP BY 1 HAVING count(*) >= 3))`,

  /** Item 5. Non-clients are RECORDED. Probe the table first — see below. */
  isAClient: `AND NOT EXISTS (SELECT 1 FROM customer_relationships cr
     WHERE cr.customer_id = c.id AND cr.tenant_id = '${TENANT}')`,

  /** Attribution by WHO SENT IT. The participant path credits mail merely received. */
  bySenderDomain: `JOIN customer_domains cd
      ON lower(cd.domain) = split_part(lower(e.from_email),'@',2)
     AND cd.tenant_id = e.tenant_id
   JOIN customers c ON c.id = cd.customer_id`,

  /** Entitlement. Scope on the SAME alias the attribution uses, or it 500s. */
  scope: (userId) => `AND cd.customer_id IN (
       SELECT customer_id FROM user_accessible_customers WHERE user_id = '${userId}')`,
};

/**
 * NOT a predicate, and the reason is worth stating: `is_auto_created` is
 * DELIBERATELY not excluded by any shipped service. The flag records how a
 * customer ROW was created, not whether the company is real — for most clients
 * the auto-created record is the only one carrying their domain. Excluding it
 * drops WareIQ Logistics, and on the 90-day window it drops 59 of the 200
 * clients that clear a 30-message floor. FiresService says so at its `t` CTE.
 */
P.doNotExcludeAutoCreated = true;

/* ------------------------------------------------------------------ *
 * The standing probe.
 * ------------------------------------------------------------------ */
const FACTS = [
  ['identity', `
    SELECT inet_server_addr()::text AS host, inet_server_port() AS port,
           current_database() AS db, pg_is_in_recovery() AS in_recovery,
           (SELECT count(*) FROM pg_stat_replication) AS repl_peers,
           now() AS server_now,
           (SELECT count(*) FROM emails) AS emails,
           (SELECT count(DISTINCT tenant_id) FROM emails) AS tenants,
           (SELECT max(received_at) FROM emails) AS last_ingested`],

  ['window_and_blind_tail', `
    WITH b AS (SELECT max(received_at) AS win_end FROM emails WHERE tenant_id = '${TENANT}'),
         a AS (SELECT max(e.received_at) AS last_analysed FROM emails e
                 JOIN email_analyses x ON x.email_id = e.id AND x.analysis_type='sentiment'
                WHERE e.tenant_id = '${TENANT}')
    SELECT b.win_end, a.last_analysed,
           round(extract(epoch FROM (b.win_end - a.last_analysed))/86400.0, 1) AS blind_days,
           (SELECT count(*) FROM emails e3
             WHERE e3.tenant_id='${TENANT}' AND e3.received_at > a.last_analysed) AS blind_messages
    FROM b CROSS JOIN a`],

  ['schema_probe', `
    SELECT (SELECT to_regclass('public.customer_relationships')::text) AS has_relationships,
           (SELECT count(*) FROM email_analyses WHERE analysis_type='sentiment') AS sentiment_rows,
           (SELECT count(*) FROM email_analyses
             WHERE analysis_type='sentiment' AND sentiment_target IS NULL) AS target_null,
           (SELECT count(DISTINCT sentiment_target) FROM email_analyses
             WHERE analysis_type='sentiment') AS target_distinct`],

  ['our_own_domains', `
    SELECT split_part(lower(email),'@',2) AS domain, count(*) AS staff
    FROM users WHERE tenant_id='${TENANT}' AND email LIKE '%@%'
    GROUP BY 1 HAVING count(*) >= 3 ORDER BY staff DESC`],

  // The baseline and the coverage spread, over the SAME population every client
  // metric uses. Quote these; do not re-derive them per question.
  ['baseline_and_coverage', `
    WITH b AS (SELECT max(received_at) AS win_end FROM emails WHERE tenant_id='${TENANT}'),
    msg AS (
      SELECT e.id AS email_id, cd.customer_id,
             (a.email_id IS NOT NULL) AS analysed,
             (a.sentiment_value='negative') AS neg
      FROM emails e CROSS JOIN b
      LEFT JOIN email_analyses a ON a.email_id=e.id AND a.analysis_type='sentiment'
      ${P.bySenderDomain.replace(/^\s*JOIN/, 'JOIN')}
      WHERE e.tenant_id='${TENANT}' AND e.is_customer_email
        AND e.received_at > b.win_end - interval '90 days'
        AND e.received_at <= b.win_end
        ${P.ownableDomain} ${P.weAreOnTheThread} ${P.notOurOwnDomain} ${P.isAClient}
    ), per AS (
      SELECT customer_id,
             count(*) FILTER (WHERE analysed) AS analysed,
             count(*) AS msgs
      FROM msg GROUP BY 1 HAVING count(*) >= 30
    )
    SELECT (SELECT count(DISTINCT email_id) FROM msg) AS inbound,
           (SELECT count(DISTINCT email_id) FROM msg WHERE analysed) AS analysed,
           (SELECT count(DISTINCT email_id) FROM msg WHERE neg) AS negative,
           round(100.0*(SELECT count(DISTINCT email_id) FROM msg WHERE neg)
                 / NULLIF((SELECT count(DISTINCT email_id) FROM msg WHERE analysed),0),2)
             AS firm_negative_rate_pct,
           round(100.0*(SELECT count(DISTINCT email_id) FROM msg WHERE analysed)
                 / NULLIF((SELECT count(DISTINCT email_id) FROM msg),0),2) AS coverage_pct,
           (SELECT count(*) FROM per) AS clients_over_30_msgs,
           -- ::numeric on every one. percentile_cont returns double precision,
           -- and round(double precision, integer) does not exist in Postgres —
           -- it fails at parse time with a "no function matches" that names the
           -- cast rather than the column.
           (SELECT round((100.0*min(analysed::numeric/msgs))::numeric,2) FROM per) AS coverage_min,
           (SELECT round((100.0*percentile_cont(0.25) WITHIN GROUP (ORDER BY analysed::numeric/msgs))::numeric,2) FROM per) AS coverage_p25,
           (SELECT round((100.0*percentile_cont(0.5)  WITHIN GROUP (ORDER BY analysed::numeric/msgs))::numeric,2) FROM per) AS coverage_median,
           (SELECT round((100.0*max(analysed::numeric/msgs))::numeric,2) FROM per) AS coverage_max`],
];

/* ------------------------------------------------------------------ */

const arg = process.argv[2];

if (arg === '--predicates') {
  console.log('-- Checklist predicates, extracted from account-context.ts.\n');
  for (const [k, v] of Object.entries(P)) {
    if (typeof v === 'string') console.log(`-- ${k}\n${v}\n`);
  }
  console.log(`-- scope(userId)\n${P.scope('<user-uuid>')}\n`);
  console.log('-- NOTE: is_auto_created is deliberately NOT excluded. See the comment in this file.');
  process.exit(0);
}

if (!arg) {
  console.error('usage: node scripts/qa-query.mjs (--facts | --predicates | queries.json [out.json])');
  process.exit(1);
}

const queries = arg === '--facts' ? FACTS : JSON.parse(readFileSync(arg, 'utf-8'));
for (const [name, q] of queries) guard(name, q);

const { getDatabaseClient } = await import(
  `file:///${join(REPO, 'packages/database/src/db.ts').replace(/\\/g, '/')}`
);
const client = getDatabaseClient();
await client.unsafe(`SET statement_timeout = '60s'`);

const out = {};
let total = 0;
for (const [name, q] of queries) {
  const t = Date.now();
  const rows = await client.unsafe(q);
  const ms = Date.now() - t;
  total += ms;
  out[name] = { ms, rows: JSON.parse(JSON.stringify(rows)) };
  console.log(`\n===== ${name}  (${ms}ms, ${rows.length} rows) =====`);
  console.log(JSON.stringify(rows, null, 1));
}
console.log(`\n===== total ${total}ms across ${queries.length} queries =====`);

const outPath = process.argv[3] ?? null;
if (outPath) {
  writeFileSync(outPath, JSON.stringify(out, null, 1));
  console.log(`wrote ${outPath}`);
}
await client.end();
