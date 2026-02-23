import pino from 'pino';

let _logger: pino.Logger | null = null;

function getLogger(): pino.Logger {
  if (!_logger) {
    const { getEnv } = require('../env');
    const env = getEnv();
    _logger = pino({
      level: env.LOG_LEVEL,
      formatters: {
        level: (label: string) => {
          return { level: label.toUpperCase() };
        },
      },
      serializers: {
        error: pino.stdSerializers.err,
      },
      base: {
        service: 'gmail-sync',
        env: env.NODE_ENV,
      },
    });
  }
  return _logger;
}

export const logger: pino.Logger = new Proxy({} as pino.Logger, {
  get(_target, prop) {
    return (getLogger() as unknown as Record<string | symbol, unknown>)[prop];
  },
});
