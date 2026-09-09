import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The list query and the count query filter separately, in two places about a
 * hundred lines apart. A filter added to one and not the other produces a list
 * of rows under a total that disagrees with it, and nothing errors.
 *
 * Derived from the source rather than enumerated, so a filter added later is
 * covered without anyone remembering this file.
 */
describe('every signal filter exists in both the list and the count path', () => {
  const src = readFileSync(join(__dirname, 'repository.ts'), 'utf8');

  const values = (varName: string) =>
    new Set(
      [...src.matchAll(new RegExp(`${varName}\\?\\.signal === '([a-z-]+)'`, 'g'))].map((m) => m[1]),
    );

  it('finds both paths', () => {
    expect(values('options').size).toBeGreaterThan(0);
    expect(values('filters').size).toBeGreaterThan(0);
  });

  it('they handle the same set', () => {
    const list = [...values('options')].sort();
    const count = [...values('filters')].sort();
    expect(count, `list handles ${list}, count handles ${count}`).toEqual(list);
  });

  it('includes capital-event, which the panel row links to', () => {
    expect(values('options').has('capital-event')).toBe(true);
  });
});
