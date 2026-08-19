import { drizzle, type PostgresJsDatabase, type PostgresJsTransaction } from 'drizzle-orm/postgres-js';
import type { ExtractTablesWithRelations } from 'drizzle-orm';
import postgres from 'postgres';
import type { Options } from 'postgres';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// Read cert content from env var (inline PEM) or file path
function readCert(envVar: string, pathEnvVar: string): string | undefined {
  const content = process.env[envVar];
  if (content) return content;

  const filePath = process.env[pathEnvVar];
  if (filePath) {
    const resolved = resolve(filePath);
    return readFileSync(resolved, 'utf-8');
  }
  return undefined;
}

// Build SSL options from environment variables (inline PEM or file paths)
// Inline PEM: CLOUDSQL_SERVER_CA, CLOUDSQL_CLIENT_CERT, CLOUDSQL_CLIENT_KEY (used in Cloud Run via Secret Manager)
// File paths: CLOUDSQL_SERVER_CA_PATH, CLOUDSQL_CLIENT_CERT_PATH, CLOUDSQL_CLIENT_KEY_PATH (used for local dev)
//
// Cloud SQL's server certificate SAN is the instance's `*.sql.goog` DNS name,
// which does not resolve to (or match) the private IP we connect to. We verify
// the certificate chain via `ca` (plus mTLS when a client cert is configured)
// but skip hostname verification — equivalent to Postgres `sslmode=verify-ca`.
// Without this override, Node TLS defaults the hostname to `localhost` and
// rejects the handshake with ERR_TLS_CERT_ALTNAME_INVALID.
function getSslOptions(): Options<Record<string, never>>['ssl'] | undefined {
  const serverCa = readCert('CLOUDSQL_SERVER_CA', 'CLOUDSQL_SERVER_CA_PATH');
  const clientCert = readCert('CLOUDSQL_CLIENT_CERT', 'CLOUDSQL_CLIENT_CERT_PATH');
  const clientKey = readCert('CLOUDSQL_CLIENT_KEY', 'CLOUDSQL_CLIENT_KEY_PATH');

  if (serverCa && clientCert && clientKey) {
    console.error('[Drizzle] SSL: Client certificate authentication enabled (mTLS, verify-ca)');
    return {
      ca: serverCa,
      cert: clientCert,
      key: clientKey,
      rejectUnauthorized: true,
      checkServerIdentity: () => undefined,
    };
  }

  if (serverCa) {
    console.error('[Drizzle] SSL: Server CA verification enabled (verify-ca)');
    return {
      ca: serverCa,
      rejectUnauthorized: true,
      checkServerIdentity: () => undefined,
    };
  }

  return undefined;
}

// Lazy client creation - only create when createDatabase is called
// This ensures DATABASE_URL is loaded from dotenv before connection
let client: ReturnType<typeof postgres> | null = null;

function getClient() {
  if (!client) {
    const connectionString = process.env.DATABASE_URL || 'postgresql://localhost:5432/crm';
    if (!process.env.DATABASE_URL) {
      console.error('[Drizzle] ⚠️  WARNING: DATABASE_URL not set, using default: postgresql://localhost:5432/crm');
    } else {
      // Log the connection string (mask password for security)
      const maskedUrl = connectionString.replace(/:([^:@]+)@/, ':***@');
      console.error(`[Drizzle] Using DATABASE_URL: ${maskedUrl}`);
    }

    const ssl = getSslOptions();
    client = postgres(connectionString, {
      ...(ssl ? { ssl } : {}),
      connection: {
        /**
         * Reap a transaction the application has stopped talking to.
         *
         * On 2026-08-19 a single connection sat `idle in transaction` for 46
         * minutes holding `pg_advisory_xact_lock` — the lock
         * `ensureCustomerForEmail` takes to serialize customer creation per
         * (tenant, domain). Because it is an *xact* lock it is only released at
         * commit, and the commit never came: Cloud Run had killed the request at
         * its 300s ceiling and throttled the instance's CPU, freezing the code
         * mid-transaction. 74 sessions queued behind that lock, exhausted the
         * pool, and every add-on endpoint — including `/viewer`, a single indexed
         * lookup — hung for three hours.
         *
         * The database had `idle_in_transaction_session_timeout = 0`, so nothing
         * ever reclaimed it. It is set here rather than only on the server so the
         * guarantee travels with the code and survives a database that has been
         * reprovisioned or is configured by someone else.
         *
         * This kills only sessions idle BETWEEN statements inside a transaction,
         * which is never legitimate. It is deliberately not `statement_timeout`:
         * that would also kill the long backfills and embedding jobs that share
         * this package and are supposed to take minutes.
         */
        idle_in_transaction_session_timeout: 120_000,
      },
      /**
       * Bound the pool, because the ceiling is shared and small.
       *
       * postgres.js defaults to 10 connections per process and nothing set it.
       * Six services touch this database and each scales to 10 instances
       * (manager 5, embeddings 3), so full scale-out demands roughly 480
       * connections against a `max_connections` of 300 — the cluster runs out
       * before any single service thinks it is busy, and the symptom lands on
       * whichever service happens to connect next rather than on the one that
       * caused it.
       *
       * 5 x 48 possible instances = 240, leaving headroom for psql, migrations
       * and cron. Override with DB_POOL_MAX where a service genuinely needs more.
       */
      max: Number(process.env.DB_POOL_MAX ?? 5),
      /** Hand connections back rather than holding them across idle periods. */
      idle_timeout: 30,
      /** Fail fast instead of hanging when the cluster is already saturated. */
      connect_timeout: 10,
    });
  }
  return client;
}

// Database instance is created by API with schemas passed in
// This keeps database package independent of API schemas (no circular dependency)
let dbInstance: PostgresJsDatabase<Record<string, unknown>> | null = null;

// Custom logger for Drizzle SQL queries
const drizzleLogger = {
  logQuery: (query: string, params: unknown[]) => {
    // Use console.error to ensure it shows up even if stdout is redirected
    console.error('\n🔵 [Drizzle SQL]', query);
    if (params && params.length > 0) {
      console.error('🔵 [Drizzle Params]', JSON.stringify(params, null, 2));
    }
    console.error(''); // Empty line for readability
  },
};

export function createDatabase<T extends Record<string, unknown>>(schema: T): PostgresJsDatabase<T> {
  // Enable logging if DRIZZLE_LOG is 'true' or in development mode (default to true for dev)
  const nodeEnv = process.env.NODE_ENV || 'development';
  const enableLogging = process.env.DRIZZLE_LOG === 'true' || 
                        (process.env.DRIZZLE_LOG !== 'false' && nodeEnv === 'development');
  
  // Always log to stderr so it shows up even if stdout is redirected
  console.error(`\n[Drizzle] ========================================`);
  console.error(`[Drizzle] Initializing database...`);
  console.error(`[Drizzle] NODE_ENV: ${nodeEnv}`);
  console.error(`[Drizzle] DRIZZLE_LOG: ${process.env.DRIZZLE_LOG || 'not set'}`);
  console.error(`[Drizzle] Logging enabled: ${enableLogging}`);
  
  // Log DATABASE_URL status (masked)
  const dbUrl = process.env.DATABASE_URL;
  if (dbUrl) {
    const maskedUrl = dbUrl.replace(/:([^:@]+)@/, ':***@');
    console.error(`[Drizzle] DATABASE_URL: ${maskedUrl}`);
  } else {
    console.error(`[Drizzle] ⚠️  DATABASE_URL not set, using default`);
  }
  
  console.error(`[Drizzle] ========================================\n`);
  
  if (dbInstance) {
    console.error(`[Drizzle] ⚠️  Database instance already exists - recreating with logging=${enableLogging}`);
    dbInstance = null; // Force recreation to enable/disable logging
  }
  
  const pgClient = getClient();
  dbInstance = drizzle(pgClient, { 
    schema,
    logger: enableLogging ? drizzleLogger : false
  });
  
  if (enableLogging) {
    console.error(`[Drizzle] ✅ SQL logging ENABLED - queries will appear below\n`);
  } else {
    console.error(`[Drizzle] ❌ SQL logging DISABLED\n`);
  }
  
  return dbInstance as PostgresJsDatabase<T>;
}

export function getDatabase(): PostgresJsDatabase<Record<string, unknown>> {
  if (!dbInstance) {
    throw new Error('Database not initialized. Call createDatabase() first with schemas.');
  }
  return dbInstance;
}

export type Database = PostgresJsDatabase<Record<string, unknown>>;
export type Transaction = PostgresJsTransaction<Record<string, unknown>, ExtractTablesWithRelations<Record<string, unknown>>>;

// Export client getter for Better Auth or other libraries that need direct access
export function getDatabaseClient(): ReturnType<typeof postgres> {
  return getClient();
}
