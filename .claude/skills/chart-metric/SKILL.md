---
name: chart-metric
description: Turn a metric-analyst run into a published Artifact of charts. Use after the metric-analyst subagent returns numbers, or when someone asks to visualise / chart / graph / "make a picture of" corpus metrics, SQL results, or a proposed panel metric. Reads the metric-results.json the analyst wrote; never re-runs SQL and never touches a database.
---

# Charting a metric-analyst result

You are rendering numbers somebody already vetted. **You do not measure anything
here** — no SQL, no database connection, no re-deriving a figure that is missing
from the JSON. If a number you want is not in the file, say so on the page.

A chart is the most credulous format in this project. `neg_B_loose = 7` looks
identical whether it rests on two threads or two hundred, and the analyst's
CAVEATS block does not survive into a bar. Everything below exists to stop the
picture claiming more than the query did.

## 1. Find the input

`metric-results.json` in the session scratchpad — the analyst reports its
absolute path on the last line of its report. Accept an explicit path as an
argument if one is given.

If it is absent, the analyst ran before this contract existed. Do not scrape its
prose tables: ask for a re-run, or have the user paste the JSON. Regexing a
markdown table is exactly the failure this file was written to prevent.

## 2. Read the gates before choosing a chart

Three fields decide what you are allowed to draw:

- **`chartable: false`** → **draw no chart for that metric.** Render its rows as
  a plain table with `verdict` as a banner above it, styled as a warning. A
  ranking the analyst told the human not to act on must not appear as a clean
  bar chart with the caveat three scrolls below. Say plainly on the page why it
  is not plotted.
- **`base_rate`** → a reference line on every rate chart, labelled. Lift against
  baseline is the point; a bar chart without it is ranking volume.
- **`below_floor: true`** on a row → render it muted and annotate it with its
  `n`. Never let it sit as a visual equal of a row that cleared the floor. If
  every row is below floor, the section header says so.

## 3. Chart per column `role`

Read `columns[].role`, never a heading you guessed:

| roles present | draw |
|---|---|
| `label` + `count` + `rate` | **paired horizontal bars**, count and rate side by side, sorted by count, with the `base_rate` line on the rate panel |
| `label` + `count` only | horizontal bars — and put a visible note that no rate was supplied, so the ranking is by volume |
| `label` + `rate` only | horizontal bars with the baseline line |
| `label` + `share` (+ `count`) | a **donut**, slices in the JSON's row order, with `denominator` stated under the title. See *Compositions* below |
| `denominator` / `sample_n` | never their own chart; they belong in the row label or a tooltip |

**Always plot count and rate together when both exist.** The single most
important thing this page can show is a domain that ranks high on count and sits
*below* baseline on rate — that reader needs to see both bars in one glance, not
on two screens.

Horizontal bars, ordered, are almost always right. **Never a pie for a RANKING**,
never a stacked bar for a ranking, never a dual y-axis to force count and rate
into one plot — pair two panels instead.

### Compositions

The one case a ring is right, and it is narrow: the rows are **mutually exclusive
parts of one population and they sum to it**. The analyst says so with a `share`
role and a `denominator` — not by using `rate`, which is a per-row denominator
compared against `base_rate`. If the JSON has `rate` and no `share`, it is a
ranking however much it looks like a split; draw bars.

Four rules, all of which a plausible-looking ring breaks:

- **Row order is the JSON's order**, which the analyst set to match the
  categories (severity, time, bucket size). Never re-sort by magnitude: colour is
  assigned by position, and slices descending in size read as a ranking.
- **State the whole.** `denominator.value` under the title, with `of` when
  present — "n=11,936 churn-flagged of 44,067 client messages". A ring at n=40
  and a ring at n=4,000 are the same picture.
- **No baseline.** `base_rate` is null for a composition, and a mechanical 1/N
  reference is worse than none.
- **Six parts is not a composition**, it is a table. Cap it at four or five and
  fold the tail into "other" only if the analyst supplied that row — never
  compute it yourself.

Ask the same question the analyst was asked before drawing one: **are the parts
really a whole?** A composition whose largest slice is the *absence* of the thing
being measured is a picture of the instrument, not the subject.

The panel renders the same shape from the same fields — `apps/addon/src/cards/chart.ts`
takes `kind: 'donut'` with the identical `share` / `denominator` vocabulary — so a
composition charted here can move to the sidebar via `panel-section` unchanged.

Load the **`dataviz`** skill before writing any chart code, and **`artifact-design`**
before writing the page. They own palette, accessibility, and layout; this file
only owns what is true about *these* numbers.

## 4. The page

One artifact, one section per entry in `metrics`. Above the charts, a header
block carrying — from the JSON, not from memory:

- the `question`
- the `window` start/end, its `cutoff_source`, and `blind_tail` if present
- the `identity` line, with **clone** stated explicitly

That last one is not decoration. Every number on the page came from the QA
clone, and a chart with no provenance gets forwarded to someone who assumes it
is production.

Below each chart: `verdict` verbatim, then `caveats` as a list. Not collapsed,
not in a footer — a caveat the reader has to open is a caveat that does not
exist.

Charts must be **inline SVG or CSS**, sized from the data. No CDN chart library:
artifacts run under a strict CSP and an external script simply will not load.

## 5. Publish

Call `Artifact` with the HTML file, a short noun-phrase `title` naming the
subject, a one-sentence `description`, and a stable `favicon`. Hand the user the
URL.

Redeploying the same analysis: pass the **same file path** to update in place.
A new question is a new page.

## Refuse to

- Compute a rate the analyst did not supply — you do not have the denominator's
  provenance, and dividing two columns that were filtered differently is how a
  wrong number gets a chart.
- Chart `metrics: []` as an empty frame. An empty result is a finding; write the
  sentence.
- Drop a row to make a chart tidier. Plot every row the JSON carries, or state
  the cut and its rule on the page.
