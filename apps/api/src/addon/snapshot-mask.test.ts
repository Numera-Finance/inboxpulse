import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import { PanelSnapshotService } from './snapshot-service';

/**
 * The entitlement mask is the only thing standing between a precomputed
 * tenant-wide superset and a viewer entitled to part of it.
 *
 * Before precomputing, scoping lived in SQL — `customer_id IN (SELECT ... FROM
 * user_accessible_customers)` — and a viewer physically could not receive a row
 * they were not entitled to. Now the expensive query runs unmasked and the mask
 * is applied in TypeScript, so these assertions carry weight the database used
 * to carry.
 *
 * The dangerous case is the empty set. `null` means admin, "no mask"; an empty
 * Set means "entitled to nothing". A single wrong falsy check collapses the
 * second into the first and shows every customer in the tenant to someone
 * entitled to none of them.
 */
describe('the entitlement mask on a precomputed superset', () => {
  // Only the field the mask reads; the rest of the row is irrelevant to it.
  const rows = [
    { customerId: 'a', customer: 'Alpha' },
    { customerId: 'b', customer: 'Beta' },
    { customerId: null, customer: 'Unattributed' },
    { customerId: 'c', customer: 'Gamma' },
  ];
  // The mask is pure; it needs no database.
  const svc = new PanelSnapshotService({} as never);

  it('gives an admin the whole superset, capped', () => {
    expect(svc.maskAndLimit(rows, null, 10).map((r) => r.customer)).toEqual([
      'Alpha', 'Beta', 'Unattributed', 'Gamma',
    ]);
    expect(svc.maskAndLimit(rows, null, 2).map((r) => r.customer)).toEqual(['Alpha', 'Beta']);
  });

  it('gives a scoped viewer only their customers', () => {
    const out = svc.maskAndLimit(rows, new Set(['a', 'c']), 10);
    expect(out.map((r) => r.customer)).toEqual(['Alpha', 'Gamma']);
  });

  it('gives a viewer entitled to nothing NOTHING, not everything', () => {
    expect(svc.maskAndLimit(rows, new Set<string>(), 10)).toEqual([]);
  });

  it('withholds unattributed rows from a scoped viewer, as SQL IN does with NULL', () => {
    const out = svc.maskAndLimit(rows, new Set(['a', 'b']), 10);
    expect(out.some((r) => r.customerId === null)).toBe(false);
  });

  it('preserves superset order, so the mask cannot reorder what survives it', () => {
    const out = svc.maskAndLimit(rows, new Set(['c', 'a']), 10);
    expect(out.map((r) => r.customerId)).toEqual(['a', 'c']);
  });

  it('applies the limit after the mask, not before', () => {
    // 'a' and 'c' straddle rows the viewer cannot see. Limiting first would
    // return one row; masking first returns both.
    expect(svc.maskAndLimit(rows, new Set(['a', 'c']), 2)).toHaveLength(2);
  });
});
