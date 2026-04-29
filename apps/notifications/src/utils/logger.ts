import pino from 'pino';

// Logger is created lazily to ensure env vars are loaded (dotenv) before reading them.
let _logger: pino.Logger | null = null;

// Custom error serializer that surfaces postgres-js / Drizzle error details
// (code, detail, hint, table, column, etc.) so DB errors aren't reduced to
// just "Failed query: …" in production logs.
function serializeError(err: unknown): Record<string, unknown> {
  if (!err || typeof err !== 'object') return { message: String(err) };
  const e = err as Record<string, unknown> & { cause?: unknown };
  const out: Record<string, unknown> = {
    type: e.constructor?.name,
    message: e.message,
    stack: e.stack,
  };
  for (const key of ['code', 'detail', 'hint', 'table', 'column', 'constraint', 'schema', 'where', 'routine', 'severity']) {
    if (e[key] !== undefined) out[key] = e[key];
  }
  if (e.cause) out.cause = serializeError(e.cause);
  return out;
}

export function getLogger(): pino.Logger {
  if (!_logger) {
    const { getEnv } = require('../env');
    const env = getEnv();
    _logger = pino({
      level: env.LOG_LEVEL,
      serializers: { err: serializeError, error: serializeError },
      transport: env.NODE_ENV === 'development' ? {
        target: 'pino-pretty',
        options: {
          colorize: true,
        },
      } : undefined,
    });
  }
  return _logger;
}

// Proxy object that lazily initializes the real logger on first use
export const logger: pino.Logger = new Proxy({} as pino.Logger, {
  get(_target, prop) {
    return (getLogger() as unknown as Record<string | symbol, unknown>)[prop];
  },
});
