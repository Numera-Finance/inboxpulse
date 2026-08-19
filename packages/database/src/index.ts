// Database package only exports db instance creation function
// Schemas and repositories are API-specific and live in API modules
// This keeps database package independent (no dependency on API)
export * from './db';
export type { Database } from './db';
export * from './scoped-repository';
export * from './scoped-search-builder';
export * from './search-condition-builder';

// Re-export drizzle-orm functions to ensure single instance across packages
export { eq, and, or, not, sql, desc, asc, like, ilike, inArray, isNull, isNotNull, lte, gte, lt, gt, ne, between, notInArray, exists, notExists } from 'drizzle-orm';
export type { SQL } from 'drizzle-orm';
export type { PgTableWithColumns } from 'drizzle-orm/pg-core';
export * from './like-pattern';
// Restored: a squash (72f8231) deleted this file and this line together,
// while two open branches still imported it. See 94d949a for why it exists —
// postgres.js reports affected rows on `count`, not `rowCount`, so reading
// `rowCount ?? 0` reports a confident zero for every successful write.
export * from './affected-rows';
