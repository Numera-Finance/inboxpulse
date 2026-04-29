/**
 * Pino-compatible error serializer.
 *
 * Surfaces postgres-js / Drizzle / generic Error fields so structured logs
 * carry the actual diagnostic detail (code, detail, hint, table, column,
 * etc.) instead of just `error.message`. Walks the `cause` chain so wrapped
 * errors don't lose their root cause.
 */
export function serializeError(err: unknown): Record<string, unknown> {
  if (!err || typeof err !== 'object') return { message: String(err) };
  const e = err as Record<string, unknown> & { cause?: unknown; constructor?: { name?: string } };
  const out: Record<string, unknown> = {
    type: e.constructor?.name,
    message: e.message,
    stack: e.stack,
  };
  for (const key of [
    'code',
    'detail',
    'hint',
    'table',
    'column',
    'constraint',
    'schema',
    'where',
    'routine',
    'severity',
    'statusCode',
  ]) {
    if (e[key] !== undefined) out[key] = e[key];
  }
  if (e.cause) out.cause = serializeError(e.cause);
  return out;
}
