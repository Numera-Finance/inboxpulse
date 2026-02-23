import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';
import { logger } from '../utils/logger';
import { getEnv } from '../env';

let client: ReturnType<typeof postgres> | null = null;
let db: PostgresJsDatabase<typeof schema> | null = null;

/**
 * Get database connection (lazy initialization)
 * Uses postgres-js driver (same as crm-api)
 */
export function getDb() {
  if (!db) {
    client = postgres(getEnv().DATABASE_URL);
    db = drizzle(client, { schema });
    logger.info('Database connection initialized');
  }
  return db;
}

export { schema };
