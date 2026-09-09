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
