/**
 * DOM tests for the protected-label guard.
 *
 * The first version of this guard shipped untested against Gmail's real markup,
 * matched nothing, and let a user archive a thread by clicking an "x" they'd
 * been told was disabled. These tests exist so that failure mode is loud.
 *
 * The extension has no vitest setup, so this runs standalone against linkedom:
 *
 *   cd apps/chrome-extension && bun lib/label-guard.domtest.ts
 *
 * Gmail's true chip markup is unknown (obfuscated, unversioned), so the
 * fixtures cover several plausible shapes rather than one guessed structure —
 * name-in-attribute vs no attributes, <img> x vs bare <div> x. What all real
 * shapes share is the chip's visible text, which is what the guard keys on.
 */

/** linkedom is a transitive dep; prefer the bare specifier, fall back to the store. */
async function loadParseHTML(): Promise<(html: string) => { window: any; document: any }> {
  try {
    return (await import('linkedom')).parseHTML;
  } catch {
    const mod = await import(
      '../../../node_modules/.pnpm/linkedom@0.18.12/node_modules/linkedom/esm/index.js'
    );
    return mod.parseHTML;
  }
}

const FIXTURE = `<body>
  <div role="navigation"><a href="#inbox"><span>Inbox</span><span class="count"></span></a></div>
  <div id="thread">
    <div class="Hp"><h2 class="hP">US New joiners / Sandeep</h2></div>
    <div class="chips">
      <!-- shape A: label name in data-tooltip, x is an <img> -->
      <div class="c1 ar" data-tooltip="Inbox"><div class="at"><div class="av">Inbox</div><img class="p3" jsaction="remove"></div></div>
      <!-- shape B: no identifying attributes at all, x is an empty <div> -->
      <div class="c2 ar"><div class="at"><div class="av">InboxPulse/Churn risk</div><div class="p3"></div></div></div>
      <!-- shape C: an unprotected label, which must keep its x -->
      <div class="c3 ar"><div class="at"><div class="av">External</div><div class="p3"></div></div></div>
    </div>
  </div>
</body>`;

let failures = 0;

function check(what: string, got: unknown, want: unknown): void {
  const ok = got === want;
  if (!ok) failures++;
  console.log(ok ? 'ok  ' : 'FAIL', what.padEnd(26), String(got).padEnd(8), `(want ${String(want)})`);
}

async function main(): Promise<void> {
  const parseHTML = await loadParseHTML();
  const { window, document } = parseHTML(`<!doctype html><html>${FIXTURE}</html>`);
  const g = globalThis as Record<string, unknown>;
  g.document = document;
  g.window = window;
  g.Element = window.Element;

  const { guardLabelChips, installLabelClickGuard, isProtectedLabel } = await import('./label-guard');

  console.log('\n── isProtectedLabel ──');
  for (const [name, want] of [
    ['Inbox', true],
    ['inbox', true],
    ['InboxPulse/Churn risk', true],
    ['External', false],
    ['My Inbox stuff', false],
    ['Inbox archive', false],
    ['Team/Inbox', false],
    ['InboxPulseOther', false],
  ] as Array<[string, boolean]>) {
    check(JSON.stringify(name), isProtectedLabel(name), want);
  }

  console.log('\n── layer 1: hide the x ──');
  guardLabelChips('US New joiners / Sandeep', true);
  const shown = (sel: string): string => {
    const el = document.querySelector(sel);
    return el?.style?.display === 'none' ? 'HIDDEN' : 'visible';
  };
  check('Inbox x (img)', shown('.c1 img.p3'), 'HIDDEN');
  check('InboxPulse x (div)', shown('.c2 .p3'), 'HIDDEN');
  check('External x (untouched)', shown('.c3 .p3'), 'visible');
  check('nav empty badge', shown('[role=navigation] .count'), 'visible');
  check('Inbox chip text', shown('.c1 .av'), 'visible');
  check('InboxPulse chip text', shown('.c2 .av'), 'visible');

  console.log('\n── layer 2: block the click ──');
  installLabelClickGuard();
  // Stand-in for Gmail's own handler: anything reaching it performs the removal.
  let reached: string | null = null;
  document.addEventListener('click', (e: { target?: { className?: string } }) => {
    reached = String(e.target?.className ?? '?');
  });
  const blocked = (sel: string): boolean => {
    reached = null;
    document.querySelector(sel)!.dispatchEvent(
      new window.Event('click', { bubbles: true, cancelable: true })
    );
    return reached === null;
  };
  check('x on Inbox chip', blocked('.c1 img.p3'), true);
  check('x on InboxPulse chip', blocked('.c2 .p3'), true);
  check('x on External chip', blocked('.c3 .p3'), false);
  check('Inbox chip text', blocked('.c1 .av'), false);
  check('InboxPulse chip text', blocked('.c2 .av'), false);
  check('nav Inbox link', blocked('[role=navigation] a span'), false);
  check('nav empty badge', blocked('[role=navigation] .count'), false);

  console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
