import { Hono } from 'hono';
import { serve } from 'inngest/hono';
import { inngest, inngestFunctions } from './client';

/**
 * Inngest route handler for webhook callbacks
 * Inngest will call this endpoint to trigger functions and sync function definitions
 */
const app = new Hono();

// Serve Inngest functions
// This handles:
// - /api/inngest - Function sync/discovery and event ingestion
// The serve() function returns a Hono-compatible handler
// Signing key is automatically read from INNGEST_SIGNING_KEY environment variable
const inngestHandler = serve({
  client: inngest,
  functions: inngestFunctions,
});

// Mount Inngest handler at /api/inngest/*
// Inngest will call this endpoint to sync functions and trigger execution
app.all('/api/inngest', inngestHandler);
app.all('/api/inngest/*', inngestHandler);

export default app;
