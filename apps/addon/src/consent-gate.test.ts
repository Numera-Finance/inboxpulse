import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Regression: the consent gate was in the right handler at the wrong place.
 *
 * `/gmail/analyse` computed `mayRead = await hasConsent(...)` and guarded the
 * deep read with it — but `classifyThreadMode`, which sends the same thread text
 * to the same model, ran twenty-two lines ABOVE that line. So a viewer who had
 * never turned reading on still had their mail read, while the panel truthfully
 * displayed "Your mail is not being read", and three other endpoints
 * (`/gmail/stance`, `/gmail/triage`, and the contextual live path) had no gate
 * at all.
 *
 * Nothing caught it, and nothing could have: every unit test passed, the card
 * rendered correctly, and the only visible trace was a model call in a log.
 *
 * So the test asserts the property directly, on the source text: inside any
 * request handler, a call to a model must not appear before the consent check.
 * ORDER is the whole point — the bug was a gate that existed and sat too low.
 *
 * The list of model functions is derived from `live-analysis.ts` rather than
 * written out here, so a newly added one is covered the day it is added rather
 * than the day someone remembers this file.
 *
 * What this cannot check: that the consent value is actually USED to guard the
 * call rather than merely computed above it. That much still needs review.
 */
describe('no consent, no read', () => {
  const src = readFileSync(join(__dirname, 'index.ts'), 'utf8');
  const liveAnalysis = readFileSync(join(__dirname, 'services', 'live-analysis.ts'), 'utf8');

  /** Every async export of live-analysis sends text to a model. The sync ones parse. */
  const modelFns = [...liveAnalysis.matchAll(/^export async function (\w+)/gm)].map((m) => m[1]);

  /** Each handler, as a [name, body] pair, sliced at the next route registration. */
  const handlers = (): Array<[string, string]> => {
    const starts = [...src.matchAll(/app\.(?:get|post)\('([^']+)'/g)];
    return starts.map((m, i) => [
      m[1],
      src.slice(m.index ?? 0, starts[i + 1]?.index ?? src.length),
    ]);
  };

  it('finds the model functions it means to police', () => {
    expect(modelFns).toContain('classifyThreadMode');
    expect(modelFns).toContain('analyseMessageLive');
    expect(modelFns).toContain('draftForStance');
    expect(modelFns.length).toBeGreaterThanOrEqual(5);
  });

  it('never calls a model above the consent check in the same handler', () => {
    const offenders: string[] = [];

    for (const [route, body] of handlers()) {
      const calls = modelFns
        .flatMap((fn) => [...body.matchAll(new RegExp(`\\b${fn}\\(`, 'g'))].map((m) => ({ fn, at: m.index ?? 0 })))
        .sort((a, b) => a.at - b.at);
      if (!calls.length) continue;

      // `hasConsent(` is the check; `mayRead` is the name it is bound to, and a
      // handler may guard on either.
      const gate = [...body.matchAll(/hasConsent\(|\bmayRead\b/g)]
        .map((m) => m.index ?? Infinity)
        .sort((a, b) => a - b)[0];

      if (gate === undefined) {
        offenders.push(`${route} calls ${calls.map((c) => c.fn).join(', ')} with no consent check at all`);
        continue;
      }
      for (const c of calls) {
        if (c.at < gate) offenders.push(`${route} calls ${c.fn} before its consent check`);
      }
    }

    expect(offenders, offenders.join('\n')).toEqual([]);
  });
});
