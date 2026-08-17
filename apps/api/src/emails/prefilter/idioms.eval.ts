/**
 * Score the idiom lexicon against held-out mail.
 *
 *   pnpm --filter @crm/api exec tsx src/emails/prefilter/idioms.eval.ts
 *
 * The lexicon in idioms.ts was written after reading 50 labelled emails, so its
 * numbers on those 50 are fitted, not measured. This runs it against the rest of
 * the test set — mail nobody wrote patterns for — and reports precision, recall,
 * and which idioms actually fire in the wild versus which were imagined.
 *
 * An idiom that never fires is worse than useless: it is a claim about the
 * corpus that the corpus does not support, and it makes the list look more
 * complete than it is.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { findIdioms, IDIOMS } from '@crm/shared';

interface Row {
  id: string;
  subject: string;
  body: string;
  label: 'complaint' | 'not_complaint';
}

/** Same preparation the analysis path uses, so the evaluation is honest. */
function prepare(subject: string, body: string): string {
  let t = `${subject} \n ${body}`;
  t = t.replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, ' ');
  t = t.replace(/<!--[\s\S]*?-->/g, ' ');
  t = t.replace(/<[^>]+>/g, ' ');
  for (const [a, b] of [['&nbsp;', ' '], ['&amp;', '&'], ['&lt;', '<'], ['&gt;', '>'], ['&quot;', '"'], ['&#39;', "'"]] as const) {
    t = t.split(a).join(b);
  }
  t = t.split(/On .{0,200}?\bwrote:|From:\s/)[0];
  return t.replace(/\s+/g, ' ').trim().slice(0, 2500);
}

// Resolved from the working directory, not from `import.meta.url`: this file is
// type-checked by `pnpm lint` under a tsconfig whose `module` setting forbids
// `import.meta`, so using it here fails the build for every package.
// The documented invocation is `pnpm --filter @crm/api exec tsx ...`, which runs
// with apps/api as the cwd.
const scripts = join(process.cwd(), 'scripts');
const dataset = join(scripts, 'sentiment-testset.jsonl');
const rows: Row[] = readFileSync(dataset, 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((l) => JSON.parse(l) as Row);

// The 50 the lexicon was written against, excluded so this is a real test.
// See apps/api/scripts/human-labels.md for how they were produced.
let seen = new Set<string>();
try {
  seen = new Set(Object.keys(JSON.parse(readFileSync(join(scripts, 'human-labels.json'), 'utf8'))));
} catch {
  /* no human labels present — then nothing is excluded and the numbers are optimistic */
}

const held = rows.filter((r) => !seen.has(r.id));
const truth = held.map((r) => r.label === 'complaint');
const texts = held.map((r) => prepare(r.subject, r.body));
const hits = texts.map((t) => findIdioms(t));

const fired = hits.map((h) => h.length > 0);
const tp = fired.filter((f, i) => f && truth[i]).length;
const fp = fired.filter((f, i) => f && !truth[i]).length;
const pos = truth.filter(Boolean).length;

console.log(`held-out: ${held.length} emails (${seen.size} excluded as seen), ${pos} complaints\n`);
console.log(`ANY idiom fires on ${fired.filter(Boolean).length}`);
console.log(`  recall    ${((100 * tp) / pos).toFixed(0)}%`);
console.log(`  precision ${((100 * tp) / Math.max(tp + fp, 1)).toFixed(0)}%`);
console.log(`  base rate ${((100 * pos) / held.length).toFixed(0)}%\n`);

console.log('per idiom — fires / of which complaints / lift:');
const base = pos / held.length;
for (const idiom of IDIOMS) {
  const on = texts.map((t) => idiom.pattern.test(t));
  const n = on.filter(Boolean).length;
  if (n === 0) {
    console.log(`  ${idiom.id.padEnd(20)} never fires  <- unsupported by the corpus`);
    continue;
  }
  const c = on.filter((o, i) => o && truth[i]).length;
  const rate = c / n;
  console.log(
    `  ${idiom.id.padEnd(20)}${String(n).padStart(5)}${`${(100 * rate).toFixed(0)}%`.padStart(7)}${`${(rate / base).toFixed(1)}x`.padStart(8)}`
  );
}
