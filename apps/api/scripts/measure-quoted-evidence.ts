/**
 * How much of the capital-event signal rests on text somebody else wrote.
 *
 * `emails.body` stores the whole quoted reply chain, so a phrase is present in
 * every reply that quotes it. Without accounting for that, a client's outside
 * CPA firm appears in the panel beside the client, citing the client's
 * sentence.
 *
 * Measured 2026-09-09 over a 90-day window: 76 analysed capital-event emails,
 * 48 matching in the sender's own text and 26 matching ONLY in quoted text.
 * 32 clients eligible for the section, 25 of them on their own words.
 *
 * That measurement decided the design. Dropping quoted-only rows was rejected
 * because the same strip deletes genuine evidence from anyone who bottom-posts
 * under the marker; the panel demotes them four tiers instead (ADR-036).
 *
 * Re-run this before changing the phrase list or the demotion. The corpus
 * grows, and a ratio measured once is not a constant.
 *
 * Usage:
 *   export DATABASE_URL="$(grep -m1 '^DATABASE_URL=' apps/api/.env.local \
 *     | cut -d= -f2- | sed 's/:5433/:5434/')"     # :5434 is production
 *   bun run apps/api/scripts/measure-quoted-evidence.ts
 */
import postgres from '../../../packages/database/node_modules/postgres/src/index.js';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL required. Production is :5434; .env.local points at the :5433 clone.');
  process.exit(1);
}
const sql = postgres(url, { max: 2, idle_timeout: 30 });

/** The panel's priority list, as `account-context.ts` declares it. */
const PHRASES =
  '(prepare for a financing|for a financing|we are raising|our next fundraise|our fundraise|' +
  'restarting our series|our series a|our series b|seed round|term sheet|letter of intent|' +
  'data room|fundraise|fundraising|convertible note)';
/** Word boundaries, for the reasons in `capital-event.ts`. */
const RE = '(^|[^a-z0-9])' + PHRASES + '([^a-z0-9]|$)';
/** Everything from the first quoted-reply marker onward. */
const CUT = "(On .{0,120}?wrote:|-{2,} ?Original Message|From: .{0,80}?Sent:|_{5,}).*$";

/** `full` is reserved in Postgres (FULL OUTER JOIN); the column is `alltext`. */
const CLEAN = `regexp_replace(regexp_replace(regexp_replace(
  coalesce(e.subject,'') || '. ' || coalesce(e.body,''),
  '<[^>]*>',' ','g'), '&[a-z]+;|&#[0-9]+;',' ','g'), '[[:space:]]+',' ','g')`;

const q = `
WITH b AS (
  SELECT e.id, cd.customer_id, ${CLEAN} AS alltext
  FROM emails e
  JOIN customer_domains cd ON lower(cd.domain) = split_part(lower(e.from_email),'@',2)
                          AND cd.tenant_id = e.tenant_id
  WHERE e.signals @> ARRAY[70]::integer[]
    AND e.received_at >= now() - interval '90 days'
    AND e.analysis_status = 3
),
cut AS (SELECT id, customer_id, alltext, regexp_replace(alltext, $1, '', 'g') AS own FROM b)
SELECT count(*)::int                                                    AS emails,
       (count(*) FILTER (WHERE own ~* $2))::int                         AS emails_own,
       (count(*) FILTER (WHERE own !~* $2 AND alltext ~* $2))::int      AS emails_quoted_only,
       count(DISTINCT customer_id)::int                                 AS clients,
       (count(DISTINCT customer_id) FILTER (WHERE own ~* $2))::int      AS clients_own
FROM cut`;

const r = (await sql.unsafe(q, [CUT, RE]))[0] as Record<string, number>;
const pct = (n: number, d: number): string => (d ? `${((n / d) * 100).toFixed(0)}%` : 'n/a');

console.log(`\n  database ${(await sql`select current_database() d`)[0].d}`);
console.log(`  analysed capital-event mail, 90 days\n`);
console.log(`  emails in the population           : ${r.emails}`);
console.log(`  ...phrase in the sender's own text : ${r.emails_own} (${pct(r.emails_own, r.emails)})`);
console.log(`  ...phrase ONLY in the quoted chain : ${r.emails_quoted_only} (${pct(r.emails_quoted_only, r.emails)})`);
console.log(`  clients eligible                   : ${r.clients}`);
console.log(`  ...on their own words              : ${r.clients_own}\n`);
await sql.end();
