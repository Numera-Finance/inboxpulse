import pino from 'pino';

// Read straight from process.env (not getEnv) to avoid import-order coupling
// with dotenv; defaults are harmless if this loads before env is populated.
const isDev = (process.env.NODE_ENV ?? 'development') !== 'production';

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  ...(isDev ? { transport: { target: 'pino-pretty', options: { colorize: true } } } : {}),
});
