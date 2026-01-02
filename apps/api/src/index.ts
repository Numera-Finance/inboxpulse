import 'reflect-metadata';
import dotenv from 'dotenv';
import { resolve } from 'path';

// Load environment variables with .env.local taking precedence
dotenv.config({ path: resolve(process.cwd(), '.env.local') });
dotenv.config({ path: resolve(process.cwd(), '.env') });

// Validate required environment variables
const requiredEnvVars = [
  'DATABASE_URL',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'SERVICE_GMAIL_URL',
  'SERVICE_ANALYSIS_URL',
  // Better-auth: BETTER_AUTH_SECRET is optional (falls back to SESSION_SECRET)
  // WEB_URL is optional (defaults to http://localhost:4000 for local dev)
  // In production (Cloud Run), set WEB_URL to your frontend URL
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
import { createServer } from 'http';
import { setupContainer } from './di/container';
import { logger } from './utils/logger';
import { requestHeaderMiddleware, betterAuthRequestHeaderMiddleware } from './middleware/requestHeader';
import { toStructuredError, sanitizeErrorForClient } from '@crm/shared';
import type { ApiResponse } from '@crm/shared';
import type { HonoEnv } from './types/hono';

// Routes
import { healthRoutes } from './routes/health';
import { userRoutes } from './users/routes';
import integrationsRoutes from './integrations/routes';
import tenantsRoutes from './tenants/routes';
import emailsRoutes from './emails/routes';
import runsRoutes from './runs/routes';
import oauthRoutes from './oauth/routes';
import { customerRoutes } from './customers/routes';
import { contactRoutes } from './contacts/routes';
import { roleRoutes } from './roles/routes';
import { taskRoutes } from './tasks/routes';
import { dashboardRoutes } from './dashboards/routes';
import { authRoutes } from './auth/routes';
import { betterAuthRoutes } from './auth/better-auth-routes';
import inngestRoutes from './inngest/routes';

// Setup dependency injection (must be called before importing better-auth)
setupContainer();

const app = new Hono<HonoEnv>();

// Global error handler - catches all uncaught errors including middleware errors
app.onError((error, c) => {
  const structuredError = toStructuredError(error);

  // Log full error details internally
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

  // Sanitize error before sending to client
  const sanitizedError = sanitizeErrorForClient(structuredError);

  const response: ApiResponse<never> = {
    success: false,
    error: sanitizedError,
  };

  return c.json(response, sanitizedError.statusCode as any);
});

// Global middleware (no auth required)
app.use('*', honoLogger());
app.use('*', cors({
  origin: (origin) => {
    // Allow requests from web app (localhost:4000 for dev, or configured origins)
    const allowedOrigins = [
      'http://localhost:4000',
      'http://127.0.0.1:4000',
      process.env.WEB_URL,
    ].filter(Boolean) as string[];

    // Return origin if allowed, null otherwise
    return allowedOrigins.includes(origin) ? origin : allowedOrigins[0];
  },
  credentials: true,
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  exposeHeaders: ['X-Session-Refreshed'],
}));

// Public routes (no auth required)
app.route('/health', healthRoutes);
// Better-auth handles: /api/auth/sign-in/google, /api/auth/callback/google, /api/auth/session, /api/auth/sign-out
// Mount directly on main app to match better-auth docs pattern exactly
// Docs: https://www.better-auth.com/docs/integrations/hono
import { auth } from './auth/better-auth';
// Handle all HTTP methods (better-auth handles OPTIONS internally for CORS)
app.on(['POST', 'GET', 'OPTIONS'], '/api/auth/*', async (c) => {
  // According to better-auth Hono docs, c.req.raw is a Request object
  // Pass it directly to auth.handler()
  // Docs: https://www.better-auth.com/docs/integrations/hono
  const request = c.req.raw;
  const url = new URL(request.url);
  const pathname = url.pathname;
  
  // CRITICAL: For OAuth routes, handler MUST work to manage state
  // If handler doesn't work, OAuth will fail with state_not_found
  const isOAuthRoute = pathname.includes('sign-in') || pathname.includes('callback');
  
  if (isOAuthRoute) {
    // For OAuth routes, always use handler (even if it returns 404)
    // Better-auth needs to manage the entire OAuth flow including state
    const handlerResponse = await auth.handler(request);
    
    if (handlerResponse.status === 404) {
      console.error('[Better-Auth] CRITICAL: Handler returned 404 for OAuth route:', pathname);
      console.error('[Better-Auth] This causes state_not_found errors');
      // Convert headers to object (Headers.entries() may not be available in all environments)
      const headersObj: Record<string, string> = {};
      request.headers.forEach((value, key) => {
        headersObj[key] = value;
      });
      
      console.error('[Better-Auth] Request details:', {
        url: request.url,
        method: c.req.method,
        pathname,
        headers: headersObj,
      });
      
      // Return the handler response anyway - better-auth might handle it internally
      // The error page will show what's wrong
      return handlerResponse;
    }
    
    // If this is a callback redirect (302), check if it's redirecting to API server
    // and redirect to web app instead
    if (handlerResponse.status === 302 && pathname.includes('callback')) {
      const location = handlerResponse.headers.get('Location');
      const apiUrl = process.env.BETTER_AUTH_URL || process.env.SERVICE_API_URL || 'http://localhost:4001';
      if (location && location.startsWith(apiUrl)) {
        // Better-auth redirected to API server, redirect to web app instead
        // WEB_URL should be set in Cloud Run environment variables for production
        const webUrl = process.env.WEB_URL || 'http://localhost:4000';
        return c.redirect(`${webUrl}/?auth=success`);
      }
    }
    
    return handlerResponse;
  }
  
  // For non-OAuth routes, try handler first
  const handlerResponse = await auth.handler(request);
  
  // If handler works, return it
  if (handlerResponse.status !== 404) {
    return handlerResponse;
  }
  
  // Handler returned 404 - use direct API calls as workaround for non-OAuth routes
  console.log('[Better-Auth] Handler returned 404, using direct API call for:', pathname);
  
  try {
    // Handle /api/auth/session
    if (pathname === '/api/auth/session' && c.req.method === 'GET') {
      const session = await auth.api.getSession({ headers: request.headers });
      return c.json({ data: session });
    }
    
    // Handle /api/auth/callback/google
    if (pathname.startsWith('/api/auth/callback/') && c.req.method === 'GET') {
      // OAuth callback needs the handler to work properly
      // Try using the API method directly
      try {
        const provider = pathname.split('/').pop(); // Extract provider (e.g., 'google')
        const searchParams = url.searchParams;
        const code = searchParams.get('code');
        const state = searchParams.get('state');
        
        if (code && provider) {
          // Use better-auth API to handle callback
          // Note: callbackOAuth expects a Request object, not individual params
          // We'll construct a proper request for better-auth
          const callbackRequest = new Request(request.url, {
            method: 'GET',
            headers: request.headers,
          });
          
          // Try using the handler for callback (it should work for callbacks)
          const callbackResponse = await auth.handler(callbackRequest);
          
          // If handler worked, return it (it will handle redirects)
          if (callbackResponse.status !== 404) {
            return callbackResponse;
          }
          
          // Fallback: redirect to web app
          const webUrl = process.env.WEB_URL || 'http://localhost:4000';
          return c.redirect(`${webUrl}/?auth=success`);
        }
      } catch (error: any) {
        console.error('[Better-Auth] Callback error:', error);
        const webUrl = process.env.WEB_URL || 'http://localhost:4000';
        return c.redirect(`${webUrl}/?auth=error&message=${encodeURIComponent(error.message)}`);
      }
      
      // Fallback to handler response
      return handlerResponse;
    }
    
    // For other routes, return the handler response (404)
    return handlerResponse;
  } catch (error: any) {
    console.error('[Better-Auth] Direct API call error:', error);
    return c.json({ error: error.message }, 500);
  }
});
// Custom auth routes moved to /api/auth/legacy (for dev/testing only)
app.route('/api/auth/legacy', authRoutes);
app.route('/oauth', oauthRoutes);
app.route('/', inngestRoutes); // Inngest webhook handler at /api/inngest/*

// Protected routes (auth required)
// Use better-auth middleware chain (tries better-auth first, falls back to legacy in dev)
app.use('/api/users/*', betterAuthRequestHeaderMiddleware);
app.use('/api/integrations/*', betterAuthRequestHeaderMiddleware);
app.use('/api/tenants/*', betterAuthRequestHeaderMiddleware);
app.use('/api/emails/*', betterAuthRequestHeaderMiddleware);
app.use('/api/runs/*', betterAuthRequestHeaderMiddleware);
app.use('/api/customers/*', betterAuthRequestHeaderMiddleware);
app.use('/api/contacts/*', betterAuthRequestHeaderMiddleware);
app.use('/api/roles/*', betterAuthRequestHeaderMiddleware);
app.use('/api/tasks/*', betterAuthRequestHeaderMiddleware);
app.use('/api/dashboards/*', betterAuthRequestHeaderMiddleware);

app.route('/api/users', userRoutes);
app.route('/api/integrations', integrationsRoutes);
app.route('/api/tenants', tenantsRoutes);
app.route('/api/emails', emailsRoutes);
app.route('/api/runs', runsRoutes);
app.route('/api/customers', customerRoutes);
app.route('/api/contacts', contactRoutes);
app.route('/api/roles', roleRoutes);
app.route('/api/tasks', taskRoutes);
app.route('/api/dashboards', dashboardRoutes);

const port = process.env.PORT ? parseInt(process.env.PORT) : 4001;

logger.info({ port }, 'CRM API service starting');

let server: ReturnType<typeof serve> | null = null;

// Track if we're already shutting down to prevent double shutdown
let isShuttingDown = false;

// Graceful shutdown handler
const shutdown = (signal: string) => {
  // Prevent multiple shutdown calls
  if (isShuttingDown) {
    logger.warn({ signal }, 'Shutdown already in progress, ignoring duplicate signal');
    return;
  }
  
  isShuttingDown = true;
  logger.info({ signal }, 'Received shutdown signal, closing server...');
  
  if (server) {
    // Close all connections and stop accepting new ones
    server.close(() => {
      logger.info('Server closed successfully');
      // Exit immediately - nodemon will handle the delay before restarting
      process.exit(0);
    });
    
    // Force close after 3 seconds if graceful close doesn't work (matches nodemon killTimeout)
    setTimeout(() => {
      logger.error('Forced shutdown after timeout');
      process.exit(1);
    }, 3000);
  } else {
    process.exit(0);
  }
};

// Handle shutdown signals
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Handle uncaught errors
process.on('uncaughtException', (error: Error) => {
  logger.error({ error: error.message, stack: error.stack }, 'Uncaught exception');
  shutdown('uncaughtException');
});

process.on('unhandledRejection', (reason: any) => {
  logger.error({ reason }, 'Unhandled rejection');
  shutdown('unhandledRejection');
});

// Helper function to check if port is available
const checkPortAvailable = (port: number): Promise<boolean> => {
  return new Promise((resolve) => {
    const testServer = createServer();
    testServer.listen(port, () => {
      testServer.once('close', () => resolve(true));
      testServer.close();
    });
    testServer.on('error', () => resolve(false));
  });
};

// Start server with retry logic for port binding
const startServer = async (retries = 10, delay = 1000): Promise<void> => {
  for (let attempt = 1; attempt <= retries; attempt++) {
    // Check if port is available before attempting to bind
    const portAvailable = await checkPortAvailable(port);
    
    if (!portAvailable && attempt < retries) {
      logger.warn(
        { port, attempt, maxRetries: retries },
        `Port ${port} is still in use, waiting ${delay}ms before retry...`
      );
      await new Promise(resolve => setTimeout(resolve, delay));
      continue;
    }

    try {
      // Create a promise to handle async server errors
      let serverError: any = null;
      const serverErrorPromise = new Promise<void>((resolve, reject) => {
        const errorTimeout = setTimeout(() => {
          // If no error after 1 second, assume server started successfully
          resolve();
        }, 1000);

        server = serve({
          fetch: app.fetch,
          port,
        });

        // Handle server errors (e.g., port already in use)
        server.on('error', (error: any) => {
          clearTimeout(errorTimeout);
          serverError = error;
          if (error.code === 'EADDRINUSE') {
            reject(error);
          } else {
            logger.error({ error: error.message, stack: error.stack, port }, 'Server error');
            reject(error);
          }
        });

        server.on('listening', () => {
          clearTimeout(errorTimeout);
          logger.info({ port }, 'Server listening successfully');
          resolve();
        });
      });

      // Wait for server to either start successfully or error
      await serverErrorPromise;
      
      // Successfully started
      return;
    } catch (error: any) {
      if (error.code === 'EADDRINUSE' && attempt < retries) {
        logger.warn(
          { port, attempt, maxRetries: retries, error: error.message },
          `Port binding failed, retrying in ${delay}ms...`
        );
        // Clean up the failed server instance
        if (server) {
          try {
            server.close();
          } catch (e) {
            // Ignore cleanup errors
          }
          server = null;
        }
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      
      logger.error({ error: error.message, stack: error.stack, port }, 'Failed to start server');
      if (error.code === 'EADDRINUSE') {
        logger.error(
          { port },
          `Run: lsof -ti :${port} | xargs kill -9`
        );
      }
      process.exit(1);
    }
  }
  
  // If we get here, all retries failed
  logger.error(
    { port, retries },
    `Failed to start server after ${retries} attempts. Port ${port} may still be in use.`
  );
  logger.error(
    { port },
    `Run: lsof -ti :${port} | xargs kill -9`
  );
  process.exit(1);
};

// Start server asynchronously
(async () => {
  try {
    await startServer();
  } catch (error: any) {
    logger.error({ error: error.message, stack: error.stack, port }, 'Failed to start server');
    process.exit(1);
  }
})();
