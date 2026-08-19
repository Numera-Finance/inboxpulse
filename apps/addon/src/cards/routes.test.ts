import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Regression: two buttons pointed at `/gmail/analyse`'s old name, `/gmail/read`,
 * which the server never served. Google called it and Gmail showed
 * "Error with the add-on. Run time error. status code: 404".
 *
 * Nothing caught it — the card renders fine, the URL is only a string, and the
 * failure appears in Gmail rather than in any test or log. So the test asserts
 * the seam directly: every action URL a card generates must correspond to a
 * route the server registers.
 */
describe('card action URLs', () => {
  const src = (f: string) => readFileSync(join(__dirname, f), 'utf8');

  it('only points at routes the server actually serves', () => {
    const server = readFileSync(join(__dirname, '..', 'index.ts'), 'utf8');
    const served = new Set(
      [...server.matchAll(/app\.(?:get|post)\('([^']+)'/g)].map((m) => m[1]),
    );

    const cards = ['thread.ts', 'flagged-detail.ts', 'widgets.ts'];
    const referenced = new Set<string>();
    for (const f of cards) {
      let text = '';
      try {
        text = src(f);
      } catch {
        continue;
      }
      for (const m of text.matchAll(/\$\{[\w.?\s]*baseUrl[\w.?\s]*\}(\/[a-z/]+)/g)) {
        referenced.add(m[1]);
      }
    }

    expect(referenced.size).toBeGreaterThan(0);
    for (const path of referenced) {
      expect(served, `card links to ${path}, which the server does not serve`).toContain(path);
    }
  });
});
