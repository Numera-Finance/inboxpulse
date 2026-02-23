import pino from 'pino';

// Logger is created lazily to ensure env vars are loaded (dotenv) before reading them.
let _logger: pino.Logger | null = null;

export function getLogger(): pino.Logger {
  if (!_logger) {
    const { getEnv } = require('../env');
    const env = getEnv();
    _logger = pino({
      level: env.LOG_LEVEL,
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
