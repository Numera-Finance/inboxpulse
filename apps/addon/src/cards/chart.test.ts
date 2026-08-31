import { describe, it, expect } from 'vitest';
import {
  buildChart,
  barGlyphs,
  stackBlocks,
  flooredAny,
  SEVERITY_RAMP,
  type ChartSpec,
} from './chart';
import {
  buildHomepageCard,
  homepageCharts,
  type FiresView,
  type NegativeShareView,
} from './homepage';
import type { Widget } from './widgets';

/**
 * What these tests are for.
 *
 * A chart is the most credulous format in this project, and the failure mode is
 * never an exception — it is a picture that renders beautifully at the wrong
 * scale. Every structural check on this panel stayed green through the
 * `sanitizeCardHtml` bug that garbled 21 of 63 strings, because none of them
 * rendered a string and looked at it.
 *
 * So the assertions below are about MAGNITUDE and about the gates, not about
 * which widgets exist. "Does the section have three rows" passes against a chart
 * whose bars are all the same length.
 */

/** Bar length in eighths of a block — the unit the renderer actually works in. */
function widthEighths(bar: string): number {
  const EIGHTHS = ['▏', '▎', '▍', '▌', '▋', '▊', '▉'];
  let n = 0;
  for (const ch of bar) {
    if (ch === '█') n += 8;
    else {
      const i = EIGHTHS.indexOf(ch);
      if (i >= 0) n += i + 1;
    }
  }
  return n;
}

/** Every bar run in a rendered chart, in order, as eighths. */
function barsOf(widgets: Widget[]): number[] {
  return flatten(widgets)
    .map((s) => s.match(/[█▏▎▍▌▋▊▉]+/)?.[0])
    .filter((b): b is string => Boolean(b))
    .map(widthEighths);
}

function flatten(widgets: Widget[]): string[] {
  const out: string[] = [];
  for (const w of widgets) {
    const any = w as Record<string, { text?: string; topLabel?: string; bottomLabel?: string }>;
    if (any.textParagraph?.text !== undefined) out.push(any.textParagraph.text);
    const d = any.decoratedText;
    if (d) out.push(d.text ?? '', d.topLabel ?? '', d.bottomLabel ?? '');
  }
  return out;
}

const spec = (over: Partial<ChartSpec>): ChartSpec => ({
  id: 't',
  title: 'Test chart',
  kind: 'bars',
  chartable: true,
  columns: [
    { name: 'label', role: 'label', label: 'Thing' },
    { name: 'n', role: 'count', label: 'Count', unit: 'count' },
  ],
  rows: [],
  ...over,
});

describe('barGlyphs', () => {
  it('is proportional — the property a chart lives or dies by', () => {
    // Half scale must be half the width. This is the assertion that fails if
    // someone reaches for a log axis, an offset, or a "nicer looking" minimum
    // bar length, all of which make a chart lie while still rendering.
    const full = widthEighths(barGlyphs(1));
    const half = widthEighths(barGlyphs(0.5));
    const quarter = widthEighths(barGlyphs(0.25));
    expect(half / full).toBeCloseTo(0.5, 2);
    expect(quarter / full).toBeCloseTo(0.25, 2);
  });

  it('never renders a non-zero value as nothing', () => {
    // A value at 1/500th of the maximum still has to be visible: a blank line
    // reads as zero, which is the one thing a bar must never say about a number
    // that is not zero.
    expect(barGlyphs(0.002)).not.toBe('');
    expect(widthEighths(barGlyphs(0.002))).toBeGreaterThan(0);
  });

  it('renders a true zero as nothing, and clamps an overrun', () => {
    expect(barGlyphs(0)).toBe('');
    expect(barGlyphs(-1)).toBe('');
    // Above full scale is a bug upstream; the honest rendering is a full bar,
    // not one that overruns the column and wraps into a second line.
    expect(widthEighths(barGlyphs(3))).toBe(widthEighths(barGlyphs(1)));
  });
});

describe('buildChart — scale', () => {
  it('draws bars in proportion to the values, not to their rank', () => {
    const { widgets } = buildChart(
      spec({ rows: [{ label: 'a', count: 100 }, { label: 'b', count: 50 }, { label: 'c', count: 10 }] }),
    );
    const bars = barsOf(widgets);
    expect(bars).toHaveLength(3);
    expect(bars[1] / bars[0]).toBeCloseTo(0.5, 1);
    expect(bars[2] / bars[0]).toBeCloseTo(0.1, 1);
  });

  it('keeps a row with no value, and gives it no bar', () => {
    // Dropping it would quietly change the population the reader thinks they
    // are looking at. It has to be present and visibly unmeasured.
    const { widgets } = buildChart(
      spec({ rows: [{ label: 'a', count: 10 }, { label: 'gap', count: null }] }),
    );
    expect(barsOf(widgets)).toHaveLength(1);
    expect(flatten(widgets).join(' ')).toContain('not measured');
  });
});

describe('buildChart — the gates', () => {
  it('draws NO bars at all when the analyst said not to chart it', () => {
    const { widgets } = buildChart(
      spec({
        chartable: false,
        verdict: 'ranks by volume; do not act on the order',
        rows: [{ label: 'a', count: 100 }, { label: 'b', count: 1 }],
      }),
    );
    // The whole point: a ranking somebody was told not to act on must not
    // acquire a length the eye can compare.
    expect(barsOf(widgets)).toHaveLength(0);
    const flat = flatten(widgets).join(' ');
    expect(flat).toContain('Not charted');
    expect(flat).toContain('ranks by volume; do not act on the order');
    // The rows still render — refusing to chart is not refusing to answer.
    expect(flat).toContain('a');
    expect(flat).toContain('b');
  });

  it('says so when it is ranking by volume', () => {
    const { widgets } = buildChart(spec({ rows: [{ label: 'a', count: 3 }] }));
    expect(flatten(widgets).join(' ')).toContain('Ranked by volume');
  });

  it('does not claim volume-ranking when a rate is being plotted', () => {
    const { widgets } = buildChart(
      spec({
        columns: [
          { name: 'label', role: 'label', label: 'Thing' },
          { name: 'r', role: 'rate', label: 'Rate', unit: 'percent' },
        ],
        rows: [{ label: 'a', rate: 20 }],
      }),
    );
    expect(flatten(widgets).join(' ')).not.toContain('Ranked by volume');
  });

  it('draws the baseline at the same scale as the bars', () => {
    // A reference line at the wrong scale is worse than none: the reader
    // compares lengths and concludes the opposite of the truth.
    const { widgets } = buildChart(
      spec({
        columns: [
          { name: 'label', role: 'label', label: 'Thing' },
          { name: 'r', role: 'rate', label: 'Rate', unit: 'percent' },
        ],
        rows: [{ label: 'a', rate: 20 }, { label: 'b', rate: 5 }],
        baseRate: { value: 10, unit: 'percent', label: 'firm baseline' },
      }),
    );
    const bars = barsOf(widgets);
    const shade = flatten(widgets)
      .map((s) => s.match(/░+/)?.[0])
      .find(Boolean) as string;
    expect(shade).toBeTruthy();
    // 10% against a 20% maximum is half the longest bar. The baseline uses a
    // different glyph, so it is compared by count of characters against the
    // full-block width of the top bar.
    expect(shade.length / (bars[0] / 8)).toBeCloseTo(0.5, 1);
  });

  it('mutes a below-floor row instead of dropping it', () => {
    const { widgets } = buildChart(
      spec({
        rows: [
          { label: 'solid', count: 10, sampleN: 400 },
          { label: 'thin', count: 9, sampleN: 2, belowFloor: true },
        ],
      }),
    );
    const flat = flatten(widgets);
    // Present, near-equal in length, and visibly not a peer.
    expect(barsOf(widgets)).toHaveLength(2);
    const thin = flat.find((s) => s.includes('thin')) ?? '';
    expect(thin).toContain('below floor');
    const thinBar = flat.find((s) => /[█▏▎▍▌▋▊▉]/.test(s) && s.includes('#5f6368'));
    expect(thinBar).toBeTruthy();
    // And its n is on the row, so the reader can discount it themselves.
    expect(flat.join(' ')).toContain('n=2');
  });

  it('prints the caveats and the blind tail rather than collapsing them', () => {
    const { widgets } = buildChart(
      spec({
        rows: [{ label: 'a', count: 1 }],
        window: { blindTail: 'no sentiment row after 2026-08-14; 8672 msgs blind' },
        caveats: ['coverage varies 48-98% between domains'],
      }),
    );
    const flat = flatten(widgets).join(' ');
    expect(flat).toContain('2026-08-14');
    expect(flat).toContain('coverage varies');
  });

  it('writes the sentence rather than drawing an empty frame', () => {
    const { widgets } = buildChart(spec({ rows: [] }));
    expect(barsOf(widgets)).toHaveLength(0);
    expect(flatten(widgets).join(' ')).toContain('No rows to chart');
  });
});

describe('buildChart — every font tag must survive the renderer', () => {
  /**
   * The extension escapes card text completely and then restores a whitelist BY
   * TAG SHAPE — this exact pattern, from CardRenderer.sanitizeCardHtml. A tag
   * that does not match it is not dropped, it is rendered as visible literal
   * text. That is how `<font color="#c5221f">` ended up on screen across 21 of
   * this card's 63 strings, and an empty `color=""` fails it the same way.
   *
   * Duplicated here on purpose: it is a CONTRACT with the other package, and a
   * contract asserted on only one side is not asserted.
   */
  const RESTORABLE = /^<font color="#[0-9a-fA-F]{3,6}">$/;

  const everyFontTag = (widgets: Widget[]): string[] =>
    flatten(widgets).flatMap((s) => s.match(/<font[^>]*>/g) ?? []);

  it('emits no colour attribute the renderer cannot restore', () => {
    const { widgets } = buildChart(
      spec({
        rows: [
          { label: 'plain', count: 10, sampleN: 400 },
          { label: 'muted', count: 4, sampleN: 2, belowFloor: true },
          { label: 'absent', count: null },
        ],
        window: { blindTail: 'blind' },
        caveats: ['a caveat'],
      }),
    );
    const tags = everyFontTag(widgets);
    expect(tags.length).toBeGreaterThan(0);
    for (const tag of tags) expect(tag).toMatch(RESTORABLE);
  });

  it('covers the refusal and the baseline paths too', () => {
    const rate = spec({
      columns: [
        { name: 'label', role: 'label', label: 'Thing' },
        { name: 'r', role: 'rate', label: 'Rate', unit: 'percent' },
      ],
      rows: [{ label: 'a', rate: 20 }],
      baseRate: { value: 10, unit: 'percent', label: 'firm baseline' },
    });
    for (const s of [rate, spec({ chartable: false, verdict: 'no', rows: [{ label: 'a', count: 1 }] })]) {
      for (const tag of everyFontTag(buildChart(s).widgets)) expect(tag).toMatch(RESTORABLE);
    }
  });
});

describe('buildChart — the second reading', () => {
  it('prints a row note beside n, and never plots it', () => {
    // A question with two honest readings that rank differently: the bars draw
    // one, the note carries the other. The note must not influence the geometry.
    const withNote = buildChart(
      spec({
        rows: [
          { label: 'a', count: 10, sampleN: 100, note: '18.2% of all complaints' },
          { label: 'b', count: 5, sampleN: 50, note: '31.0% of all complaints' },
        ],
      }),
    );
    const without = buildChart(
      spec({ rows: [{ label: 'a', count: 10, sampleN: 100 }, { label: 'b', count: 5, sampleN: 50 }] }),
    );
    expect(barsOf(withNote.widgets)).toEqual(barsOf(without.widgets));
    expect(flatten(withNote.widgets).join(' ')).toContain('18.2% of all complaints');
  });

  it('escapes a note, like everything else that reaches a card', () => {
    const { widgets } = buildChart(
      spec({ rows: [{ label: 'a', count: 1, note: '<b>5</b> & rising' }] }),
    );
    const flat = flatten(widgets).join(' ');
    expect(flat).toContain('&lt;b&gt;5&lt;/b&gt; &amp; rising');
  });
});

describe('buildChart — untrusted text', () => {
  it('escapes a label read out of the mailbox', () => {
    const { widgets } = buildChart(
      spec({ rows: [{ label: '<script>alert(1)</script> & Co', count: 5 }] }),
    );
    const flat = flatten(widgets).join(' ');
    expect(flat).not.toContain('<script>');
    expect(flat).toContain('&lt;script&gt;');
    expect(flat).toContain('&amp; Co');
  });
});

/* ---- donut ---------------------------------------------------------------
   A composition fails differently from a ranking. A ranking lies by putting the
   wrong row on top; a composition lies by not adding up, by drawing a category
   as nothing, or by being read as a ranking because its slices came out sorted.
   Every test below is aimed at one of those three. */

const donut = (over: Partial<ChartSpec>): ChartSpec => ({
  id: 'd',
  title: 'Test donut',
  kind: 'donut',
  chartable: true,
  columns: [
    { name: 'level', role: 'label', label: 'Level' },
    { name: 'emails', role: 'count', label: 'Emails', unit: 'count' },
    { name: 'share', role: 'share', label: 'Share', unit: 'percent' },
  ],
  rows: [],
  ...over,
});

/**
 * The segmented run, as [colour, block count] pairs.
 *
 * Keyed on the string being ENTIRELY font-wrapped full blocks, which the legend
 * swatch rows are not — they carry a label after the swatch. Matching "a string
 * containing blocks" would pick up a swatch and report the stack as five slices.
 */
function stackOf(widgets: Widget[]): Array<{ colour: string; blocks: number }> {
  const run = flatten(widgets).find((s) =>
    /^(<font color="#[0-9a-fA-F]{6}">█+<\/font>)+$/.test(s),
  );
  if (!run) return [];
  return [...run.matchAll(/<font color="(#[0-9a-fA-F]{6})">(█+)<\/font>/g)].map((m) => ({
    colour: m[1],
    blocks: m[2].length,
  }));
}

/** The legend rows: one swatch, one label, in order. */
function legendOf(widgets: Widget[]): Array<{ colour: string; label: string }> {
  return flatten(widgets)
    .map((s) => s.match(/^<font color="(#[0-9a-fA-F]{6})">█<\/font> <b>([^<]*)<\/b>/))
    .filter((m): m is RegExpMatchArray => Boolean(m))
    .map((m) => ({ colour: m[1], label: m[2] }));
}

describe('stackBlocks — the parts must add up', () => {
  it('spends exactly the full width, whatever the rounding', () => {
    // The first two cases pass under naive per-slice rounding and are here for
    // coverage. The DISCRIMINATORS are the next two: [10,10,10,70] rounds to 23
    // blocks and [11,11,11,67] to 25. A run one short reads as a missing
    // category; one long wraps and reads as two rows.
    for (const shares of [
      [60.5, 24.3, 10.1, 5],
      [25, 25, 25, 25],
      [10, 10, 10, 70],
      [11, 11, 11, 67],
      [0.4, 0.3, 0.2, 0.1],
    ]) {
      expect(stackBlocks(shares).reduce((a, b) => a + b, 0)).toBe(24);
    }
  });

  it('never renders a non-zero part as nothing', () => {
    // Same invariant barGlyphs protects, and the same reason: a category that
    // exists must not be drawn as absent.
    const blocks = stackBlocks([99.7, 0.1, 0.1, 0.1]);
    expect(blocks.every((b) => b >= 1)).toBe(true);
    expect(blocks.reduce((a, b) => a + b, 0)).toBe(24);
    expect(flooredAny([99.7, 0.1, 0.1, 0.1])).toBe(true);
  });

  it('renders a true zero as nothing, and does not claim it floored anything', () => {
    // The floor is for numbers that are not zero. Widening a genuine zero would
    // invent a category.
    expect(stackBlocks([50, 50, 0, 0])).toEqual([12, 12, 0, 0]);
    expect(flooredAny([50, 50, 0, 0])).toBe(false);
  });

  it('is deterministic when remainders tie', () => {
    // A chart that redraws differently on identical data is one nobody can check
    // by eye.
    expect(stackBlocks([1, 1, 1])).toEqual(stackBlocks([1, 1, 1]));
    expect(stackBlocks([1, 1, 1]).reduce((a, b) => a + b, 0)).toBe(24);
  });
});

describe('buildChart — a donut is a composition, not a ranking', () => {
  const churn = [
    { label: 'Low', count: 1502, share: 60.5 },
    { label: 'Medium', count: 604, share: 24.3 },
    { label: 'High', count: 250, share: 10.1 },
    { label: 'Critical', count: 125, share: 5.0 },
  ];

  it('draws widths from the share, never from the count', () => {
    // THE ASSERTION THAT FAILS IF SOMEONE SCALES THIS LIKE A BAR CHART. Tripling
    // every count changes nothing, because a composition is about proportion;
    // changing the shares while holding the counts changes everything.
    const sameShares = buildChart(
      donut({ rows: churn.map((r) => ({ ...r, count: r.count * 3 })) }),
    );
    const base = buildChart(donut({ rows: churn }));
    expect(stackOf(sameShares.widgets)).toEqual(stackOf(base.widgets));

    const reordered = buildChart(
      donut({
        rows: churn.map((r, i) => ({ ...r, share: [5.0, 10.1, 24.3, 60.5][i] })),
      }),
    );
    expect(stackOf(reordered.widgets)).not.toEqual(stackOf(base.widgets));
  });

  it('paints the ramp by position, so row order survives to the colour', () => {
    // Pins order, slice count and palette identity at once. `critical` is the
    // LARGEST slice here: a builder that sorted by size would paint it the palest
    // colour and the ring would read as a ranking of four things that are not
    // competing.
    const { widgets } = buildChart(
      donut({
        rows: [
          { label: 'Low', count: 1, share: 5 },
          { label: 'Medium', count: 2, share: 10 },
          { label: 'High', count: 4, share: 25 },
          { label: 'Critical', count: 12, share: 60 },
        ],
      }),
    );
    expect(stackOf(widgets).map((s) => s.colour)).toEqual([...SEVERITY_RAMP]);
    expect(legendOf(widgets).map((s) => s.colour)).toEqual([...SEVERITY_RAMP]);
    expect(legendOf(widgets).map((s) => s.label)).toEqual(['Low', 'Medium', 'High', 'Critical']);
  });

  it('never claims to be ranked by volume, though it carries counts', () => {
    // Guarded twice over: `plottedRole` resolves a donut to 'share', AND the
    // shape dispatch sits above the note. This test only exercises the first —
    // see the next one for the second.
    expect(flatten(buildChart(donut({ rows: churn })).widgets).join(' ')).not.toContain(
      'Ranked by volume',
    );
  });

  it('stays a composition even when the spec forgot its share column', () => {
    // PINS THE DISPATCH POSITION, which the test above does not: with a share
    // column present `plottedRole` blocks the volume note by itself, so moving
    // the dispatch below the note changes nothing and the assertion passes
    // against the bug. Strip the share column and `plottedRole` says 'count' —
    // now the ONLY thing standing between a donut and "ranked by volume, so a
    // busy client outranks a troubled one" is where the dispatch sits.
    //
    // A donut with no share column is malformed, and this is what it must do
    // about it: say it has no shares to divide, not quietly become a ranking.
    const { widgets } = buildChart(
      donut({
        columns: [
          { name: 'level', role: 'label', label: 'Level' },
          { name: 'emails', role: 'count', label: 'Emails', unit: 'count' },
        ],
        rows: churn.map((r) => ({ label: r.label, count: r.count })),
      }),
    );
    const flat = flatten(widgets).join(' ');
    expect(flat).not.toContain('Ranked by volume');
    expect(flat).toContain('no share to divide');
  });

  it('draws no baseline, even when one is supplied', () => {
    // On four slices a "baseline" is a mechanical 25% — a reference line that
    // means nothing, drawn at a length the eye will compare anyway.
    const { widgets } = buildChart(
      donut({
        rows: churn,
        baseRate: { value: 25, unit: 'percent', label: 'firm baseline' },
      }),
    );
    expect(flatten(widgets).join(' ')).not.toContain('░');
    expect(flatten(widgets).join(' ')).not.toContain('firm baseline');
  });

  it('states the whole under the title', () => {
    // Percentages of an unstated whole are how a composition misleads: four
    // slices look identical dividing forty messages or forty thousand.
    const { widgets } = buildChart(
      donut({
        rows: churn,
        denominator: {
          value: 2481,
          label: 'churn-flagged',
          of: { value: 18904, label: 'analysed' },
        },
      }),
    );
    expect(flatten(widgets).join(' ')).toContain('n=2,481 churn-flagged of 18,904 analysed');
  });

  it('names the direction the slices run in', () => {
    // A stack cannot show that its order is severity rather than size, and a
    // reader who assumes the widest comes first reads the ramp backwards.
    expect(flatten(buildChart(donut({ rows: churn })).widgets).join(' ')).toContain(
      'Low → Critical',
    );
  });

  it('never prints a non-zero slice as 0.0%', () => {
    // Beside a count of 3 that is a flat contradiction; beside a count of 0 it is
    // indistinguishable from a category that never fired.
    const { widgets } = buildChart(
      donut({
        rows: [
          { label: 'Low', count: 9000, share: 99.96 },
          { label: 'Critical', count: 3, share: 0.04 },
        ],
      }),
    );
    const flat = flatten(widgets).join(' ');
    expect(flat).toContain('<0.1%');
    // Needled on the separator: a bare '0.0%' also matches inside '100.0%',
    // which the dominant slice legitimately prints.
    expect(flat).not.toContain('· 0.0%');
  });

  it('keeps a zero level visible in the legend, with no blocks', () => {
    const { widgets } = buildChart(
      donut({
        rows: [
          { label: 'Low', count: 10, share: 50 },
          { label: 'Medium', count: 10, share: 50 },
          { label: 'High', count: 0, share: 0 },
          { label: 'Critical', count: 0, share: 0 },
        ],
      }),
    );
    expect(legendOf(widgets).map((s) => s.label)).toEqual(['Low', 'Medium', 'High', 'Critical']);
    expect(stackOf(widgets).map((s) => s.blocks)).toEqual([12, 12]);
  });

  it('says so when the widths stopped being true', () => {
    const floored = buildChart(
      donut({
        rows: [
          { label: 'Low', count: 997, share: 99.7 },
          { label: 'Medium', count: 1, share: 0.1 },
          { label: 'High', count: 1, share: 0.1 },
          { label: 'Critical', count: 1, share: 0.1 },
        ],
      }),
    );
    expect(flatten(floored.widgets).join(' ')).toContain('read the percentages, not the widths');

    const honest = buildChart(donut({ rows: churn }));
    expect(flatten(honest.widgets).join(' ')).not.toContain('read the percentages');
  });

  it('refuses a composition with more parts than it can colour apart', () => {
    const { widgets } = buildChart(
      donut({
        rows: Array.from({ length: 5 }, (_, i) => ({ label: `L${i}`, count: 1, share: 20 })),
      }),
    );
    expect(stackOf(widgets)).toHaveLength(0);
    expect(flatten(widgets).join(' ')).toContain('Not charted');
  });

  it('tells "we looked and it was all zero" apart from "there was nothing to look at"', () => {
    const allZero = buildChart(
      donut({ rows: [{ label: 'Low', count: 0, share: 0 }, { label: 'High', count: 0, share: 0 }] }),
    );
    expect(flatten(allZero.widgets).join(' ')).toContain('no share to divide');

    const noRows = buildChart(donut({ rows: [] }));
    expect(flatten(noRows.widgets).join(' ')).toContain('No rows to chart');
  });

  it('refuses identically to a bar chart when the analyst said not to chart it', () => {
    // The refusal is shared, and it has to stay shared: the shape dispatch sits
    // BELOW this gate. If it ever moves above, a ring appears here.
    const { widgets } = buildChart(
      donut({
        chartable: false,
        verdict: 'the levels are a model artefact, not a distribution',
        rows: churn,
      }),
    );
    expect(stackOf(widgets)).toHaveLength(0);
    expect(legendOf(widgets)).toHaveLength(0);
    const flat = flatten(widgets).join(' ');
    expect(flat).not.toContain('█');
    expect(flat).toContain('Not charted');
    expect(flat).toContain('the levels are a model artefact');
    // The rows still render — refusing to chart is not refusing to answer.
    for (const r of churn) expect(flat).toContain(r.label);
  });

  it('counts its own fallback run, in both lengths it can have', () => {
    // Two variants on purpose. A single one passes against a hardcoded number;
    // these differ by exactly the floor note, so a constant fails one of them.
    const plain = buildChart(donut({ rows: churn }));
    const floored = buildChart(
      donut({
        rows: [
          { label: 'Low', count: 997, share: 99.7 },
          { label: 'Medium', count: 1, share: 0.1 },
          { label: 'High', count: 1, share: 0.1 },
          { label: 'Critical', count: 1, share: 0.1 },
        ],
      }),
    );
    expect(plain.spec.fallbackWidgets).toBe(plain.widgets.length);
    expect(floored.spec.fallbackWidgets).toBe(floored.widgets.length);
    expect(plain.widgets.length).not.toBe(floored.widgets.length);
  });

  it('emits no colour attribute the renderer cannot restore', () => {
    // Same contract as the bars, exercised over the paths only a donut reaches:
    // the ramp, the swatches, the denominator line and the floor note. Four new
    // hexes ship with this shape and a malformed one renders as literal text.
    const RESTORABLE = /^<font color="#[0-9a-fA-F]{3,6}">$/;
    const specs = [
      donut({
        rows: churn,
        denominator: { value: 2481, label: 'churn-flagged', of: { value: 18904, label: 'analysed' } },
        window: { blindTail: 'blind' },
        caveats: ['a caveat'],
      }),
      donut({
        rows: [
          { label: 'Low', count: 997, share: 99.7 },
          { label: 'Medium', count: 1, share: 0.1 },
          { label: 'High', count: 0, share: 0 },
          { label: 'Critical', count: 1, share: null },
        ],
      }),
      donut({ chartable: false, verdict: 'no', rows: churn }),
    ];
    for (const s of specs) {
      const tags = flatten(buildChart(s).widgets).flatMap((x) => x.match(/<font[^>]*>/g) ?? []);
      expect(tags.length).toBeGreaterThan(0);
      for (const tag of tags) expect(tag).toMatch(RESTORABLE);
    }
  });

  it('escapes a label, like everything else that reaches a card', () => {
    const { widgets } = buildChart(
      donut({ rows: [{ label: '<b>Low</b> & Co', count: 1, share: 100 }] }),
    );
    const flat = flatten(widgets).join(' ');
    expect(flat).toContain('&lt;b&gt;Low&lt;/b&gt; &amp; Co');
  });
});

describe('the unhappiest-clients chart', () => {
  const view = (over: Partial<NegativeShareView> = {}): NegativeShareView => ({
    rows: [
      { customer: 'LumenData, Inc', customerId: 'a', rateOfAnalysed: 20.9, shareOfFirmNegatives: 1.96, negative: 14, analysed: 67, messages: 68, coveragePct: 98.5 },
      { customer: 'Izba Labs Inc.', customerId: 'b', rateOfAnalysed: 17.95, shareOfFirmNegatives: 0.98, negative: 7, analysed: 39, messages: 79, coveragePct: 49.4 },
    ],
    baselinePct: 2.79,
    floor: 30,
    windowEnd: '2026-08-20T10:20:22.000Z',
    lastAnalysed: '2026-08-14T13:07:08.000Z',
    blindMessages: 8672,
    qualified: 121,
    notShown: 116,
    ...over,
  });

  const specOf = (v: NegativeShareView): ChartSpec => {
    const s = homepageCharts(undefined, v).find((x) => x.id === 'negative_share');
    if (!s) throw new Error('no negative_share spec');
    return s;
  };

  it('plots the rate, never the share of all complaints', () => {
    // The two readings rank differently — a big account can reach the top of
    // share-of-all-complaints while sitting BELOW the firm baseline on its own
    // rate. Only one of them may drive a bar.
    const s = specOf(view());
    expect(s.columns.find((c) => c.role === 'rate')?.name).toBe('rateOfAnalysed');
    expect(s.columns.some((c) => c.name === 'shareOfFirmNegatives')).toBe(false);
    expect(s.rows.map((r) => r.rate)).toEqual([20.9, 17.95]);
    expect(s.rows.every((r) => r.count === undefined)).toBe(true);
  });

  it('carries the baseline, without which a rate ranking means nothing', () => {
    const s = specOf(view());
    expect(s.baseRate?.value).toBe(2.79);
    const { widgets } = buildChart(s);
    const flat = flatten(widgets).join(' ');
    expect(flat).toContain('2.8%');
    expect(flat).toContain('Firm baseline');
  });

  it('puts coverage on every row, because the rates are not comparable without it', () => {
    // Izba at 49.4% coverage sits second: half their mail was never looked at.
    // A reader deciding whether to call them has to see that beside the rate.
    const s = specOf(view());
    expect(s.rows[1].note).toContain('49.4% analysed');
    expect(flatten(buildChart(s).widgets).join(' ')).toContain('49.4% analysed');
  });

  it('states the blind tail as measured, and computes the gap itself', () => {
    const flat = flatten(buildChart(specOf(view())).widgets).join(' ');
    expect(flat).toContain('2026-08-14');
    expect(flat).toContain('8,672 messages');
    // 2026-08-20T10:20 minus 2026-08-14T13:07 is 5.9 days. A hardcoded number
    // here would be a number that stops being true the next time mail lands.
    expect(flat).toContain('5.9 days');
  });

  it('omits the blind tail rather than inventing one when nothing measured it', () => {
    const flat = flatten(
      buildChart(specOf(view({ lastAnalysed: null }))).widgets,
    ).join(' ');
    expect(flat).not.toContain('Sentiment stops');
    expect(flat).not.toContain('NaN');
  });

  it('says how many clients the top-5 cut left out', () => {
    const flat = flatten(buildChart(specOf(view())).widgets).join(' ');
    expect(flat).toContain('116 more had at least one negative');
  });

  it('says so when nothing was cut', () => {
    const flat = flatten(
      buildChart(specOf(view({ qualified: 2, notShown: 0 }))).widgets,
    ).join(' ');
    expect(flat).toContain('all 2 clients');
  });

  it('renders nothing at all when no client qualified', () => {
    // An absent section and an empty one read identically on this card, so the
    // add-on emits no chart rather than an empty frame claiming we looked.
    expect(homepageCharts(undefined, view({ rows: [] }))).toEqual([]);
  });

  it('is the only chart on this card — fires no longer produces one', () => {
    // The fires chart ("Complaints by client, charted") was retired: its rows
    // ran 4,3,1,1,1,1, so four of six bars tied at the minimum, and its six
    // clients were chosen by `unanswered` rather than by the count it drew. See
    // homepageCharts.
    //
    // Asserted with a fires view PRESENT, which is what makes this a regression
    // test rather than a tautology: passing fires in must still yield exactly
    // one spec, and it must be the rate one.
    const fires: FiresView = {
      windowDays: 90,
      webUrl: '',
      fires: [{ customerId: 'z', customer: 'Zeta', negative: 9, unanswered: 2, oldestDays: 4, owner: null }],
    };
    const both = homepageCharts(fires, view());
    expect(both.map((s) => s.id)).toEqual(['negative_share']);
    expect(both[0].columns.find((c) => c.role === 'rate')).toBeTruthy();
    expect(both[0].baseRate).toBeTruthy();
  });

  it('never draws bars for a fires view, however many complaints it carries', () => {
    // The retirement is in homepageCharts, not in the caller, so a future card
    // that forgets and passes fires still gets no chart rather than a revived
    // one. Nine complaints is well above anything the panel actually shows.
    const loud: FiresView = {
      windowDays: 90,
      webUrl: '',
      fires: [
        { customerId: 'a', customer: 'Alpha', negative: 9, unanswered: 4, oldestDays: 30, owner: null },
        { customerId: 'b', customer: 'Beta', negative: 2, unanswered: 1, oldestDays: 3, owner: null },
      ],
    };
    expect(homepageCharts(loud)).toEqual([]);
    const card = buildHomepageCard(null, undefined, undefined, undefined, undefined, loud);
    const flat = flatten(card.sections.flatMap((s) => s.widgets)).join(' ');
    expect(flat).not.toContain('Complaints by client');
  });
});

describe('the card and the specs cannot disagree', () => {
  // Was the fires view until that chart was retired. The seam this block tests
  // is not fires-specific — it is that the card's chart widgets ARE buildChart
  // applied to the specs the envelope ships — so it moved to the chart that
  // still exists rather than being deleted with the one that does not.
  const shareView = (): NegativeShareView => ({
    rows: [
      { customer: 'Alpha', customerId: 'c1', rateOfAnalysed: 12.5, shareOfFirmNegatives: 3.1, negative: 5, analysed: 40, messages: 60, coveragePct: 66.7 },
      { customer: 'Beta', customerId: 'c2', rateOfAnalysed: 22.0, shareOfFirmNegatives: 1.2, negative: 11, analysed: 50, messages: 52, coveragePct: 96.2 },
    ],
    baselinePct: 2.79,
    floor: 30,
    windowEnd: '2026-08-20T10:20:22.000Z',
    lastAnalysed: '2026-08-14T13:07:08.000Z',
    blindMessages: 8672,
    qualified: 121,
    notShown: 116,
  });

  /** The card takes negativeShare as its tenth argument. */
  const cardWith = (v: NegativeShareView) =>
    buildHomepageCard(null, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, v);

  it('renders exactly what the specs describe', () => {
    // THE SEAM. The response envelope carries the specs beside the card because
    // Cards v2 rejects unknown fields, so two things describe one chart. This is
    // the assertion that keeps them the same thing: the card's widgets ARE
    // buildChart applied to the specs the envelope ships.
    const v = shareView();
    const specs = homepageCharts(undefined, v);
    expect(specs).toHaveLength(1);

    const card = cardWith(v);
    const cardText = flatten(card.sections.flatMap((s) => s.widgets)).join('\n');
    const chartText = flatten(buildChart(specs[0]).widgets).join('\n');

    for (const line of chartText.split('\n').filter((l) => l.trim())) {
      expect(cardText).toContain(line);
    }
  });

  it('anchors the run so a real renderer replaces exactly it', () => {
    // The extension finds the chart by exact-matching `<b>${title}</b>` and then
    // consuming `fallbackWidgets`. If either end of that contract drifts it
    // renders a PARTIAL chart — half an SVG followed by three orphaned block
    // bars — rather than failing, so both ends are pinned here.
    const v = shareView();
    const { spec, widgets } = buildChart(homepageCharts(undefined, v)[0]);
    expect(spec.fallbackWidgets).toBe(widgets.length);

    const card = cardWith(v);
    const all = card.sections.flatMap((s) => s.widgets);
    const at = all.findIndex(
      (w) => (w as { textParagraph?: { text?: string } }).textParagraph?.text === `<b>${spec.title}</b>`,
    );
    expect(at).toBeGreaterThanOrEqual(0);
    expect(all.slice(at, at + (spec.fallbackWidgets ?? 0))).toEqual(widgets);
  });

  it('preserves the order the analyst supplied', () => {
    // The rows arrive ranked and are plotted in that order. Alpha is listed
    // first at 12.5% and Beta second at 22.0% — deliberately NOT re-sorted here,
    // because re-sorting a supplied ranking is what made the retired fires
    // chart disagree with the list beside it.
    const specs = homepageCharts(undefined, shareView());
    expect(specs[0].rows.map((r) => r.label)).toEqual(['Alpha', 'Beta']);
  });

  it('emits no chart when there is nothing to plot', () => {
    expect(homepageCharts(undefined)).toEqual([]);
    expect(homepageCharts(undefined, undefined)).toEqual([]);
    // A fires view, however populated, is no longer a reason to draw anything.
    expect(homepageCharts({ windowDays: 90, webUrl: '', fires: [] })).toEqual([]);
  });

  it('never puts a chart key inside the Card itself', () => {
    // Google parses the response body as a RenderActions proto and rejects
    // unknown fields, so anything the spec adds to the Card fails the WHOLE card
    // in real Gmail rather than degrading. The specs ride beside it, never in it.
    // Against the rate chart specifically: it is the one that HAS a baseRate,
    // so "the card carries no baseRate key" is a real assertion here rather
    // than one satisfied by there being nothing to leak.
    const card = cardWith(shareView());
    expect(Object.keys(card).sort()).toEqual(['sections']);
    const flat = JSON.stringify(card);
    expect(flat).not.toContain('"chartable"');
    expect(flat).not.toContain('"baseRate"');
  });
});
