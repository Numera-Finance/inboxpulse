import { describe, it, expect } from 'vitest';
import { affectedRows } from './affected-rows';

describe('affectedRows', () => {
  it('reads postgres.js results, where the count lives on `count`', () => {
    // What `db.execute(sql`UPDATE ...`)` actually resolves to on this project's
    // driver: an array (no rows, since there is no RETURNING) carrying `count`.
    const result = Object.assign([], { count: 3 });
    expect(affectedRows(result)).toBe(3);
  });

  it('reads node-postgres results, where the count lives on `rowCount`', () => {
    expect(affectedRows({ rows: [], rowCount: 5 })).toBe(5);
  });

  it('distinguishes "matched nothing" from "could not tell"', () => {
    expect(affectedRows(Object.assign([], { count: 0 }))).toBe(0);
    expect(affectedRows({ rowCount: 0 })).toBe(0);
  });

  it('prefers count when a result somehow carries both', () => {
    expect(affectedRows({ count: 7, rowCount: 0 })).toBe(7);
  });

  it('falls back to 0 for shapes that report neither', () => {
    expect(affectedRows([])).toBe(0);
    expect(affectedRows({})).toBe(0);
    expect(affectedRows(null)).toBe(0);
    expect(affectedRows(undefined)).toBe(0);
  });

  it('ignores non-numeric count/rowCount rather than coercing them', () => {
    // postgres.js exposes other array members; guard against reading a string
    // or a function and returning NaN-ish nonsense.
    expect(affectedRows({ count: '4' })).toBe(0);
    expect(affectedRows({ count: () => 4 })).toBe(0);
    expect(affectedRows({ count: '4', rowCount: 4 })).toBe(4);
  });
});
