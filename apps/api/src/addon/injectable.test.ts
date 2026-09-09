import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Regression: `CapitalEventsService` shipped without `@injectable()`.
 *
 * Everything compiled, 906 tests passed, and the service worked when
 * constructed directly with `new` in a script. It only failed where it is
 * actually used: `container.resolve(...)` cannot build a class whose
 * constructor parameters tsyringe has no metadata for, so the endpoint returned
 * a 500 and the panel section rendered as absent.
 *
 * Which is the failure this codebase keeps having in a new costume. A missing
 * decorator is invisible to the compiler, invisible to unit tests that use
 * `new`, and visible only as an empty section in production.
 *
 * So the test is structural, on the source text: every exported service in this
 * folder must carry the decorator. Deriving the list from the file means a
 * service added next month is covered without anyone remembering this test.
 */
describe('every addon service is resolvable through the container', () => {
  const src = readFileSync(join(__dirname, 'account-context.ts'), 'utf8');

  const services = [...src.matchAll(/^export class (\w*Service)\b/gm)].map((m) => ({
    name: m[1],
    at: m.index ?? 0,
  }));

  it('finds the services it means to police', () => {
    expect(services.length).toBeGreaterThanOrEqual(6);
    expect(services.map((s) => s.name)).toContain('CapitalEventsService');
  });

  it('decorates every one with @injectable()', () => {
    const missing = services
      .filter((s) => {
        // The decorator must be the line immediately above the declaration.
        const before = src.slice(Math.max(0, s.at - 200), s.at);
        return !/@injectable\(\)\s*$/.test(before);
      })
      .map((s) => s.name);

    expect(missing, `missing @injectable(): ${missing.join(', ')}`).toEqual([]);
  });
});

/**
 * The Capital events section put Carta in its first row, writing "we are still
 * awaiting the signed term sheet". True, and about whichever client the 409A
 * belonged to, not about Carta. A vendor shown as the client sends the rep to
 * sell to their own tooling supplier.
 */
describe('the capital events section excludes service providers', () => {
  const src = readFileSync(join(__dirname, 'account-context.ts'), 'utf8');
  const section = src.slice(src.indexOf('export class CapitalEventsService'));

  it('filters the sender domain against a vendor list', () => {
    expect(section).toContain('NOT IN (SELECT dom FROM vendor)');
  });

  it('names the vendors that reached production', () => {
    // Carta surfaced in row one; the others are the same class of error caught
    // earlier in the detector.
    for (const dom of ['carta.com', 'etonvs.com', 'dfinsolutions.com', 'suralink.com']) {
      expect(section, `${dom} missing from the vendor list`).toContain(dom);
    }
  });
});

/**
 * Falconx rendered in the Capital events section with three flagged messages,
 * and the row's link opened a page that said "No analyzed emails found". All
 * three had analysis_status != Completed, and /escalations lists analysed mail
 * only. The row was pointing somewhere structurally unable to show it.
 */
describe('the capital events section only surfaces mail its link can render', () => {
  const src = readFileSync(join(__dirname, 'account-context.ts'), 'utf8');
  const section = src.slice(src.indexOf('export class CapitalEventsService'));

  it('requires the email to be analysed', () => {
    expect(section).toContain('e.analysis_status = 3');
  });
});
