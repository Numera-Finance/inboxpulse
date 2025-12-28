/**
 * Base repository for notification repositories
 */

import { eq, and, type Database } from '@crm/database';
import type { RequestHeader } from '@crm/shared';
import type { PgColumn } from 'drizzle-orm/pg-core';

export abstract class BaseNotificationRepository {
  constructor(protected db: Database) {}

  /**
   * Returns SQL condition for tenant isolation.
   * MUST be included in every query - NEVER bypassed.
   */
  protected tenantFilter(
    tenantIdColumn: PgColumn,
    header: RequestHeader
  ) {
    return eq(tenantIdColumn, header.tenantId);
  }

  /**
   * Returns SQL condition combining tenant filter with optional user filter
   */
  protected baseFilters(
    tenantIdColumn: PgColumn,
    header: RequestHeader,
    userIdColumn?: PgColumn
  ) {
    const filters = [this.tenantFilter(tenantIdColumn, header)];
    if (userIdColumn) {
      filters.push(eq(userIdColumn, header.userId));
    }
    return and(...filters);
  }
}
