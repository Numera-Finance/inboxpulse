import 'reflect-metadata';
import dotenv from 'dotenv';
import { resolve } from 'path';

// Load environment variables with .env.local taking precedence
dotenv.config({ path: resolve(process.cwd(), '.env.local') });
dotenv.config({ path: resolve(process.cwd(), '.env') });

// Validate required environment variables
const requiredEnvVars = [
  'DATABASE_URL',
];

const missingEnvVars = requiredEnvVars.filter((varName) => !process.env[varName]);

if (missingEnvVars.length > 0) {
  console.error(`❌ Missing required environment variables: ${missingEnvVars.join(', ')}`);
  console.error('Please set them in .env.local or .env file');
  process.exit(1);
}

import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger as honoLogger } from 'hono/logger';
import { setupContainer } from './di/container';
import { logger } from './utils/logger';
import { requestHeaderMiddleware } from './middleware/request-header';
import { toStructuredError, sanitizeErrorForClient } from '@crm/shared';
import type { ApiResponse } from '@crm/shared';

// Routes
import notificationsRoutes from './routes';
import inngestRoutes from './inngest/routes';

// Setup dependency injection
setupContainer();

const app = new Hono();

// Global error handler
app.onError((error, c) => {
  const structuredError = toStructuredError(error);

  if (structuredError.statusCode >= 500) {
    logger.error(
      {
        error: structuredError,
        path: c.req.path,
        method: c.req.method,
      },
      `Server error occurred: ${structuredError.message}`
    );
  } else {
    logger.warn(
      {
        error: structuredError,
        path: c.req.path,
        method: c.req.method,
      },
      `Client error occurred: ${structuredError.message}`
    );
  }

  const sanitizedError = sanitizeErrorForClient(structuredError);

  const response: ApiResponse<never> = {
    success: false,
    error: sanitizedError,
  };

  return c.json(response, sanitizedError.statusCode as any);
});

// Global middleware
app.use('*', honoLogger());
app.use('*', cors({
  origin: (origin) => {
    const allowedOrigins = [
      'http://localhost:4000',
      'http://127.0.0.1:4000',
      process.env.WEB_URL,
    ].filter(Boolean) as string[];

    return allowedOrigins.includes(origin) ? origin : allowedOrigins[0];
  },
  credentials: true,
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'x-tenant-id', 'x-user-id', 'x-permissions'],
}));

// Health check (no auth required)
app.get('/health', (c) => {
  return c.json({
    status: 'ok',
    service: 'notifications',
    timestamp: new Date().toISOString(),
  });
});

// Protected routes (auth required)
app.use('/api/*', requestHeaderMiddleware);
app.route('/api/notifications', notificationsRoutes);

// Inngest webhook handler (handles its own auth via signing key)
app.route('/', inngestRoutes);

const port = process.env.PORT ? parseInt(process.env.PORT) : 4004;

logger.info({ port }, 'Notifications service starting');

try {
  serve({
    fetch: app.fetch,
    port,
  });
  logger.info({ port }, 'Server listening successfully');
} catch (error: any) {
  logger.error({ error: error.message, stack: error.stack, port }, 'Failed to start server');
  process.exit(1);
}
