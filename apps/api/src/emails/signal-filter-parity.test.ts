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

/**
 * A THIRD signal path, and the one the AI Analysis page actually calls.
 *
 * `getSignalFilterCondition` is a switch, and its `default` returned null.
 * Null means no condition is pushed, so `capital-event` was a value the switch
 * had never heard of: it did not fail, did not warn, and returned EVERY
 * analyzed email for the customer. The Capital events panel row linked to a
 * page listing AWS invoices and bank credit advices under a filter chip that
 * read "Capital E".
 *
 * The set is read from the Zod enum that defines the filter, so a value added
 * there is policed here without anyone editing this file.
 */
describe('the analyzed-search switch handles every value the API will accept', () => {
  const repo = readFileSync(join(__dirname, 'repository.ts'), 'utf8');
  const types = readFileSync(
    join(__dirname, '../../../../packages/clients/src/email/types.ts'),
    'utf8',
  );

  /** The union as the request schema defines it, not as this test remembers it. */
  const accepted = (): string[] => {
    const line = types.match(/signal:\s*z\.enum\(\[([^\]]+)\]\)/);
    if (!line) throw new Error('could not find the signal enum in email/types.ts');
    return [...line[1].matchAll(/'([a-z-]+)'/g)].map((m) => m[1]);
  };

  /** The `case` labels inside getSignalFilterCondition only. */
  const handled = (): string[] => {
    const start = repo.indexOf('private getSignalFilterCondition');
    expect(start, 'getSignalFilterCondition not found').toBeGreaterThan(-1);
    const body = repo.slice(start, repo.indexOf('\n  }', start));
    return [...body.matchAll(/case '([a-z-]+)':/g)].map((m) => m[1]);
  };

  it('reads a non-empty set from both sides', () => {
    expect(accepted().length).toBeGreaterThan(3);
    expect(handled().length).toBeGreaterThan(3);
  });

  it('handles every accepted value, so none can fall through to no filter', () => {
    const missing = accepted().filter((v) => !handled().includes(v));
    expect(missing, `unhandled by getSignalFilterCondition: ${missing.join(', ')}`).toEqual([]);
  });

  it('does not let default mean "no filter" any more', () => {
    const start = repo.indexOf('private getSignalFilterCondition');
    const body = repo.slice(start, repo.indexOf('\n  }', start));
    expect(body).not.toMatch(/default:\s*\n?\s*return null;/);
    expect(body).toContain('const unhandled: never = signal');
  });
});
