import pino from 'pino';

// Logger is created lazily to ensure env vars are loaded (dotenv) before reading them.
let _logger: pino.Logger | null = null;

function getLogger(): pino.Logger {
  if (!_logger) {
    const { getEnv } = require('../env') as typeof import('../env');
    const env = getEnv();
    _logger = pino({
      level: env.LOG_LEVEL,
      formatters: {
        level: (label) => {
          return { level: label.toUpperCase() };
        },
      },
      serializers: {
        error: pino.stdSerializers.err,
      },
      base: {
        service: 'crm-api',
        env: env.NODE_ENV,
      },
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
