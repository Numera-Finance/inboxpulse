/**
 * Renders a donut end to end and reads the geometry back out of the markup.
 *
 * WHY THIS EXISTS SEPARATELY FROM chart.test.ts AND donut-arc.domtest.ts. Those
 * two check the halves: the add-on's widgets, and the arc maths. Neither has ever
 * put a ring on screen. This project's signature failure is a chart whose every
 * structural assertion passes while the thing rendered is wrong — the
 * `sanitizeCardHtml` bug garbled 21 of 63 strings with every check green, because
 * none of them rendered a string and looked at it.
 *
 * So this drives the REAL path: `buildChart` produces the card widgets and the
 * spec together, `CardRenderer` splices one for the other, and the assertions are
 * made against the emitted SVG and the emitted card text. It is the closest thing
 * to looking at the panel that does not need a browser.
 *
 * Needs no service — the numbers are a fixture, on purpose. What is under test is
 * the rendering, not the query.
 *
 *   cd apps/chrome-extension && bun lib/donut-render.domtest.ts
 */

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CardRenderer, sanitizeCardHtml } from '../components/CardRenderer';
import { buildChart, SEVERITY_RAMP, type ChartSpec } from '../../addon/src/cards/chart';
import type { CardSection, ChartSpec as PanelChartSpec } from './addon-client';

let failures = 0;
function check(ok: boolean, label: string, detail = ''): void {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
}

/**
 * The measured churn mix, as a fixture.
 *
 * Real shape, real skew: one wedge at 87.8% and a 2% tail. A donut that only ever
 * gets tested on four tidy quarters is not tested — the dominant-slice case is
 * where the large-arc flag fires and where the narrow wedges get erased.
 */
const CHURN: ChartSpec = {
  id: 'churn_mix_40d',
  title: 'Churn risk mix, last 40 days',
  kind: 'donut',
  chartable: true,
  columns: [
    { name: 'level', role: 'label', label: 'Risk level' },
    { name: 'emails', role: 'count', label: 'Emails', unit: 'count' },
    { name: 'share', role: 'share', label: 'Share of flagged', unit: 'percent' },
    { name: 'total', role: 'denominator', label: 'Churn-flagged' },
  ],
  rows: [
    { label: 'Low', count: 10480, share: 87.8 },
    { label: 'Medium', count: 863, share: 7.23 },
    { label: 'High', count: 344, share: 2.88 },
    { label: 'Critical', count: 249, share: 2.09 },
  ],
  baseRate: null,
  denominator: { value: 11936, label: 'churn-flagged', of: { value: 44067, label: 'client messages' } },
  window: {
    start: '2026-07-11T10:20:22Z',
    end: '2026-08-20T10:20:22Z',
    cutoffSource: 'anchored on the latest ingested mail',
    blindTail: 'no churn row after 2026-08-14; 8,672 messages blind',
  },
  caveats: ['coverage is 27% of client mail and is not random'],
};

/** Render a spec the way the panel does: card widgets in, spec riding beside. */
function render(spec: ChartSpec, withSpec = true): string {
  const { spec: stamped, widgets } = buildChart(spec);
  const sections = [{ widgets }] as unknown as CardSection[];
  const charts = withSpec ? ([stamped] as unknown as PanelChartSpec[]) : [];
  return renderToStaticMarkup(createElement(CardRenderer, { sections, charts }));
}

/** Every stroked ring segment, in document order, as its colour. */
function strokesOf(html: string): string[] {
  return [...html.matchAll(/<(?:path|circle)[^>]*stroke="(#[0-9a-fA-F]{6})"/g)].map((m) => m[1]);
}

/* ---- the splice actually happened ---------------------------------------- */

const html = render(CHURN);

check(html.includes('class="ipc__donut-svg"'), 'the ring is drawn, keyed on its own class');

check(
  !html.includes('█'),
  'the card fallback was CONSUMED, not left beside the ring',
  // If the splice misses, the block run survives and the panel shows the
  // composition twice — once as a ring and once as glyphs, which is how a
  // fallbackWidgets drift renders rather than by failing.
  html.includes('█') ? 'block glyphs still present' : '',
);

/* ---- the ring is the numbers --------------------------------------------- */

{
  const strokes = strokesOf(html);
  check(
    JSON.stringify(strokes) === JSON.stringify([...SEVERITY_RAMP]),
    'four wedges, in severity order, painted by the ramp',
    strokes.join(','),
  );
}

{
  // The dominant wedge must carry large-arc=1 and the tail must not. Read back
  // out of the rendered `d`, not from the function that produced it.
  const flags = [...html.matchAll(/A [\d.]+ [\d.]+ 0 ([01]) 1/g)].map((m) => Number(m[1]));
  check(
    JSON.stringify(flags) === JSON.stringify([1, 0, 0, 0]),
    'the 87.8% wedge sweeps the long way round, the 2% wedges do not',
    JSON.stringify(flags),
  );
}

/* ---- every number on the figure came from the spec ----------------------- */

for (const [label, pct, n] of [
  ['Low', '87.8%', '10,480'],
  ['Medium', '7.2%', '863'],
  ['High', '2.9%', '344'],
  ['Critical', '2.1%', '249'],
] as const) {
  check(html.includes(pct), `the legend prints ${label} at ${pct}`);
  check(html.includes(n), `the legend prints ${label}'s count as ${n}`);
}

check(
  html.includes('n=11,936 churn-flagged of 44,067 client messages'),
  'the whole is stated in words, because the ring cannot say it',
);

check(
  html.includes('8,672 messages blind'),
  'the blind tail is printed, not collapsed',
);

/* ---- the aria-label carries the chart, not the word "chart" -------------- */

{
  const aria = html.match(/aria-label="([^"]*)"/)?.[1] ?? '';
  const namesAll = ['Low', 'Medium', 'High', 'Critical'].every((l) => aria.includes(l));
  check(namesAll && aria.includes('87.8%'), 'a screen reader gets every wedge and its share', aria.slice(0, 80));
}

/* ---- the fallback is a complete rendering on its own --------------------- */

{
  // The panel must degrade to the card's own segmented run when no spec rides
  // along — an older add-on, or a kind this build declined. Losing the SVG is
  // allowed; losing the numbers is not.
  const bare = render(CHURN, false);
  check(!bare.includes('ipc__donut-svg'), 'no spec, no ring');
  check(bare.includes('█'), 'no spec, but the segmented run is still there');
  check(bare.includes('87.8%') && bare.includes('10,480'), 'no spec, and every number survives');
}

/* ---- the refusal refuses in pixels too ----------------------------------- */

{
  const refused = render({
    ...CHURN,
    chartable: false,
    verdict: 'low is the enum floor, not a judgement about the customer',
  });
  check(strokesOf(refused).length === 0, 'chartable:false draws no ring at all');
  check(!refused.includes('ipc__donut-svg'), 'chartable:false draws no ring element');
  check(refused.includes('Not charted'), 'chartable:false says so');
  check(
    refused.includes('low is the enum floor'),
    'chartable:false prints the analyst\'s reason verbatim',
  );
  check(
    ['Low', 'Medium', 'High', 'Critical'].every((l) => refused.includes(l)),
    'chartable:false still answers the question',
  );
}

/* ---- the cross-package escaping contract, run for real ------------------- */

{
  // chart.test.ts checks the add-on's tags against a COPY of the whitelist
  // regex. This runs the extension's actual sanitizer over the actual card
  // strings — the only check that would have caught `<font color="#c5221f">`
  // rendering as visible characters across 21 of this card's 63 strings.
  const { widgets } = buildChart(CHURN);
  const strings = widgets.flatMap((w) => {
    const any = w as Record<string, { text?: string; bottomLabel?: string }>;
    return [any.textParagraph?.text, any.decoratedText?.text, any.decoratedText?.bottomLabel];
  }).filter((s): s is string => Boolean(s));

  const sanitized = strings.map(sanitizeCardHtml);
  const leaked = sanitized.filter((s) => s.includes('&lt;font') || s.includes('&lt;b&gt;'));
  check(leaked.length === 0, 'no card tag survives the sanitizer as literal text', leaked[0] ?? '');

  const fontsIn = strings.join('').match(/<font /g)?.length ?? 0;
  const fontsOut = sanitized.join('').match(/<font /g)?.length ?? 0;
  check(
    fontsIn > 0 && fontsIn === fontsOut,
    'every colour tag the donut emits is restored, none dropped',
    `${fontsIn} in, ${fontsOut} out`,
  );

  // And the ramp's four hexes specifically: a new colour is the thing most
  // likely to be written in a shape the whitelist cannot restore.
  for (const hex of SEVERITY_RAMP) {
    check(
      sanitized.join('').includes(`<font color="${hex}">`),
      `the ramp colour ${hex} survives the sanitizer`,
    );
  }
}

console.log(failures === 0 ? '\nPASS' : `\n${failures} FAILED`);
if (failures > 0) process.exit(1);
