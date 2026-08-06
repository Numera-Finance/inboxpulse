/**
 * Read the number of rows affected by a write issued through `db.execute(sql\`...\`)`.
 *
 * The two Postgres drivers spell this differently and neither sets the other's
 * field:
 *   - postgres.js (what this project uses) returns an array-like result whose
 *     affected-row count is `count`, taken from the command tag.
 *   - node-postgres returns `rowCount`.
 *
 * Reading `rowCount` alone therefore yields `undefined` on every write here, and
 * the usual `?? 0` fallback turns that into a silent, plausible-looking zero —
 * the call reports "nothing changed" while the UPDATE or DELETE did its job. Use
 * this helper instead of reaching into the result directly.
 *
 * Note this counts rows the statement *matched and wrote*, not rows returned; for
 * statements with a RETURNING clause, prefer the length of the returned rows.
 */
export function affectedRows(result: unknown): number {
  const r = result as { count?: unknown; rowCount?: unknown } | null | undefined;
  if (typeof r?.count === 'number') {
    return r.count;
  }
  if (typeof r?.rowCount === 'number') {
    return r.rowCount;
  }
  return 0;
}
