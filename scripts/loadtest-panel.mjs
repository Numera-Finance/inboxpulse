#!/usr/bin/env node
/**
 * Load test for the add-on panel.
 *
 * Simulates real panel opens, not synthetic endpoint hits: one "render" is the
 * SAME six sequential calls `app.post('/homepage')` makes, in the same order,
 * with the same 6s per-call abort the add-on uses. That sequencing is the point
 * — measuring the endpoints in parallel would report a latency no user ever
 * experiences and would miss that a render costs the sum, not the max.
 *
 * It also samples `pg_stat_activity` throughout, because the failure this is
 * built to catch is not slow SQL. On 2026-08-19 the panel died with the database
 * answering in 8-600ms: connections were exhausted behind one stuck advisory
 * lock. Latency alone would have looked fine right up until nothing worked, so
 * the connection watermark and the advisory-wait count are reported next to it.
 *
 * Usage:
 *   node scripts/loadtest-panel.mjs --users 50 --duration 60
 *   node scripts/loadtest-panel.mjs --users 200 --duration 120 --ramp 30
 *
 * Env: SERVICE_API_KEY, API_URL, TENANT_ID, VIEWER_EMAIL, DATABASE_URL (optional,
 * enables the connection sampler).
 */

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
};

const USERS = Number(arg('users', 25));
const DURATION = Number(arg('duration', 60));
const RAMP = Number(arg('ramp', Math.min(15, DURATION / 4)));
const API = arg('url', process.env.API_URL || 'https://crm-api-203731638840.us-central1.run.app');
const KEY = process.env.SERVICE_API_KEY || '';
const TENANT = process.env.TENANT_ID || '9f34e10b-27d1-457a-bcdc-590f2eb9fa4a';
const EMAIL = process.env.VIEWER_EMAIL || 'grastogi@mystartupcfo.com';
/** The add-on aborts here. A call slower than this is a failed call, not a slow one. */
const TIMEOUT_MS = 6000;

if (!KEY) {
  console.error('SERVICE_API_KEY is required.');
  console.error('  export SERVICE_API_KEY=$(gcloud secrets versions access latest \\');
  console.error('    --secret=SERVICE_API_KEY --project project-y-email-sentiment)');
  process.exit(1);
}

/**
 * Percentiles over SUCCESSFUL calls only would flatter the run: an endpoint that
 * answers 100 requests in 80ms and times out on 250 more reports "p95 334ms" and
 * reads as healthy. Aborts are counted separately AND their elapsed time kept,
 * so the table can never look fast while the product is failing.
 */
const stats = new Map(); // endpoint -> { ms: [], abortMs: [], errors }
const rec = (name, ms, outcome) => {
  let s = stats.get(name);
  if (!s) stats.set(name, (s = { ms: [], abortMs: [], errors: 0 }));
  if (outcome === 'ok') s.ms.push(ms);
  else if (outcome === 'abort') s.abortMs.push(ms);
  else s.errors += 1;
};

async function call(name, path) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  const t0 = performance.now();
  try {
    const res = await fetch(`${API}${path}`, {
      headers: { 'x-internal-api-key': KEY },
      signal: ctl.signal,
    });
    const ms = performance.now() - t0;
    await res.text();
    rec(name, ms, res.ok ? 'ok' : 'error');
    return res.ok;
  } catch (e) {
    rec(name, performance.now() - t0, e.name === 'AbortError' ? 'abort' : 'error');
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * One panel open. Sequential, exactly as the homepage handler runs it.
 *
 * `--steady` models the add-on's tenant-wide cache: `pulse`, `stirring` and
 * `slow-responders` are identical for every viewer and now hold for 180s, so in
 * the steady state one panel open costs only the three viewer-scoped calls.
 * Without the flag this measures a cold cache — the morning peak, where the
 * single-flight guard is what stops N misses becoming N queries.
 */
const STEADY = process.argv.includes('--steady');

async function render() {
  const t = encodeURIComponent(TENANT);
  const ok = await call('viewer', `/api/internal/addon/viewer?tenantId=${t}&email=${encodeURIComponent(EMAIL)}`);
  if (!ok) return false; // the real handler degrades from here too
  const u = '019d4c26-c46c-70fe-99a3-da1cc32f0ae1';
  await call('waiting', `/api/internal/addon/waiting?tenantId=${t}&userId=${u}`);
  await call('fires', `/api/internal/addon/fires?tenantId=${t}&userId=${u}&days=90`);
  if (!STEADY) {
    await call('pulse', `/api/internal/addon/pulse?tenantId=${t}&days=90`);
    await call('slow-responders', `/api/internal/addon/slow-responders?tenantId=${t}&days=90`);
    await call('stirring', `/api/internal/addon/stirring?tenantId=${t}`);
  }
  return true;
}

// ── the database watermark, sampled alongside ───────────────────────────────
let peakConns = 0, peakAdvisory = 0, sampler = null, sql = null;
async function startSampler() {
  if (!process.env.DATABASE_URL) return;
  try {
    const { default: postgres } = await import('postgres');
    sql = postgres(process.env.DATABASE_URL, { max: 1, idle_timeout: 5 });
    sampler = setInterval(async () => {
      try {
        const [r] = await sql`
          select count(*)::int as conns,
                 count(*) filter (where wait_event = 'advisory')::int as adv
          from pg_stat_activity where datname = current_database()`;
        peakConns = Math.max(peakConns, r.conns);
        peakAdvisory = Math.max(peakAdvisory, r.adv);
      } catch { /* sampling must never affect the run */ }
    }, 2000);
  } catch { /* postgres not resolvable from here; skip silently */ }
}

const pct = (a, p) => (a.length ? a.slice().sort((x, y) => x - y)[Math.floor((a.length - 1) * p)] : 0);

async function main() {
  console.log(`\n  ${USERS} concurrent panels · ${DURATION}s · ramp ${RAMP}s · abort at ${TIMEOUT_MS}ms`);
  console.log(`  ${API}\n`);
  await startSampler();

  const deadline = Date.now() + DURATION * 1000;
  let renders = 0, failed = 0;
  const worker = async (i) => {
    await new Promise((r) => setTimeout(r, (RAMP * 1000 * i) / USERS)); // stagger the ramp
    while (Date.now() < deadline) {
      const ok = await render();
      renders += 1;
      if (!ok) failed += 1;
      await new Promise((r) => setTimeout(r, 1000)); // a human pauses between opens
    }
  };
  const t0 = Date.now();
  await Promise.all(Array.from({ length: USERS }, (_, i) => worker(i)));
  const elapsed = (Date.now() - t0) / 1000;

  if (sampler) clearInterval(sampler);
  if (sql) await sql.end({ timeout: 5 });

  console.log('  endpoint         ok     p50      p95   timeouts  worst   errors');
  console.log('  ' + '-'.repeat(64));
  let totalAborts = 0, totalErrors = 0;
  for (const [name, s] of stats) {
    totalAborts += s.abortMs.length; totalErrors += s.errors;
    const share = s.abortMs.length / Math.max(1, s.ms.length + s.abortMs.length);
    console.log(
      `  ${name.padEnd(16)}${String(s.ms.length).padStart(4)}` +
      `${pct(s.ms, 0.5).toFixed(0).padStart(8)}ms${pct(s.ms, 0.95).toFixed(0).padStart(7)}ms` +
      `${String(s.abortMs.length).padStart(8)} (${(share * 100).toFixed(0).padStart(2)}%)` +
      `${Math.max(0, ...s.ms, ...s.abortMs).toFixed(0).padStart(7)}ms${String(s.errors).padStart(7)}`,
    );
  }
  const renderP95 = pct([...stats.values()].flatMap((s) => s.ms), 0.95);
  console.log('  ' + '-'.repeat(64));
  console.log(`  renders           ${renders} in ${elapsed.toFixed(0)}s  (${(renders / elapsed).toFixed(1)}/s), ${failed} degraded`);
  console.log(`  aborts ${totalAborts}   errors ${totalErrors}   worst single call p95 ${renderP95.toFixed(0)}ms`);
  if (peakConns) console.log(`  peak db connections ${peakConns}   peak waiting on advisory ${peakAdvisory}`);

  // The verdict, stated rather than left to the reader.
  console.log('');
  if (totalAborts || totalErrors) {
    console.log(`  FAIL: ${totalAborts} calls exceeded the add-on's ${TIMEOUT_MS}ms abort and ${totalErrors} errored.`);
    console.log('        Users saw sections missing, not a slow panel.');
  } else {
    console.log('  PASS: every call answered inside the abort window.');
  }
  if (peakConns >= 240) console.log(`  WARNING: ${peakConns} connections — max_connections is 300.`);
  if (peakAdvisory > 5) console.log(`  WARNING: ${peakAdvisory} sessions queued on the customer advisory lock.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
