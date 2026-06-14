import 'reflect-metadata';
import dotenv from 'dotenv';
import { resolve } from 'path';

// Load environment variables with .env.local taking precedence
dotenv.config({ path: resolve(process.cwd(), '.env.local') });
dotenv.config({ path: resolve(process.cwd(), '.env') });

// Validate environment variables via Zod schema (exits on failure)
import { getEnv } from './env';
const env = getEnv();

import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger as honoLogger } from 'hono/logger';
import { logger } from './utils/logger';
import { toStructuredError, sanitizeErrorForClient } from '@crm/shared';
import type { ApiResponse } from '@crm/shared';

// Routes
import analysisRoutes from './routes/analysis';

const app = new Hono();

// Global error handler
app.onError((error, c) => {
  const structuredError = toStructuredError(error);

  if (structuredError.statusCode >= 500) {
    logger.error(
      { error: structuredError, path: c.req.path, method: c.req.method },
      `Server error occurred: ${structuredError.message}`
    );
  } else {
    logger.warn(
      { error: structuredError, path: c.req.path, method: c.req.method },
      `Client error occurred: ${structuredError.message}`
    );
  }

  const sanitizedError = sanitizeErrorForClient(structuredError);
  const response: ApiResponse<never> = { success: false, error: sanitizedError };
  return c.json(response, sanitizedError.statusCode as any);
});

// Middleware
app.use('*', honoLogger());
app.use('*', cors());

// Health check
app.get('/health', (c) => {
  return c.json({
    status: 'ok',
    service: 'analysis',
    timestamp: new Date().toISOString(),
  });
});

// API Routes
app.route('/api/analysis', analysisRoutes);
logger.info('Routes registered successfully');

const port = env.PORT;

logger.info({ port, env: env.NODE_ENV }, 'Analysis service starting');

try {
  serve({
    fetch: app.fetch,
    port,
  });
  logger.info({ port }, 'Server listening successfully');
} catch (error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;
  logger.error({ error: message, stack, port }, 'Failed to start server');
  process.exit(1);
}
