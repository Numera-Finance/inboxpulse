# Load testing the panel

Every number here was measured against production on 2026-08-19 with the two
tools in `scripts/`. Both are committed so the numbers can be re-derived rather
than believed.

    scripts/loadtest-panel.mjs        replays real panel opens
    scripts/explain-panel-query.mjs   turns a Drizzle template into runnable SQL

## Running them

```bash
export SERVICE_API_KEY=$(gcloud secrets versions access latest \
  --secret=SERVICE_API_KEY --project project-y-email-sentiment)
# Production is :5434. apps/api/.env.local points at the :5433 clone.
export DATABASE_URL="$(grep -m1 '^DATABASE_URL=' apps/api/.env.local | cut -d= -f2- | sed 's/:5433/:5434/')"

node scripts/loadtest-panel.mjs --users 200 --duration 60 --ramp 20
node scripts/loadtest-panel.mjs --users 200 --duration 60 --steady   # tenant-wide cache warm

node scripts/explain-panel-query.mjs fires --explain
node scripts/explain-panel-query.mjs fires --prepared    # exposes a generic plan
```

**Start from an idle fleet.** Two consecutive runs measure different systems:
the second inherits warm Cloud Run instances from the first. That mistake is
recorded below because it produced a passing result that was not real.

## What the harness does, and why it does it that way

A "render" is the **same six calls the homepage makes**, with the same **6s
AbortController**. Measuring the endpoints in parallel would report a latency no
user experiences.

It samples `pg_stat_activity` throughout for the connection count and the number
of sessions waiting on `advisory`. Latency alone cannot see the failure this is
built to catch: on 2026-08-19 the panel died twice with the database answering in
8–600ms, because connections were queued behind one stuck advisory lock.

Timeouts are counted **separately from percentiles, with their elapsed time
kept**. The first version computed percentiles over successful calls only and
printed `p95 334ms` beside 252 timeouts — a table that looked healthy while the
product was failing.

## Results

### 200 concurrent panel opens

| date | change under test | renders/s | timeouts |
|---|---|---|---|
| 08-19 | before any precompute | 26.4 | 16 of ~10,200 |
| 08-19 | after tenant-wide precompute (pulse, stirring, slow) | 26.4 | 16 |
| 08-19 | after fires + waiting precompute | 87.4 | **0** |
| 08-19 | repeat from an **idle** fleet, min-instances 1 | 14.9 | **1,332** |
| 08-19 | min-instances 3, idle fleet | 97.2 | **0** |

Final per-endpoint, 200 concurrent, idle fleet, min-instances 3:

| endpoint | p50 | p95 | worst |
|---|---|---|---|
| viewer | 108ms | 297ms | 825ms |
| waiting | 156ms | 457ms | 1,038ms |
| fires | 91ms | 268ms | 967ms |
| pulse | 80ms | 175ms | 766ms |
| slow-responders | 79ms | 165ms | 829ms |
| stirring | 78ms | 166ms | 716ms |

Before precompute, for contrast: `stirring` p50 4,502ms with **65%** of calls
exceeding the abort, `pulse` 3,682ms and **57%**.

### The snapshot cron

| kind | compute |
|---|---|
| fires | 3,048ms |
| pulse | 844ms |
| stirring | 459ms |
| slow_responders | 321ms |
| waiting | 180ms |

`fires` was 29,147ms. Two changes account for the difference: the owner lookup
stopped re-scanning 90 days of mail per customer (16,070ms → 2,427ms, verified
row-for-row identical), and `monthly` became `MATERIALIZED` so the correlated
`arc` subquery stopped re-running it per row.

Its phases are logged under `logType: FIRES_TIMING`:

    probe=1ms  query=765ms  owner=2282ms  total=3048ms  fires=75

## Three wrong hypotheses, kept because they are cheap to re-test

Each cost real time and each was settled by one command from the tools above.
They are recorded so nobody re-runs them.

1. **"The base fires query is slow."** It is 797ms server-side, 14ms planning,
   returning the same 75 rows. `explain-panel-query.mjs fires --explain`.
2. **"Parameterisation gives it a generic plan."** Prepared and executed seven
   times, past the fifth run where Postgres may switch: 708–838ms throughout.
   `--prepared`.
3. **"There is an unexplained 11 seconds."** There was not. A stale `compute_ms`
   row written before a deploy finished rolling out was compared against fresh
   hand-measurements. Read the age of the row before trusting the number.

## What is still true

- `--min-instances 3` and `--no-cpu-throttling` on crm-api are load-bearing, and
  pinned in `deploy.yml` with the measurement beside them. Applied by hand they
  get reset by the next CI deploy, which has happened.
- Nothing isolates panel reads from ingestion writes: they share one pool on one
  database. A long write transaction can still queue the panel behind it. A
  separate small read pool, or `SET LOCAL statement_timeout` on panel queries,
  would contain it. Neither is done.
- `getFires` and `getWaitingClients` still return `[]` for both "nothing found"
  and "the call failed" — the three-state bug fixed in `resolveViewer`, still
  live in two places.
