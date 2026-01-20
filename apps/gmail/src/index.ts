import dotenv from 'dotenv';
import { resolve } from 'path';

// Load environment variables with .env.local taking precedence
dotenv.config({ path: resolve(process.cwd(), '.env.local') });
dotenv.config({ path: resolve(process.cwd(), '.env') });

// Validate required environment variables
const requiredEnvVars = [
  'SERVICE_API_URL',
  'GMAIL_PUBSUB_TOPIC',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
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
import { logger } from './utils/logger';

// Routes
import webhooksRoutes from './routes/webhooks';
import syncRoutes from './routes/sync';
import watchRenewalRoutes from './routes/watch-renewal';
import { verifyServiceApiKey } from './middleware/internal-auth';

const app = new Hono();

// Middleware
app.use('*', honoLogger());
app.use('*', cors());

// Health check
app.get('/health', (c) => {
  return c.json({
    status: 'ok',
    service: 'gmail-sync',
    timestamp: new Date().toISOString(),
  });
});

// API Routes (with error handling for route setup)
try {
  // Webhooks - protected by Pub/Sub token verification (handled in route)
  app.route('/webhooks', webhooksRoutes);

  // Internal API routes - protected by service API key
  app.use('/api/*', verifyServiceApiKey);
  app.route('/api/sync', syncRoutes);
  app.route('/api/watch', watchRenewalRoutes);
  logger.info('Routes registered successfully');
} catch (error: any) {
  logger.error({ error: error.message }, 'Failed to register routes');
}

const port = process.env.PORT ? parseInt(process.env.PORT) : 4002;

logger.info({ port, env: process.env.NODE_ENV }, 'Gmail sync service starting');

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
