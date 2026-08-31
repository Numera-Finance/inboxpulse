/**
 * Arc geometry for the panel's donut chart.
 *
 * SEPARATE FROM THE COMPONENT ON PURPOSE. This package has no test runner — its
 * only check is `tsc --noEmit` (see CLAUDE.md, "`pnpm test` and `pnpm lint` Do Not
 * Cover the Chrome Extension"), so the way anything here gets exercised is a
 * `*.domtest.ts` script run by hand under `bun`. Keeping the maths in a module
 * with no JSX and no React import means `donut-arc.domtest.ts` can call these
 * functions directly and assert on numbers, instead of regexing a `d=` attribute
 * out of rendered markup and hoping.
 *
 * Everything here is pure. Nothing decides whether a chart may be drawn; that is
 * the add-on's verdict (ADR-031), obeyed in CardRenderer.
 */

/**
 * The severity ramp, low → critical.
 *
 * MIRRORS `SEVERITY_RAMP` in `apps/addon/src/cards/chart.ts`. Duplicated rather
 * than imported: this file is bundled into a content script by WXT and the add-on
 * is a separate service, so a runtime import across that boundary would drag a
 * server module into the extension build. The same duplication-with-a-comment
 * idiom the FIRE/QUIET constants and `plottedRole` already use for this seam.
 *
 * `donut-arc.domtest.ts` imports BOTH copies and fails if they differ — a contract
 * asserted on only one side is not asserted.
 */
export const SEVERITY_RAMP = ['#5f6368', '#9a6f33', '#e8710a', '#d93025'] as const;

/**
 * A point on a circle, measured CLOCKWISE from 12 o'clock, in SVG's y-down system.
 *
 * Clockwise from the top because that is how a reader scans a pie, and because it
 * makes the first slice — the one the ramp paints first — start where the eye
 * already is.
 */
export function polar(cx: number, cy: number, radius: number, turn: number): [number, number] {
  const a = turn * 2 * Math.PI;
  return [cx + radius * Math.sin(a), cy - radius * Math.cos(a)];
}

/**
 * Cumulative slice boundaries in turns, normalised so they tile [0, 1] exactly.
 *
 * Divided each time from a RUNNING SUM, never accumulated as `t += share/total`.
 * Accumulating float error leaves the last slice ending at 0.99999994 and the ring
 * carries a hairline gap at 12 o'clock — which, on a chart whose whole claim is
 * that the parts add up to the whole, reads as a fifth category. The final
 * boundary is forced to exactly 1 for the same reason.
 *
 * Normalising also means the caller's shares need not already sum to 100: the
 * add-on rounds each share to one decimal, so four slices routinely sum to 99.9.
 */
export function boundaries(shares: number[]): Array<[number, number]> {
  const safe = shares.map((s) => (Number.isFinite(s) && s > 0 ? s : 0));
  const total = safe.reduce((a, b) => a + b, 0);
  if (total <= 0) return safe.map(() => [0, 0] as [number, number]);

  const out: Array<[number, number]> = [];
  let cum = 0;
  for (let i = 0; i < safe.length; i += 1) {
    const t0 = cum / total;
    cum += safe[i];
    out.push([t0, i === safe.length - 1 ? 1 : cum / total]);
  }
  return out;
}

/**
 * One slice as a STROKED arc along the ring's mid-radius.
 *
 * Stroked rather than a filled annulus wedge: half the coordinates, and no inner
 * return arc whose sweep flag has to be the opposite of the outer one — which is
 * the specific place hand-rolled donut code goes wrong and produces a shape that
 * renders, looks like a chart, and encloses the wrong region.
 *
 * Three returns, and the two special ones are not theoretical:
 *
 *   null       nothing to draw. A level with no mail contributes no arc — and
 *              keeps its legend row, so the reader still sees the category exists.
 *
 *   'circle'   a single slice holding the whole ring. Start and end coincide, and
 *              per SVG an `A` command whose endpoint equals its current point is a
 *              NO-OP — so the honest-looking path draws NOTHING and the chart
 *              silently disappears at exactly the moment one category took
 *              everything. A stroked circle at the mid-radius is the same annulus.
 *
 *   d string   everything else. `large-arc` is set iff the slice exceeds half the
 *              circle; with one level typically dominating a churn split, that
 *              flag fires on the first real render rather than in some edge case.
 *
 * Coordinates are fixed at 3dp, not rounded to integers: a 0.3% slice spans under
 * a pixel of arc, and integer coordinates would collapse it to zero length. It is
 * drawn at its true angle regardless — inflating a sliver to a visible minimum is
 * the same lie as rendering a bar longer than its value, and the legend is what
 * carries a number too small to see.
 */
export function arcPath(
  cx: number,
  cy: number,
  rMid: number,
  t0: number,
  t1: number,
): string | null | 'circle' {
  const sweep = t1 - t0;
  if (!(sweep > 0)) return null;
  if (sweep >= 1 - 1e-9) return 'circle';

  const [x0, y0] = polar(cx, cy, rMid, t0);
  const [x1, y1] = polar(cx, cy, rMid, t1);
  const large = sweep > 0.5 ? 1 : 0;
  const f = (n: number): string => n.toFixed(3);
  return `M ${f(x0)} ${f(y0)} A ${f(rMid)} ${f(rMid)} 0 ${large} 1 ${f(x1)} ${f(y1)}`;
}
