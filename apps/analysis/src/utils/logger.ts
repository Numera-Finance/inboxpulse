import pino from 'pino';
import { serializeError } from '@crm/shared';

let _logger: pino.Logger | null = null;

function getLogger(): pino.Logger {
  if (!_logger) {
    const { getEnv } = require('../env');
    const env = getEnv();
    _logger = pino({
      level: env.LOG_LEVEL,
      formatters: {
        level: (label) => {
          return { level: label.toUpperCase() };
        },
      },
      serializers: {
        err: serializeError,
        error: serializeError,
      },
      base: {
        service: 'crm-analysis',
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
