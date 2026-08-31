/**
 * Checks the Panel tab against the add-on's REAL output, not a fixture.
 *
 * Two properties, both of which fail silently in production if they break:
 *
 *  1. NO CARD LINK REACHES THE WEB CONSOLE. This build reads a clone; a "See
 *     them" that opened the real console would put production data one click
 *     from a panel whose whole premise is that it is not production. The check
 *     enumerates every link the live card actually contains and classifies each
 *     one, so a NEW link added to a card next month is policed without anyone
 *     remembering this file exists — the same reasoning as the consent-gate test
 *     deriving its list from live-analysis.ts's exports.
 *
 *  2. THE TWO ENTITLEMENT-SCOPED SECTIONS ARE PRESENT. "Where the fires are"
 *     and "Unhappy clients left waiting" are skipped entirely when the add-on
 *     cannot identify the viewer, and — because a skipped lookup is not a failed
 *     one — they vanish without any "could not scope this" row. The panel then
 *     shows firm-wide numbers beside two absences and reads as calm. Asserting
 *     they are THERE is the only way that regression is visible.
 *
 * Needs the API (:4001, clone) and the add-on (:4005) running.
 *
 *   cd apps/chrome-extension && bun lib/card-links.domtest.ts
 *   VIEWER=someone@else.com bun lib/card-links.domtest.ts
 */

import { cardSections, type CardSection, type CardWidget } from './addon-client';
import {
  bandFrom,
  isGmailLink,
  isHeadingParagraph,
  sanitizeCardHtml,
} from '../components/CardRenderer';

const ADDON_URL = process.env.ADDON_URL ?? 'http://localhost:4005';
const VIEWER = process.env.VIEWER ?? 'npradhan@mystartupcfo.com';

let failures = 0;
function check(ok: boolean, label: string, detail = ''): void {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
}

async function card(path: string, body: Record<string, unknown>): Promise<CardSection[]> {
  const res = await fetch(`${ADDON_URL}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...body, devViewerEmail: VIEWER }),
  });
  if (!res.ok) throw new Error(`${path} returned ${res.status}`);
  return cardSections(await res.json());
}

/** Every openLink URL a widget can carry: row-level, accessory, and button list. */
function linksIn(w: CardWidget): string[] {
  const out: string[] = [];
  const d = w.decoratedText;
  if (d?.onClick?.openLink?.url) out.push(d.onClick.openLink.url);
  if (d?.button?.onClick?.openLink?.url) out.push(d.button.onClick.openLink.url);
  for (const b of w.buttonList?.buttons ?? []) {
    if (b.onClick?.openLink?.url) out.push(b.onClick.openLink.url);
  }
  return out;
}

/** Add-on action URLs, which stay live — they call the local QA service. */
function actionsIn(w: CardWidget): string[] {
  const out: string[] = [];
  const d = w.decoratedText;
  if (d?.onClick?.action?.function) out.push(d.onClick.action.function);
  if (d?.button?.onClick?.action?.function) out.push(d.button.onClick.action.function);
  for (const b of w.buttonList?.buttons ?? []) {
    if (b.onClick?.action?.function) out.push(b.onClick.action.function);
  }
  return out;
}

/** Every string on the card that reaches the renderer as markup. */
function textsIn(sections: CardSection[]): string[] {
  const out: string[] = [];
  const visit = (o: unknown): void => {
    if (!o || typeof o !== 'object') return;
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
      if (typeof v === 'string') {
        if (['text', 'topLabel', 'bottomLabel', 'header'].includes(k)) out.push(v);
      } else {
        visit(v);
      }
    }
  };
  visit(sections);
  return out;
}

function headings(sections: CardSection[]): string[] {
  const out: string[] = [];
  for (const s of sections) {
    if (s.header) out.push(s.header.replace(/<[^>]+>/g, '').trim());
    for (const w of s.widgets ?? []) {
      const t = w.textParagraph?.text;
      if (t && isHeadingParagraph(t)) out.push(t.replace(/<[^>]+>/g, '').trim());
    }
  }
  return out;
}

const sections = await card('/homepage', {});
const widgets = sections.flatMap((s) => s.widgets ?? []);

console.log(`\nhomepage: ${sections.length} sections, ${widgets.length} widgets, viewer ${VIEWER}\n`);

// ---- 1. the sections that disappear when the viewer cannot be resolved ------
const found = headings(sections);
console.log('headings:', found.join(' | '), '\n');
for (const required of ['Where the fires are', 'Unhappy clients left waiting']) {
  check(
    found.includes(required),
    `"${required}" is rendered`,
    found.includes(required) ? '' : 'viewer did not resolve — check /api/internal/addon/viewer',
  );
}

// ---- 2. no link escapes to the console -------------------------------------
const links = widgets.flatMap(linksIn);
const escaping = links.filter((u) => isGmailLink(u));
const intercepted = links.filter((u) => !isGmailLink(u));

console.log();
check(links.length > 0, 'the card contains links at all', `${links.length} found`);
check(
  escaping.every((u) => u.startsWith('https://mail.google.com/')),
  'every link treated as safe is a Gmail deep link',
  escaping.length ? escaping.join(', ') : 'none',
);
for (const u of [...new Set(intercepted)]) {
  const host = (() => {
    try {
      return new URL(u).host;
    } catch {
      return '(unparseable)';
    }
  })();
  check(!isGmailLink(u), `intercepted → QA page: ${host}`, u.slice(0, 72));
}

// The hardcoded one CLAUDE.md warns about: homepage.ts:880 bypasses WEB_URL, so
// redirecting WEB_URL alone would NOT have caught it.
const hardcoded = links.filter((u) => u.includes('emailsentiment.mystartupcfo.com'));
check(
  hardcoded.length > 0 && hardcoded.every((u) => !isGmailLink(u)),
  'the hardcoded production dashboard link is intercepted',
  hardcoded[0] ?? 'not present in this card',
);

// ---- 3. action buttons still reach the local add-on -------------------------
const actions = [...new Set(widgets.flatMap(actionsIn))];
console.log();
check(
  actions.length > 0 && actions.every((u) => u.startsWith(ADDON_URL)),
  'every action button targets the local add-on',
  `${actions.length}: ${actions.map((a) => a.replace(ADDON_URL, '')).join(', ')}`,
);

// ---- 4. the colour band renders without a network fetch --------------------
const images = widgets.map((w) => w.image?.imageUrl).filter((u): u is string => Boolean(u));
console.log();
check(images.length > 0, 'the card carries the colour band', `${images.length} image widget(s)`);
for (const u of images) {
  const band = bandFrom(u);
  check(band !== null, `band parsed, no <img> needed: ${band?.color} @ ${band?.height}px`, u);
}

// ---- 5. markup is rendered, not printed ------------------------------------
//
// Everything above tests STRUCTURE — links, bands, which sections exist. None of
// it renders the text and looks at it, which is exactly how a sanitizer bug
// shipped that printed `<font color="#c5221f">` as visible characters on a third
// of the card while every structural check stayed green.
//
// Derived from the live card, not a fixture: whatever markup the add-on emits
// today is what gets checked, so a tag introduced next month is policed without
// anyone remembering this file exists.
console.log();
const texts = textsIn(sections);
const printed = texts.filter((t) => sanitizeCardHtml(t).includes('&lt;'));
check(
  printed.length === 0,
  'no card markup renders as literal text',
  printed.length ? `${printed.length}/${texts.length}: ${sanitizeCardHtml(printed[0]).slice(0, 90)}` : `${texts.length} strings clean`,
);

// A tag that is DROPPED rather than printed is the quieter failure: the words
// survive, only the colour disappears, and the row still reads plausibly.
const countTags = (s: string, re: RegExp): number => (s.match(re) ?? []).length;
const srcFonts = texts.reduce((n, t) => n + countTags(t, /<font color="#[0-9a-fA-F]{3,6}">/g), 0);
const outFonts = texts.reduce(
  (n, t) => n + countTags(sanitizeCardHtml(t), /<font color="#[0-9a-fA-F]{3,6}">/g),
  0,
);
check(srcFonts > 0, 'the card uses colour at all', `${srcFonts} <font> tags`);
check(outFonts === srcFonts, 'every colour survives sanitising', `${outFonts} of ${srcFonts}`);

const srcBold = texts.reduce((n, t) => n + countTags(t, /<b>/g), 0);
const outBold = texts.reduce((n, t) => n + countTags(sanitizeCardHtml(t), /<b>/g), 0);
check(outBold === srcBold, 'every bold run survives sanitising', `${outBold} of ${srcBold}`);

// The whitelist still holds: nothing outside <b> <i> <u> <br> <font color=#hex>
// may come out as a real element, whatever the card (or a customer name) says.
const escapes = ['<script>x</script>', '<img src=x onerror=alert(1)>', '<a href="http://evil">x</a>'];
for (const bad of escapes) {
  const out = sanitizeCardHtml(`Acme ${bad} Ltd`);
  const real = [...out.matchAll(/<[^>]*>/g)].map((m) => m[0]);
  const leaked = real.filter(
    (t) => !/^<\/?(b|i|u|br)>$/.test(t) && !/^<font color="#[0-9a-fA-F]{3,6}">$/.test(t) && t !== '</font>',
  );
  check(leaked.length === 0, `stays inert: ${bad}`, leaked.join(' ') || 'fully escaped');
}

console.log(`\n${failures === 0 ? 'PASS' : `FAIL (${failures})`}\n`);
process.exit(failures === 0 ? 0 : 1);
