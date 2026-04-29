import pino from 'pino';
import { serializeError } from '@crm/shared';

let _logger: pino.Logger | null = null;

function getLogger(): pino.Logger {
  if (!_logger) {
    const { getEnv } = require('../env');
    const env = getEnv();
    _logger = pino({
      level: env.LOG_LEVEL,
      serializers: {
        err: serializeError,
        error: serializeError,
      },
      transport:
        env.NODE_ENV === 'development'
          ? {
              target: 'pino-pretty',
              options: {
                colorize: true,
                translateTime: 'HH:MM:ss Z',
                ignore: 'pid,hostname',
              },
            }
          : undefined,
    });
  }
  return _logger;
}

export const logger: pino.Logger = new Proxy({} as pino.Logger, {
  get(_target, prop) {
    return (getLogger() as unknown as Record<string | symbol, unknown>)[prop];
  },
});
