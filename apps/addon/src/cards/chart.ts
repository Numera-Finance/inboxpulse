import {
  type CardSection,
  type Widget,
  text,
  deco,
  heading,
  spacer,
  escapeText,
} from './widgets';

/**
 * A chart, rendered twice from one description.
 *
 * ONE FUNCTION RETURNS BOTH RENDERINGS. `buildChart` emits the Cards-v2 widgets
 * Gmail will draw AND the `ChartSpec` the Chrome extension draws as SVG, from
 * the same rows in the same call. They cannot be produced separately, so they
 * cannot drift — which is the whole point. This codebase has been bitten twice
 * by two implementations of one fact that never meet (the two email-reduction
 * paths, the `/api/manager/*` field-name seam), and a chart is the worst
 * possible place for a third: the two renderings would disagree about a
 * QUANTITY, silently, and both would look right.
 *
 * WHY NOT AN IMAGE. ADR-004 deleted `apps/addon/src/chart/png.ts` and its public
 * `GET /chart/trend.png` — a hand-written PNG encoder that blurred on HiDPI and,
 * worse, published per-customer sentiment sequences in an unauthenticated query
 * string. Nothing here renders a picture on the server or puts a datum in a URL.
 * The surviving `assets/bar.ts` band is a solid rectangle precisely because it
 * carries no information; see its header comment.
 *
 * WHAT CARDS V2 GIVES US. No chart widget, no font sizing, no spacing, no
 * positioning (ADR-005). The one thing that works is a run of block characters
 * in a text field: every bar starts at the same left edge of its own line, so
 * run length is proportional to value even though the font is proportional —
 * the glyph is repeated, so its width cancels. `cards/trend.ts` already does
 * this with coloured squares; this generalises it to a measured axis with
 * eighth-block resolution.
 *
 * THE GATES COME FROM THE ANALYST, NOT FROM HERE. `chartable`, `baseRate` and
 * per-row `belowFloor` are decided upstream by whoever measured the numbers
 * (see `.claude/skills/chart-metric/SKILL.md` §2) and are enforced below. A
 * chart is the most credulous format in this project: `7` looks identical
 * whether it rests on two threads or two hundred, and a CAVEATS block does not
 * survive into a bar.
 */

/**
 * The two forms that survive a 400px column: a ranking, and a share of a whole.
 *
 * `bars` ranks things that compete — the longest bar is the worst client, and the
 * reader's question is "who". `donut` divides ONE population into parts that sum
 * to it, and the reader's question is "how much of it is". They are not
 * interchangeable renderings of the same rows: drawing a composition as a ranking
 * invites a comparison between categories that are not competing, which is why
 * `chart-metric` §3 bans a pie for a RANKING and why this union stays this short.
 * A third kind needs the same argument made again.
 */
export type ChartKind = 'bars' | 'donut';

export type ColumnRole = 'label' | 'count' | 'rate' | 'share' | 'denominator' | 'sample_n';

export interface ChartColumn {
  name: string;
  role: ColumnRole;
  label: string;
  unit?: 'percent' | 'count' | 'days' | 'hours';
}

export interface ChartRow {
  label: string;
  /** The plotted magnitude when the chart ranks by volume. */
  count?: number | null;
  /** The plotted magnitude when the chart ranks by rate, in whole percents. */
  rate?: number | null;
  /**
   * The plotted magnitude of a donut: this row's share of the whole, in whole
   * percents.
   *
   * NOT a rate, and the distinction is why this is its own field rather than a
   * reuse. A rate has its own denominator per row and its reference is
   * `baseRate` — "20.9% of THIS client's mail is angry, against a firm 3.1%". A
   * share has ONE denominator for the entire chart and no external reference at
   * all; its only comparison is the other slices, which is exactly why a
   * `baseRate` drawn on a composition would be meaningless (on four slices it is
   * a mechanical 25%). Carrying it separately makes the baseline row and the
   * volume note fall away by themselves rather than needing to be suppressed.
   *
   * Computed UPSTREAM, once, from the same counts — so the two renderings print
   * an identical percentage without either of them dividing anything. Same
   * reasoning as `belowFloor` below.
   */
  share?: number | null;
  /** The n behind this row. Rendered beside every bar; never plotted. */
  sampleN?: number | null;
  /**
   * Precomputed upstream, never re-derived here.
   *
   * The analyst is the one who knows which column is `n`; a renderer guessing it
   * from `sampleFloor` would silently mute the wrong rows. Carried per row for
   * exactly that reason.
   */
  belowFloor?: boolean;
  /**
   * A second figure for this row, printed beside `n` and never plotted.
   *
   * Exists because a question can have two honest readings that rank
   * differently, and the chart can only draw one of them. "Largest share of
   * negative email" means either *this client's rate* or *this client's share of
   * all our complaints*; the bars plot the first, because it is the only one the
   * firm baseline is comparable against, and the second belongs on the row
   * rather than nowhere.
   *
   * Text, not a number, so the unit travels with it — a bare `18.2` beside a
   * bar already labelled `20.9%` is two percentages meaning different things.
   * The caller writes "18.2% of all complaints".
   */
  note?: string;
}

export interface ChartSpec {
  id: string;
  title: string;
  kind: ChartKind;
  /**
   * The analyst's VERDICT, made machine-readable.
   *
   * False means the numbers must not become a clean bar chart with the reason
   * three scrolls below. Enforced in `buildChart`: the fallback renders rows and
   * the verdict, no bars, and the spec still crosses the wire so the extension
   * refuses in the same way rather than inventing its own policy.
   */
  chartable: boolean;
  /** Why, in the analyst's words. Required reading when `chartable` is false. */
  verdict?: string;
  columns: ChartColumn[];
  rows: ChartRow[];
  /** The reference line. Lift against baseline is the point of a rate chart. */
  baseRate?: { value: number; unit: 'percent'; label: string } | null;
  /**
   * The whole the slices are parts of. Printed under the title, never plotted.
   *
   * A composition is unreadable without it. "18% critical" is a different fact at
   * n=40 and at n=4,000, and the ring is pixel-identical either way — a donut
   * cannot express its own sample size the way a bar chart at least ranks
   * something. `of` carries the population the flagged set was drawn from, so the
   * card can say "2,481 churn-flagged of 18,904 analysed" and the reader sees
   * both how the parts divide and how small the whole is.
   */
  denominator?: {
    value: number;
    /** What `value` counts, e.g. "churn-flagged". */
    label: string;
    /** The population it was drawn from, e.g. { value: 18904, label: 'analysed' }. */
    of?: { value: number; label: string } | null;
  } | null;
  sampleFloor?: { column: string; value: number; unit: string } | null;
  /**
   * The honest window.
   *
   * `blindTail` exists because this corpus has an analysis backlog: mail is
   * ingested days ahead of being analysed, so a sentiment series drawn to
   * `max(received_at)` renders a collapse to zero in its final week that is a
   * PIPELINE ARTIFACT, not a finding — and a chart is the format least able to
   * say so. Whoever measures re-measures it; nothing here hardcodes a date.
   */
  window?: {
    start?: string;
    end?: string;
    cutoffSource?: string;
    blindTail?: string;
  };
  caveats?: string[];
  /**
   * How many widgets this chart's Cards-v2 fallback occupies. Assigned by
   * `buildChart`; never written by hand.
   *
   * This is the anchor a renderer that CAN draw uses to find the run it should
   * replace. It matches the leading widget by exact equality against
   * `<b>${title}</b>` — a value both sides hold — and then consumes this many.
   * Deliberately not "scan forward until something stops looking like a bar":
   * recognising a chart by the shape of its rendered text is the same mistake as
   * regexing a markdown table for numbers, and it fails by rendering a PARTIAL
   * chart rather than by failing.
   */
  fallbackWidgets?: number;
}

export interface ChartRender {
  /** For a renderer that can draw. Carries no datum the widgets do not. */
  spec: ChartSpec;
  /** For Gmail, which cannot. The same numbers as block bars. */
  widgets: Widget[];
}

/**
 * How many blocks a full-scale bar spends.
 *
 * The panel is ~400px and a `bottomLabel` renders at Cards v2's small size, of
 * which the bar shares a line with its value. Twenty-four full blocks plus
 * " 100.0% · n=1234" fits without wrapping at that width; a wrapped bar reads as
 * two bars and is worse than a shorter one.
 */
const MAX_BLOCKS = 24;

/**
 * Eighths, narrowest first, so a bar resolves below one whole block.
 *
 * Without these a value at 1/20th of the maximum renders as an empty line, which
 * reads as zero — the one thing a bar must never do to a non-zero number. These
 * are LEFT-anchored block elements (U+258F…U+2588), which is what makes a run of
 * them a bar rather than a row of boxes.
 */
const EIGHTHS = ['▏', '▎', '▍', '▌', '▋', '▊', '▉'];
const FULL = '█';
/** The baseline's own glyph: a reference is not a datum and must not read as one. */
const SHADE = '░';

/** The card palette, from cards/homepage.ts. Red means one thing on this card. */
const FIRE = '#d93025';
const QUIET = '#5f6368';

/**
 * The severity ramp for a donut's slices, in order. ORDINAL, NOT CATEGORICAL.
 *
 * A composition of severity levels is not four arbitrary categories; low → critical
 * is a direction, and the colour has to carry it or the ring reads as a pie chart
 * of flavours. So this runs cool grey → ochre → orange → the card's red, and it is
 * assigned BY POSITION: `SEVERITY_RAMP[i]` paints `rows[i]`. That is what makes
 * row order load-bearing (see `donutBody`), and it is why a builder that sorts its
 * rows by size would paint `critical` the palest colour.
 *
 * Three of the four are already on this card — QUIET grey (the absence of an
 * alarm), the ochre of "talking more than usual" (homepage.ts:737) and FIRE — so
 * the ring reads as one system with the rest of the panel and red still means
 * exactly one thing. Only `#e8710a` is new, and it is here rather than the card's
 * other warm tone `#b06000` (flagged.ts) because that one sits within a couple of
 * points of lightness of the ochre: as ADJACENT ring segments in a 400px column
 * the two would read as one colour.
 *
 * MIRRORED in the extension (`lib/donut-arc.ts`) and pinned from both sides by
 * `donut-arc.domtest.ts` — a contract asserted on only one side is not asserted.
 * Every entry must match the extension's restore pattern
 * `/^<font color="#[0-9a-fA-F]{3,6}">$/` or the tag survives escaping as visible
 * literal text beside every slice.
 *
 * Nothing on this chart is carried by colour ALONE: every slice is named, counted
 * and percented in the legend, in both renderings.
 */
export const SEVERITY_RAMP = ['#5f6368', '#9a6f33', '#e8710a', '#d93025'] as const;

/**
 * A bar as a string of block characters, `fraction` of full scale.
 *
 * Clamped to [0,1] rather than trusted: a rate above its own maximum is a bug
 * upstream, and the honest rendering of it is a full bar, not one that overruns
 * the column and wraps.
 */
export function barGlyphs(fraction: number, maxBlocks = MAX_BLOCKS): string {
  if (!Number.isFinite(fraction) || fraction <= 0) return '';
  const units = Math.round(Math.min(1, fraction) * maxBlocks * 8);
  if (units === 0) return EIGHTHS[0];
  const full = Math.floor(units / 8);
  const rest = units % 8;
  return FULL.repeat(full) + (rest > 0 ? EIGHTHS[rest - 1] : '');
}

/**
 * Largest-remainder (Hamilton) apportionment of `maxBlocks` across `shares`.
 *
 * A 100%-stacked run has one property a bar does not: THE PARTS MUST ADD UP.
 * Rounding each slice on its own does not — [10,10,10,70] rounds to 23 blocks and
 * [11,11,11,67] to 25 — and a run one block short reads as a missing category
 * while a run one block long wraps and reads as two rows.
 *
 * Ties break by index, so the same input always yields the same run. A chart that
 * redraws differently on identical data is one nobody can check by eye.
 */
function apportion(shares: number[], maxBlocks: number): number[] {
  const safe = shares.map((s) => (Number.isFinite(s) && s > 0 ? s : 0));
  const total = safe.reduce((a, b) => a + b, 0);
  if (total <= 0) return safe.map(() => 0);

  const exact = safe.map((s) => (s / total) * maxBlocks);
  const out = exact.map((e) => Math.floor(e));
  const order = exact
    .map((e, i) => ({ i, rest: e - Math.floor(e) }))
    .sort((a, b) => b.rest - a.rest || a.i - b.i);

  let used = out.reduce((a, b) => a + b, 0);
  for (let k = 0; used < maxBlocks; k += 1, used += 1) {
    out[order[k % order.length].i] += 1;
  }
  return out;
}

/**
 * Blocks per slice, summing to EXACTLY `maxBlocks`, with no non-zero slice erased.
 *
 * The apportionment above is exact but can hand a small slice zero blocks, and a
 * category that exists rendering as nothing is the one thing a chart must never do
 * to a non-zero number — the same invariant `barGlyphs` protects at its `units === 0`
 * line. So the widest slice lends a block to each starved one. That is a bounded
 * lie: at most 1/24th of the run per slice, and `flooredAny` reports it so the card
 * can say the widths stopped being readable and the percentages should be read
 * instead.
 *
 * A TRUE zero still gets zero blocks. The floor is for numbers that are not zero.
 */
export function stackBlocks(shares: number[], maxBlocks = MAX_BLOCKS): number[] {
  const safe = shares.map((s) => (Number.isFinite(s) && s > 0 ? s : 0));
  const out = apportion(safe, maxBlocks);

  for (let i = 0; i < out.length; i += 1) {
    if (out[i] === 0 && safe[i] > 0) {
      const widest = out.indexOf(Math.max(...out));
      // Never rob a slice down to nothing to pay for another — that would just
      // move the erasure. If no slice can afford it, the run is too coarse for
      // this data and the legend is carrying the whole chart anyway.
      if (out[widest] > 1) {
        out[widest] -= 1;
        out[i] = 1;
      }
    }
  }
  return out;
}

/** True when `stackBlocks` had to widen a slice to keep it visible. */
export function flooredAny(shares: number[], maxBlocks = MAX_BLOCKS): boolean {
  const safe = shares.map((s) => (Number.isFinite(s) && s > 0 ? s : 0));
  return apportion(safe, maxBlocks).some((b, i) => b === 0 && safe[i] > 0);
}

/**
 * Thousands separators without `toLocaleString`.
 *
 * The card is built on a server whose ICU data is not something this project
 * pins, and a test that asserts "2,481" must not depend on the runtime's default
 * locale. Every number on this card is English-formatted regardless.
 */
function thousands(n: number): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** Which magnitude this chart plots, decided by the columns the analyst declared. */
function plottedRole(spec: ChartSpec): 'share' | 'rate' | 'count' | null {
  const roles = new Set(spec.columns.map((c) => c.role));
  // `share` leads. A donut spec also carries its raw counts, and without this it
  // would resolve to 'count' and reach the volume note by way of a column that is
  // only there to be printed in the legend.
  if (roles.has('share')) return 'share';
  if (roles.has('rate')) return 'rate';
  if (roles.has('count')) return 'count';
  return null;
}

type PlotRole = 'share' | 'rate' | 'count';

function magnitude(row: ChartRow, role: PlotRole): number | null {
  const v = role === 'share' ? row.share : role === 'rate' ? row.rate : row.count;
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function formatValue(v: number, role: PlotRole): string {
  if (role === 'count') return thousands(v);
  // A NON-ZERO SLICE MUST NEVER PRINT AS 0.0%. `toFixed(1)` renders 0.04 as
  // "0.0%", which beside a count of 3 is a flat contradiction and beside a count
  // of 0 is indistinguishable from a category that never fired. Same rule, in
  // text, as the block floor above.
  if (v > 0 && v < 0.05) return '<0.1%';
  return `${v.toFixed(1)}%`;
}

/**
 * Build both renderings of one chart.
 *
 * The returned widgets are a section body, not a section — the caller decides
 * whether it folds in with its neighbours, which is where the decision about
 * Gmail's hairline belongs (see `fold()` in widgets.ts).
 */
export function buildChart(spec: ChartSpec): ChartRender {
  const widgets: Widget[] = [text(heading(spec.title))];

  // NOT CHARTABLE MEANS NO BARS, AND IT HAS TO BE SAID FIRST.
  //
  // On a full page the verdict can sit above the chart and be read on the way
  // past. In 400px there is no "above" — so the rule is harder here than in
  // chart-metric: the rows render as plain text with the verdict leading, and
  // nothing acquires a length the eye can compare. A ranking somebody was told
  // not to act on must not arrive as a tidy bar chart.
  if (!spec.chartable) {
    widgets.push(
      text(
        `<font color="${FIRE}"><b>Not charted.</b></font> ` +
          escapeText(spec.verdict ?? 'The measurement does not support a chart.'),
      ),
      spacer(),
    );
    for (const row of spec.rows) {
      widgets.push(
        deco({
          text: escapeText(row.label),
          bottomLabel: describeRow(row, spec),
          wrapText: true,
        }),
      );
    }
    return done(spec, [...widgets, ...caveatWidgets(spec)]);
  }

  const role = plottedRole(spec);
  if (role === null || spec.rows.length === 0) {
    // An empty result is a finding, and the sentence is the finding. An empty
    // frame with axes would claim we looked and there was nothing, which is a
    // different statement from "there was nothing to plot".
    widgets.push(text(escapeText('No rows to chart for this question.')));
    return done(spec, [...widgets, ...caveatWidgets(spec)]);
  }

  // THE SHAPE DISPATCH GOES HERE AND NOWHERE EARLIER.
  //
  // Below this line is the ranking renderer, and both of the things it adds — the
  // "ranked by volume" note and the baseline row — are WRONG for a composition.
  // They are not skipped by a condition; the donut simply never reaches them, so
  // no future edit to either can leak into a ring. Above this line are the two
  // gates that mean the same thing for every shape: a chart nobody may act on
  // draws nothing, and no rows is a sentence rather than an empty frame. A donut
  // must refuse identically, so it is dispatched after them, not before.
  if (spec.kind === 'donut') {
    return done(spec, [...widgets, ...donutBody(spec), ...caveatWidgets(spec)]);
  }

  // Scale from the largest value PLOTTED, and from the baseline too when there
  // is one — otherwise a baseline above every bar falls off the end of the
  // column and the reader sees bars with no reference at all.
  const values = spec.rows.map((r) => magnitude(r, role)).filter((v): v is number => v !== null);
  const max = Math.max(...values, role === 'rate' ? (spec.baseRate?.value ?? 0) : 0);

  // RANKED BY VOLUME, AND IT MUST SAY SO.
  //
  // chart-metric §3: a chart with a count and no rate is ranking how much mail a
  // client sends. The busiest client tops it whether or not anything is wrong,
  // and that is the single most common way a true number becomes a false
  // picture. The note is not a caveat, it is what the chart means.
  if (role === 'count') {
    widgets.push(
      text(
        `<font color="${QUIET}">Ranked by volume — no rate was supplied, ` +
          `so a busy client outranks a troubled one.</font>`,
      ),
    );
  }

  widgets.push(spacer());

  for (const row of spec.rows) {
    const v = magnitude(row, role);
    // A row with no value keeps its place and says so. Dropping it would change
    // the denominator of what the reader thinks they are looking at.
    if (v === null) {
      widgets.push(
        deco({
          text: escapeText(row.label),
          bottomLabel: `<font color="${QUIET}">not measured</font>`,
          wrapText: true,
        }),
      );
      continue;
    }

    // BELOW THE FLOOR IS NOT A VISUAL EQUAL.
    //
    // A median over two threads is an anecdote with a decimal point, and at bar
    // length alone it is indistinguishable from one over two hundred. Muted to
    // grey and annotated with its n — never dropped, because the cut would be
    // invisible.
    const muted = row.belowFloor === true;
    const colour = muted ? QUIET : FIRE;
    const bar = barGlyphs(max > 0 ? v / max : 0);

    widgets.push(
      deco({
        text:
          `<b>${escapeText(row.label)}</b>` +
          (muted ? ` <font color="${QUIET}">below floor</font>` : ''),
        // NO EMPTY COLOUR ATTRIBUTE. `<font color="">` is not a no-op on the way
        // out: the extension escapes card text completely and then restores a
        // whitelist BY TAG SHAPE, and its pattern requires `color="#rrggbb"`.
        // An empty attribute never matches, so the tag survives as visible
        // literal text beside every bar — which is precisely the failure that
        // put `<font color="#c5221f">` on screen across 21 of this card's 63
        // strings. A tag with nothing to say is simply not emitted.
        bottomLabel:
          `<font color="${colour}">${bar}</font> ` +
          (muted ? `<font color="${QUIET}">${formatValue(v, role)}</font>` : formatValue(v, role)) +
          (typeof row.sampleN === 'number' ? ` · n=${row.sampleN}` : '') +
          // The second reading, if the caller supplied one. Escaped like every
          // other string that reaches a card: it is written by us today, but the
          // whole point of the field is that it carries a computed figure.
          (row.note ? ` · ${escapeText(row.note)}` : ''),
        wrapText: true,
      }),
    );
  }

  // THE BASELINE IS A ROW, BECAUSE THIS SURFACE HAS NO POSITIONING.
  //
  // A reference line wants to cross the bars. Cards v2 cannot place anything, and
  // `/bar.png` paints a band across the whole column rather than a tick at a
  // coordinate. But every bar starts at the same left edge, so a baseline drawn
  // as its own left-anchored run at the same scale IS comparable by eye — the
  // reader sees which bars pass it. Shaded, not solid, so it never reads as
  // another client.
  if (role === 'rate' && spec.baseRate) {
    widgets.push(
      spacer(),
      deco({
        text: `<font color="${QUIET}">${escapeText(spec.baseRate.label)}</font>`,
        bottomLabel:
          `<font color="${QUIET}">${SHADE.repeat(
            Math.max(1, barGlyphs(max > 0 ? spec.baseRate.value / max : 0).length),
          )} ${spec.baseRate.value.toFixed(1)}%</font>`,
        wrapText: true,
      }),
    );
  }

  return done(spec, [...widgets, ...caveatWidgets(spec)]);
}

/**
 * A share of a whole, for a surface that cannot draw an arc.
 *
 * Gmail gets no SVG, no positioning and no picture: ADR-004 deleted the server-side
 * renderer and forbids putting a datum in a URL, so there is no honest way to send
 * a ring. What Cards v2 does give is the same thing the bars use — a run of block
 * characters whose length is proportional because the glyph repeats — and a
 * composition has an exact analogue: ONE run, segmented, spending the full width
 * once. The parts are adjacent rather than stacked in depth, which is what a
 * 100%-stacked bar is anyway.
 *
 * The stack alone would be a picture with no numbers, so every slice also gets a
 * legend row carrying its swatch, name, percent and count. That row is the part
 * that survives when the widths stop being readable, and on a real churn split —
 * where one level usually dominates — it is doing most of the work.
 */
function donutBody(spec: ChartSpec): Widget[] {
  // MORE PARTS THAN THE RAMP CAN COLOUR APART IS A REFUSAL, NOT A REPEAT.
  //
  // Cycling the palette would give two slices the same colour and the legend would
  // be the only way to tell them apart — which is a table with a decorative stripe
  // on top, not a chart. A composition this fine does not read at 400px in any
  // rendering, so say so rather than draw it.
  if (spec.rows.length > SEVERITY_RAMP.length) {
    return [
      text(
        `<font color="${FIRE}"><b>Not charted.</b></font> ` +
          escapeText(
            `A share of a whole with ${spec.rows.length} parts does not read in this column; ` +
              `${SEVERITY_RAMP.length} is the most this card can colour apart.`,
          ),
      ),
    ];
  }

  const widgets: Widget[] = [];

  // THE DENOMINATOR LEADS, BECAUSE THE RING CANNOT SAY IT.
  //
  // Percentages of an unstated whole are the standard way a composition misleads:
  // "18% critical" reads as alarming at any n, and four slices look identical
  // whether they divide forty messages or forty thousand.
  if (spec.denominator) {
    const d = spec.denominator;
    widgets.push(
      text(
        `<font color="${QUIET}">n=${thousands(d.value)} ${escapeText(d.label)}` +
          (d.of ? ` of ${thousands(d.of.value)} ${escapeText(d.of.label)}` : '') +
          `</font>`,
      ),
    );
  }

  const shares = spec.rows.map((r) =>
    typeof r.share === 'number' && Number.isFinite(r.share) && r.share > 0 ? r.share : 0,
  );

  if (shares.reduce((a, b) => a + b, 0) <= 0) {
    // Distinct from "No rows to chart": there the question had no population at
    // all, here we looked at a real one and every part of it was zero. Those are
    // different findings and the reader can act on only one of them.
    widgets.push(
      text(escapeText('Nothing was flagged in this window, so there is no share to divide.')),
    );
    return widgets;
  }

  const blocks = stackBlocks(shares);
  const countLabel = spec.columns.find((c) => c.role === 'count')?.label ?? '';

  widgets.push(spacer());

  // THE CAPTION STATES THE ORDER, WHICH IS THE ONE THING A STACK CANNOT SHOW.
  //
  // These slices are in a deliberate sequence — severity, usually — and a reader
  // who assumes the widest comes first will read the ramp backwards. Naming the
  // first and last row makes the direction explicit without a legend key.
  widgets.push(
    deco({
      text: `<font color="${QUIET}">${escapeText(
        `${spec.rows[0].label} → ${spec.rows[spec.rows.length - 1].label}`,
      )}</font>`,
      bottomLabel: blocks
        .map((b, i) => (b > 0 ? `<font color="${SEVERITY_RAMP[i]}">${FULL.repeat(b)}</font>` : ''))
        .join(''),
      wrapText: true,
    }),
  );

  spec.rows.forEach((row, i) => {
    const measured = typeof row.share === 'number' && Number.isFinite(row.share);
    const parts: string[] = [];
    if (typeof row.count === 'number' && Number.isFinite(row.count)) {
      parts.push(`${thousands(row.count)}${countLabel ? ` ${escapeText(countLabel.toLowerCase())}` : ''}`);
    }
    if (row.note) parts.push(escapeText(row.note));

    widgets.push(
      deco({
        // The swatch is the same glyph as the stack, so the eye matches the legend
        // to the run by shape as well as by colour — which is what makes the pair
        // legible to a reader who cannot distinguish the ochre from the orange.
        text:
          `<font color="${SEVERITY_RAMP[i]}">${FULL}</font> <b>${escapeText(row.label)}</b>` +
          (measured ? ` · ${formatValue(row.share as number, 'share')}` : ''),
        bottomLabel: measured
          ? `<font color="${QUIET}">${parts.join(' · ') || '—'}</font>`
          : `<font color="${QUIET}">not measured</font>`,
        wrapText: true,
      }),
    );
  });

  // WHEN THE WIDTHS STOPPED BEING TRUE, SAY SO ON THE CARD.
  //
  // Not a `caveats` entry: this is a statement about what THIS rendering could
  // resolve, and it is false of the extension's ring, which draws the same slice
  // at its real angle. A caveat that travels with the numbers would follow them
  // onto a surface where it does not apply.
  if (flooredAny(shares)) {
    widgets.push(
      text(
        `<font color="${QUIET}">${escapeText(
          'The narrowest slices are drawn wider than they are, so they stay visible — read the percentages, not the widths.',
        )}</font>`,
      ),
    );
  }

  return widgets;
}

/**
 * Stamp the run length onto the spec that goes out with it.
 *
 * Every exit from `buildChart` goes through here, so the count can never
 * describe a different set of widgets than the ones being returned — which is
 * the entire failure this indirection prevents.
 */
function done(spec: ChartSpec, widgets: Widget[]): ChartRender {
  return { spec: { ...spec, fallbackWidgets: widgets.length }, widgets };
}

/** The n and denominator for a row that is not being plotted. */
function describeRow(row: ChartRow, spec: ChartSpec): string {
  const role = plottedRole(spec);
  const v = role ? magnitude(row, role) : null;
  const parts: string[] = [];
  if (v !== null && role) parts.push(formatValue(v, role));
  if (typeof row.sampleN === 'number') parts.push(`n=${row.sampleN}`);
  if (row.note) parts.push(escapeText(row.note));
  return `<font color="${QUIET}">${parts.join(' · ') || '—'}</font>`;
}

/**
 * The window and the caveats, below the chart and never collapsed.
 *
 * A caveat the reader has to open is a caveat that does not exist. The blind
 * tail leads because it is the one that silently changes what the picture means.
 */
function caveatWidgets(spec: ChartSpec): Widget[] {
  const lines: string[] = [];
  if (spec.window?.blindTail) lines.push(spec.window.blindTail);
  if (spec.window?.start && spec.window?.end) {
    lines.push(
      `${spec.window.start.slice(0, 10)} → ${spec.window.end.slice(0, 10)}` +
        (spec.window.cutoffSource ? ` · ${spec.window.cutoffSource}` : ''),
    );
  }
  lines.push(...(spec.caveats ?? []));
  if (lines.length === 0) return [];
  return [
    spacer(),
    text(`<font color="${QUIET}">${lines.map((l) => escapeText(l)).join('<br>')}</font>`),
  ];
}

/** The chart as a whole card section, for a caller that wants one. */
export function chartSection(spec: ChartSpec): { section: CardSection; spec: ChartSpec } {
  const { widgets } = buildChart(spec);
  return { section: { widgets }, spec };
}
