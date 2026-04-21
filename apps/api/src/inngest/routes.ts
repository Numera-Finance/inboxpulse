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
  // Signing key can be passed explicitly or via INNGEST_SIGNING_KEY env var (recommended)
  // signingKey: process.env.INNGEST_SIGNING_KEY,
});

// Mount Inngest handler at /api/inngest/*.
// Restrict to GET/POST/PUT only — those are the three methods the Inngest
// serve handler actually requires (one for discovery, two for event
// ingestion/sync). Forwarding PATCH/OPTIONS/DELETE was the exploit surface
// behind the April 2026 TS SDK advisory; the SDK ≥3.54.0 patches it, this
// restriction is defense-in-depth so a future regression can't reopen it.
const inngestMethods = ['GET', 'POST', 'PUT'];
app.on(inngestMethods, '/api/inngest', inngestHandler);
app.on(inngestMethods, '/api/inngest/*', inngestHandler);

export default app;
