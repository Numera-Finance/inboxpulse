import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { createDatabase } from '@crm/database';
import * as schema from './schema';
import { logger } from '../utils/logger';

let db: PostgresJsDatabase<typeof schema> | null = null;

/**
 * Get database connection (lazy initialization)
 *
 * Uses the shared @crm/database client so the Cloud SQL mTLS options
 * (CLOUDSQL_SERVER_CA / CLOUDSQL_CLIENT_CERT / CLOUDSQL_CLIENT_KEY) are
 * applied. A bare postgres(DATABASE_URL) client was rejected by Cloud SQL
 * with "connection requires a valid client certificate", which silently
 * disabled the analysis cache in production.
 */
export function getDb() {
  if (!db) {
    db = createDatabase(schema);
    logger.info('Database connection initialized');
  }
  return db;
}

export { schema };
