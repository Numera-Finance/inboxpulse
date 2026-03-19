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
function getSslOptions(): Options<Record<string, never>>['ssl'] | undefined {
  const serverCa = readCert('CLOUDSQL_SERVER_CA', 'CLOUDSQL_SERVER_CA_PATH');
  const clientCert = readCert('CLOUDSQL_CLIENT_CERT', 'CLOUDSQL_CLIENT_CERT_PATH');
  const clientKey = readCert('CLOUDSQL_CLIENT_KEY', 'CLOUDSQL_CLIENT_KEY_PATH');

  if (serverCa && clientCert && clientKey) {
    console.error('[Drizzle] SSL: Client certificate authentication enabled (mTLS)');
    return {
      ca: serverCa,
      cert: clientCert,
      key: clientKey,
      rejectUnauthorized: true,
    };
  }

  if (serverCa) {
    console.error('[Drizzle] SSL: Server CA verification enabled');
    return {
      ca: serverCa,
      rejectUnauthorized: true,
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
    client = postgres(connectionString, ssl ? { ssl } : {});
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
