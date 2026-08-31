/**
 * The donut's geometry, checked as numbers rather than by eye.
 *
 * A ring fails differently from a bar chart. A bar that is drawn wrong is visibly
 * wrong — you can hold a ruler to it. An arc drawn with the wrong large-arc flag
 * is a perfectly clean shape enclosing the wrong region, and one drawn with
 * accumulated float error has a hairline seam that reads as a fifth category. Both
 * render, both look like charts, and neither throws.
 *
 * Needs no service: everything here is pure. That is the point of keeping the
 * maths out of the component.
 *
 *   cd apps/chrome-extension && bun lib/donut-arc.domtest.ts
 */

import { SEVERITY_RAMP, boundaries, arcPath, polar } from './donut-arc';
import { SEVERITY_RAMP as ADDON_RAMP } from '../../addon/src/cards/chart';

let failures = 0;
function check(ok: boolean, label: string, detail = ''): void {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
}

/** The `large-arc-flag` out of a path, which is the 4th number after the `A`. */
function largeArcOf(d: string): number | null {
  const m = d.match(/A [\d.-]+ [\d.-]+ 0 ([01]) [01]/);
  return m ? Number(m[1]) : null;
}

/* ---- the two ramps are one ramp ----------------------------------------- */

check(
  JSON.stringify([...SEVERITY_RAMP]) === JSON.stringify([...ADDON_RAMP]),
  'the extension ramp and the add-on ramp are identical',
  `${SEVERITY_RAMP.join(',')} vs ${ADDON_RAMP.join(',')}`,
);

/* ---- boundaries tile exactly -------------------------------------------- */

{
  // Thirds are the case that exposes accumulation: 1/3 has no exact binary
  // representation, so `t += 1/3` three times lands short of 1 and leaves a gap
  // at 12 o'clock.
  const b = boundaries([1, 1, 1]);
  check(b[b.length - 1][1] === 1, 'the last slice ends at exactly 1', String(b[2][1]));
  check(
    b[0][1] === b[1][0] && b[1][1] === b[2][0],
    'slices tile with no gap and no overlap',
    JSON.stringify(b),
  );
}

{
  // The add-on rounds each share to one decimal, so four slices routinely sum to
  // 99.9 rather than 100. The ring must still close.
  const b = boundaries([60.5, 24.3, 10.1, 5.0]);
  check(b[3][1] === 1, 'a ring closes even when the shares sum to 99.9', String(b[3][1]));
  check(
    Math.abs(b[0][1] - 0.6056) < 0.001,
    'a slice spans its share of the TOTAL, not of 100',
    String(b[0][1]),
  );
}

/* ---- proportionality, and no inflation ---------------------------------- */

{
  const a = boundaries([25, 25, 25, 25]);
  check(
    Math.abs(a[0][1] - a[0][0] - 0.25) < 1e-9,
    'a quarter spans a quarter turn',
    String(a[0][1] - a[0][0]),
  );

  const sliver = boundaries([99.7, 0.3]);
  const span = sliver[1][1] - sliver[1][0];
  check(
    Math.abs(span - 0.003) < 1e-6,
    'a 0.3% slice is drawn at 0.3%, never widened to a visible minimum',
    String(span),
  );
}

/* ---- the three edge cases ----------------------------------------------- */

check(arcPath(64, 64, 45, 0.5, 0.5) === null, 'a zero-width slice draws nothing');
check(arcPath(64, 64, 45, 0.2, 0.1) === null, 'a negative sweep draws nothing');
check(
  arcPath(64, 64, 45, 0, 1) === 'circle',
  'a slice holding the whole ring asks for a circle, not a degenerate arc',
  String(arcPath(64, 64, 45, 0, 1)),
);

{
  // Were the 'circle' branch removed, this would return a path whose start and
  // end coincide — an `A` command that is a no-op, so the ring would vanish at
  // exactly the moment one category took everything.
  const d = arcPath(64, 64, 45, 0, 0.9999999999);
  check(d === 'circle', 'a slice a hair under the whole ring is still a circle', String(d));
}

/* ---- the large-arc flag -------------------------------------------------- */

{
  const shares = [60.5, 24.3, 10.1, 5.0];
  const flags = boundaries(shares).map(([t0, t1]) => {
    const d = arcPath(64, 64, 45, t0, t1);
    return typeof d === 'string' && d !== 'circle' ? largeArcOf(d) : null;
  });
  // Only the 60.5% slice exceeds half the circle. Hardcoding this flag either way
  // draws one of these four slices as its own complement — the failure that looks
  // like a chart and encloses the wrong region.
  check(
    JSON.stringify(flags) === JSON.stringify([1, 0, 0, 0]),
    'large-arc is set for the slice over half the ring, and only that one',
    JSON.stringify(flags),
  );
}

{
  const just_over = arcPath(64, 64, 45, 0, 0.5001);
  const just_under = arcPath(64, 64, 45, 0, 0.4999);
  check(
    largeArcOf(just_over as string) === 1 && largeArcOf(just_under as string) === 0,
    'the flag flips at exactly half a turn',
  );
}

/* ---- orientation --------------------------------------------------------- */

{
  const [x0, y0] = polar(64, 64, 45, 0);
  const [x1, y1] = polar(64, 64, 45, 0.25);
  check(
    Math.abs(x0 - 64) < 1e-9 && y0 < 64,
    'the first slice starts at 12 o\'clock, where the eye already is',
    `${x0},${y0}`,
  );
  check(
    x1 > 64 && Math.abs(y1 - 64) < 1e-9,
    'a quarter turn lands at 3 o\'clock — clockwise, as a pie is read',
    `${x1},${y1}`,
  );
}

/* ---- coordinate resolution ---------------------------------------------- */

{
  // Integer coordinates would collapse a sub-degree arc to zero length, deleting
  // the slice the floor rules elsewhere exist to keep visible.
  const d = arcPath(64, 64, 45, 0, 0.003) as string;
  // M sx sy A rx ry 0 large sweep ex ey — eleven tokens, and the endpoint is the
  // last two. Miscounting the skips here compares the sweep FLAG to a coordinate,
  // which passes while asserting nothing.
  const [, sx, sy, , , , , , , ex, ey] = d.split(' ');
  check(
    sx !== ex || sy !== ey,
    'a sub-1% arc has distinct endpoints at 3dp',
    `${sx},${sy} -> ${ex},${ey}`,
  );
}

console.log(failures === 0 ? '\nPASS' : `\n${failures} FAILED`);
if (failures > 0) process.exit(1);
