---
name: panel-section
description: Ship a measured metric into the add-on panel as a card section or chart. Use after metric-analyst has produced numbers and a verdict, or when someone says "add this to the panel", "put that in the sidebar", "make this a section". Walks the nine-file chain from SQL service to rendered card, with the traps that make each step fail silently. Never measures anything itself.
---

# Shipping a metric into the panel

The measurement is done. This is the wiring, and it is mechanical enough to get
wrong in nine places without an error anywhere.

**Do not measure here.** If you need a number you do not have, stop and run
`metric-analyst`. Every figure on the card — the baseline, the floor, the blind
tail — comes from a measurement someone already defended.

## 0. Decide the shape first, because it changes four of the nine steps

| Question | If yes |
|---|---|
| Does it name customers? | Entitlement-scoped. `fromScopedSnapshot`, viewer params on the route, and you must test it three ways. |
| Is it a rate? | It needs a `base_rate`, or the chart ranks percentages against nothing. |
| Is it a **composition** — parts of one population that sum to it? | `kind: 'donut'`, a `share` role, a `denominator`, `baseRate: null`, and rows in category order. See §6. |
| Does the query take >1s? | Snapshot path only. Never a live panel fetch. |
| Did the analyst set `chartable: false`? | It is a list with a verdict banner, not a chart. `buildChart` enforces this; do not fight it. |

## 1. `apps/api/src/addon/account-context.ts` — the service

Start from the nearest existing service, and **re-apply every exclusion**. The
predicates are helpers in that file (`weAreOnTheThread()`, `ownableDomain()`,
`isAClient()`, the ≥3-staff own-domain `NOT EXISTS`); `node scripts/qa-query.mjs
--predicates` prints them as SQL if you are checking a hand-written query.

Four traps, each of which returns **more rows rather than an error**:

- **A CTE lifted from another service carries none of that service's filters.**
  `FiresService`'s `monthly` CTE computes a per-client negative rate and applies
  nothing — it is safe only because it is probed as `WHERE m.customer_id = c.id`
  against a CTE that already excluded everything. Standalone it ranks our own
  domains.
- **A rate needs `LEFT JOIN email_analyses`, not `JOIN`.** An inner join makes
  every denominator equal its own numerator's population, so every client is
  100% negative and the chart looks plausible.
- **Scope on the alias the attribution uses.** `FiresService` once scoped on `p.`
  after the `email_participants` join was removed; Postgres rejected the query
  and every non-admin got a 500 that rendered as an empty section — i.e. as good
  news. Admins could not reproduce it.
- **Metadata must not come from the first row.** Baseline, window and blind tail
  read off `rows[0]` are correct exactly until the entitlement mask empties the
  result, and then they are `0` / `null` / `0` with no error. Emit them from the
  CTEs as their own `is_meta` row through a `UNION ALL`, unscoped, so no
  `GROUP BY`, `HAVING` or entitlement clause can remove them.

Anchor the window on `max(received_at)`, not `now()` — see metric-analyst's
measurement doctrine.

## 2. `apps/api/src/addon/routes.ts` — the endpoint

Clamp every parameter. Names customers → `fromScopedSnapshot`; aggregate only →
`fromSnapshot`. If the payload is an object rather than a row array, mask
`payload.rows` by hand with `snapshots.accessibleCustomerIds()` +
`maskAndLimit()` and say in a comment why the generic helper did not fit.

Count "how many were not shown" **after** the mask, or the card tells a reader
about clients they could never have seen.

## 3. `apps/api/src/addon/snapshot-service.ts` — the kind

Anything over ~1s belongs here. Computed as **admin and unlimited** — the stored
value is the superset every viewer's list is a subset of. Firm-wide aggregates
in the payload stay firm-wide: a baseline that changes with the reader's
entitlements is a reference line that means something different for each of them.

## 4. `apps/addon/src/services/api-client.ts` — the fetch

Follow `getFires`. Return `null` for "could not ask" and an empty collection for
"asked, nothing qualified" — the card needs to tell those apart, and a failed
fetch rendering as calm is this panel's signature failure.

## 5–6. `apps/addon/src/cards/homepage.ts` — the view and the section

The `*View` interface is where the card's vocabulary lives. Put the caveats here,
not in the extension (ADR-031).

For a chart, add a `ChartSpec` builder and register it in `homepageCharts()`.
`buildChart()` in `cards/chart.ts` returns the Cards-v2 widgets **and** the spec
in one call; never build them separately.

**Two shapes, and `kind` picks between them.** `bars` ranks things that compete;
`donut` divides one population into parts that sum to it. For a donut:

- Give the rows a **`share`** (whole percents, computed ONCE in the builder) and
  a spec-level **`denominator`**, and set `baseRate: null`. Do not reuse `rate` —
  it drags in the baseline row, and on four slices that baseline is a mechanical
  25%.
- **Emit rows in category order** (severity, time, bucket), never sorted by size.
  `SEVERITY_RAMP` is assigned by POSITION, so a magnitude sort paints the worst
  level the palest colour. This is the opposite of the bars rule, which sorts by
  what it plots.
- Four slices is the maximum the ramp can colour apart; `buildChart` refuses more
  rather than cycling the palette.
- Gmail gets a segmented block run plus a legend row per slice — a real
  rendering, not a placeholder, so a panel that cannot draw rings loses nothing
  but the ring. The extension declares `chartKinds` and the add-on withholds any
  shape the caller did not ask for, because an unrecognised kind is not ignored
  by the renderer: it consumes the fallback and draws a composition as a ranking.
  **Add a new kind to `DRAWABLE` in CardRenderer and to `chartKinds` together.**

Before shipping any composition, ask what the denominator actually contains. Four
churn levels look like a distribution of risk until you find that `'none'` was
missing from the stored enum, so `low` was the analyser's resting state and the
biggest slice was the absence of the thing being measured.

Placement: `firm.unshift` puts a chart directly under the list it charts;
`firm.push` puts it at the foot of the clients group. Anything about the reader's
own mailbox goes in `personal`. Keep the two-group fold intact — the card has
exactly one hairline and it marks the only boundary that carries meaning.

Card text is escaped with `escapeText` from `./widgets`, and **never emit
`<font color="">`** — the extension restores colour tags by shape and an empty
attribute renders as visible literal text beside every row.

## 7. `apps/api/src/addon/account-context.test.ts` — the structural test

`recordingDb()` captures the built SQL. Assert the **predicates are present**,
because a metric missing one returns more rows, not none.

**Then prove the test discriminates.** Mutate the source — remove the predicate,
flip `LEFT JOIN` to `JOIN`, move the scope into the population — and confirm a
test fails. A structural assertion that never fails is decoration.

Two ways these assertions fool you:
- `expect(sql).toContain('>=')` passes against every query in the file. Pin the
  predicate to the column it guards.
- Asserting a default value appears proves nothing, since it could be hardcoded
  and the parameter ignored. Pass an unusual value and assert *that* is bound.

## 8. `scripts/explain-panel-query.mjs` — the SERVICES entry

Add the service and any new `${}` hole to `fragments()`, so the resolved SQL can
be printed and EXPLAINed without reading a template literal by eye.

## 9. Look at it

```bash
pnpm --filter @crm/api test && pnpm --filter @crm/addon test
pnpm --filter @crm/api lint && pnpm --filter @crm/addon lint
pnpm --filter @crm/chrome-extension check      # `check`, not `lint`

pnpm --filter @crm/api dev      # :4001
pnpm --filter @crm/addon dev    # :4005
cd apps/chrome-extension && npx vite --port 5177
#  http://localhost:5177/harness/card.html    ?w=1200 for a width check
bun lib/card-links.domtest.ts     # must stay PASS  (needs :4001 + :4005)
bun lib/donut-arc.domtest.ts      # arc geometry — pure, no service
bun lib/donut-render.domtest.ts   # renders a ring and reads it back — no service
```

**Structural tests stay green through rendering bugs.** Fetch the live card and
read the strings; for a chart, pull the geometry back out of the markup and check
the bars against the numbers. `renderToStaticMarkup(CardRenderer)` makes that a
script rather than a squint — and note that `decoratedText` rows carry Lucide
icons, which are also `<svg>`, so key on `class="ipc__chart-svg"` when you do.

**Entitlement, three ways, if it names customers.** Admin → rows. Non-admin with
allocations → rows. Non-admin with **zero** allocations → `[]`, which is correct
and not a bug. Resolve test users with
`GET /api/internal/addon/viewer?tenantId=&email=` and pick by allocation count,
never by convenience — and note that account can be `isAdmin: true` with zero
allocations, so pass `isAdmin=false` explicitly to exercise the mask.
