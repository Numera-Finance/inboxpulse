import { SQL, sql, eq, and } from 'drizzle-orm';
import type { PgColumn, PgTableWithColumns } from 'drizzle-orm/pg-core';
import type { Database } from './db';
import { isAdmin, type RequestHeader } from '@crm/shared';

/**
 * Base repository class for repositories that need access control
 *
 * Provides helper methods for:
 * - Tenant isolation (required for all queries)
 * - Customer-based access control (via user_accessible_customers table)
 * - User-based access control (via user_subordinates table)
 *
 * Customer access uses the `user_accessible_customers` denormalized table which
 * contains all customers a user can access (their direct assignments + all
 * customers accessible via their reporting hierarchy).
 *
 * User access uses the `user_subordinates` denormalized table which contains
 * all subordinates a user can manage (direct + transitive reports).
 *
 * Admin users bypass access filters but NEVER bypass tenant isolation.
 *
 * @example Customer-based access (e.g., CustomerRepository, EmailRepository):
 * ```typescript
 * const where = and(
 *   this.tenantFilter(customers.tenantId, header),
 *   this.customerAccessFilter(customers.id, header)
 * );
 * ```
 *
 * @example User-based access (e.g., TaskRepository):
 * ```typescript
 * const where = and(
 *   this.tenantFilter(tasks.tenantId, header),
 *   this.userAccessFilter(tasks.assignedToId, header)
 * );
 * ```
 */
export abstract class ScopedRepository {
  constructor(protected db: Database) {}

  /**
   * Returns SQL condition for customer access control.
   * Use this in WHERE clauses to filter by accessible customers.
   * Admins bypass this filter and see all customers in tenant.
   */
  protected customerAccessFilter(
    customerIdColumn: PgColumn,
    header: RequestHeader
  ): SQL {
    if (isAdmin(header.permissions)) {
      return sql`true`;
    }

    return sql`${customerIdColumn} IN (
      SELECT uac.customer_id
      FROM user_accessible_customers uac
      WHERE uac.user_id = ${header.userId}
    )`;
  }

  /**
   * Returns SQL condition for tenant isolation.
   * MUST be included in every query - NEVER bypassed, even for admins.
   */
  protected tenantFilter(
    tenantIdColumn: PgColumn,
    header: RequestHeader
  ): SQL {
    return eq(tenantIdColumn, header.tenantId);
  }

  /**
   * Combines tenant + customer access filters.
   * For admin users, only applies tenant filter.
   */
  protected accessFilter(
    tenantIdColumn: PgColumn,
    customerIdColumn: PgColumn,
    header: RequestHeader
  ): SQL {
    if (isAdmin(header.permissions)) {
      return this.tenantFilter(tenantIdColumn, header);
    }

    return and(
      this.tenantFilter(tenantIdColumn, header),
      this.customerAccessFilter(customerIdColumn, header)
    )!;
  }

  /**
   * Check if user has access to a specific customer.
   * Admins always have access within their tenant.
   */
  protected async hasCustomerAccess(
    header: RequestHeader,
    customerId: string
  ): Promise<boolean> {
    if (isAdmin(header.permissions)) {
      return true;
    }

    const result = await this.db.execute(sql`
      SELECT 1 FROM user_accessible_customers
      WHERE user_id = ${header.userId} AND customer_id = ${customerId}
      LIMIT 1
    `);
    return result.length > 0;
  }

  // ===========================================================================
  // User-based Access Control (for tasks, etc.)
  // ===========================================================================

  /**
   * Returns SQL condition for user-based access control.
   * Use this for entities assigned to users (like tasks).
   *
   * User can access:
   * - Unassigned items (assignedToId IS NULL)
   * - Their own items (assignedToId = userId)
   * - Subordinate's items (via user_subordinates table)
   *
   * Admins bypass this filter.
   */
  protected userAccessFilter(
    assignedToColumn: PgColumn,
    header: RequestHeader
  ): SQL {
    if (isAdmin(header.permissions)) {
      return sql`true`;
    }

    return sql`(
      ${assignedToColumn} IS NULL
      OR ${assignedToColumn} = ${header.userId}
      OR ${assignedToColumn} IN (
        SELECT subordinate_id FROM user_subordinates
        WHERE user_id = ${header.userId}
      )
    )`;
  }

  /**
   * Check if user has access to an item assigned to a specific user.
   * User can access: unassigned, own, or subordinate's items.
   * Admins always have access.
   */
  protected async hasUserAccess(
    header: RequestHeader,
    assignedToId: string | null
  ): Promise<boolean> {
    if (isAdmin(header.permissions)) {
      return true;
    }

    // Unassigned items are accessible to all
    if (assignedToId === null) {
      return true;
    }

    // Own items
    if (assignedToId === header.userId) {
      return true;
    }

    // Check if assigned to a subordinate
    const result = await this.db.execute(sql`
      SELECT 1 FROM user_subordinates
      WHERE user_id = ${header.userId} AND subordinate_id = ${assignedToId}
      LIMIT 1
    `);
    return result.length > 0;
  }

  /**
   * Combines tenant + user access filters.
   * For admin users, only applies tenant filter.
   */
  protected userScopedFilter(
    tenantIdColumn: PgColumn,
    assignedToColumn: PgColumn,
    header: RequestHeader
  ): SQL {
    if (isAdmin(header.permissions)) {
      return this.tenantFilter(tenantIdColumn, header);
    }

    return and(
      this.tenantFilter(tenantIdColumn, header),
      this.userAccessFilter(assignedToColumn, header)
    )!;
  }

  /**
   * Build SQL condition for freeform text search.
   * Override in subclasses to search across relevant text columns.
   *
   * When a search query uses the special `_search` field, the service
   * calls this method to build the search condition.
   *
   * @param searchTerm - The search term to match
   * @returns SQL condition or undefined if freeform search not supported
   */
  buildFreeformSearch(searchTerm: string): SQL | undefined {
    return undefined;
  }
}
