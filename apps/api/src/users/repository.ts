import { eq, and, sql, isNull, inArray, SQL } from 'drizzle-orm';
import { injectable, inject } from 'tsyringe';
import { ScopedRepository } from '@crm/database';
import type { Database, Transaction } from '@crm/database';
import type { RequestHeader } from '@crm/shared';
import {
  users,
  userManagers,
  userCustomers,
  userAccessibleCustomers,
  userSubordinates,
  type User,
  type NewUser,
  type UserManager,
  type NewUserManager,
  type UserCustomer,
  type NewUserCustomer,
  RowStatus,
} from './schema';
import { logger } from '../utils/logger';

export interface RebuildResult {
  deletedCount: number;
  insertedCount: number;
  durationMs: number;
}

@injectable()
export class UserRepository extends ScopedRepository {
  constructor(@inject('Database') db: Database) {
    super(db);
  }

  /**
   * Build freeform search condition for users.
   * Searches across: firstName, lastName, full name (concatenated), and email.
   */
  override buildFreeformSearch(searchTerm: string): SQL | undefined {
    if (!searchTerm || searchTerm.trim() === '') {
      return undefined;
    }
    const term = `%${searchTerm}%`;
    return sql`(
      ${users.firstName} ILIKE ${term} OR
      ${users.lastName} ILIKE ${term} OR
      (${users.firstName} || ' ' || ${users.lastName}) ILIKE ${term} OR
      ${users.email} ILIKE ${term}
    )`;
  }

  // ===========================================================================
  // User CRUD
  // ===========================================================================

  async findById(id: string, header?: RequestHeader): Promise<User | undefined> {
    // Build where clause with optional tenant isolation
    const whereClause = header
      ? and(eq(users.id, id), this.tenantFilter(users.tenantId, header))
      : eq(users.id, id);

    const result = await this.db.select().from(users).where(whereClause);
    return result[0];
  }

  async findByEmail(tenantId: string, email: string): Promise<User | undefined> {
    const result = await this.db
      .select()
      .from(users)
      .where(and(eq(users.tenantId, tenantId), eq(users.email, email)));
    return result[0];
  }

  /**
   * Find user by email with role permissions
   * Used for authentication to get user's permissions
   */
  async findByEmailWithRole(
    tenantId: string,
    email: string
  ): Promise<{ user: User; permissions: number[] } | undefined> {
    const { roles } = await import('../roles/schema');

    const result = await this.db
      .select({
        user: users,
        rolePermissions: roles.permissions,
      })
      .from(users)
      .leftJoin(roles, eq(users.roleId, roles.id))
      .where(and(eq(users.tenantId, tenantId), eq(users.email, email)));

    if (result.length === 0) {
      return undefined;
    }

    return {
      user: result[0].user,
      permissions: result[0].rolePermissions ?? [],
    };
  }

  /**
   * Find user by API key hash with role permissions
   * Used for service-to-service authentication
   */
  async findByApiKeyHash(
    apiKeyHash: string
  ): Promise<{ user: User; permissions: number[] } | undefined> {
    const { roles } = await import('../roles/schema');

    const result = await this.db
      .select({
        user: users,
        rolePermissions: roles.permissions,
      })
      .from(users)
      .leftJoin(roles, eq(users.roleId, roles.id))
      .where(eq(users.apiKeyHash, apiKeyHash));

    if (result.length === 0) {
      return undefined;
    }

    return {
      user: result[0].user,
      permissions: result[0].rolePermissions ?? [],
    };
  }

  /**
   * Batch find users by email addresses
   * Returns a map of email -> User for efficient lookup
   */
  async findByEmails(tenantId: string, emails: string[]): Promise<Map<string, User>> {
    if (emails.length === 0) {
      return new Map();
    }

    const { inArray } = await import('drizzle-orm');
    const result = await this.db
      .select()
      .from(users)
      .where(
        and(
          eq(users.tenantId, tenantId),
          inArray(users.email, emails)
        )
      );

    const emailMap = new Map<string, User>();
    for (const user of result) {
      emailMap.set(user.email.toLowerCase(), user);
    }
    return emailMap;
  }

  /**
   * Find user by email across all tenants
   * Used for tenantId lookup during SSO
   */
  async findByEmailGlobal(email: string): Promise<User | undefined> {
    const result = await this.db
      .select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1);
    return result[0];
  }

  async findByTenantId(tenantId: string): Promise<User[]> {
    return this.db
      .select()
      .from(users)
      .where(
        and(
          eq(users.tenantId, tenantId),
          isNull(users.apiKeyHash) // Exclude API/service users
        )
      );
  }

  async findActiveByTenantId(tenantId: string): Promise<User[]> {
    return this.db
      .select()
      .from(users)
      .where(
        and(
          eq(users.tenantId, tenantId),
          eq(users.rowStatus, RowStatus.ACTIVE),
          isNull(users.apiKeyHash) // Exclude API/service users
        )
      );
  }

  async create(data: NewUser): Promise<User> {
    const result = await this.db.insert(users).values(data).returning();
    return result[0];
  }

  async upsert(data: NewUser): Promise<User> {
    const result = await this.db
      .insert(users)
      .values(data)
      .onConflictDoUpdate({
        target: [users.tenantId, users.email],
        set: {
          firstName: data.firstName,
          lastName: data.lastName,
          rowStatus: data.rowStatus,
          updatedAt: new Date(),
        },
      })
      .returning();
    return result[0];
  }

  async update(id: string, data: Partial<NewUser>): Promise<User | undefined> {
    const result = await this.db
      .update(users)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(users.id, id))
      .returning();
    return result[0];
  }

  // ===========================================================================
  // Manager Relationships
  // ===========================================================================

  async getManagers(userId: string): Promise<User[]> {
    const result = await this.db
      .select({ manager: users })
      .from(userManagers)
      .innerJoin(users, eq(users.id, userManagers.managerId))
      .where(eq(userManagers.userId, userId));
    return result.map((r) => r.manager);
  }

  async getDirectReports(managerId: string): Promise<User[]> {
    const result = await this.db
      .select({ user: users })
      .from(userManagers)
      .innerJoin(users, eq(users.id, userManagers.userId))
      .where(eq(userManagers.managerId, managerId));
    return result.map((r) => r.user);
  }

  async addManager(userId: string, managerId: string): Promise<UserManager> {
    const result = await this.db
      .insert(userManagers)
      .values({ userId, managerId })
      .onConflictDoNothing()
      .returning();
    return result[0];
  }

  async removeManager(userId: string, managerId: string): Promise<void> {
    await this.db
      .delete(userManagers)
      .where(
        and(
          eq(userManagers.userId, userId),
          eq(userManagers.managerId, managerId)
        )
      );
  }

  async clearManagers(userId: string): Promise<void> {
    await this.db
      .delete(userManagers)
      .where(eq(userManagers.userId, userId));
  }

  async setManagers(userId: string, managerIds: string[]): Promise<void> {
    await this.db.transaction(async (tx) => {
      // Clear existing
      await tx
        .delete(userManagers)
        .where(eq(userManagers.userId, userId));

      // Add new
      if (managerIds.length > 0) {
        await tx.insert(userManagers).values(
          managerIds.map((managerId) => ({ userId, managerId }))
        );
      }
    });
  }

  // ===========================================================================
  // Customer Assignments
  // ===========================================================================

  async getCustomerAssignments(userId: string): Promise<UserCustomer[]> {
    return this.db
      .select()
      .from(userCustomers)
      .where(eq(userCustomers.userId, userId));
  }

  /**
   * Get all users assigned to a specific customer
   */
  async getUsersByCustomer(customerId: string): Promise<Array<User & { roleId: string | null }>> {
    const result = await this.db
      .select({
        id: users.id,
        tenantId: users.tenantId,
        firstName: users.firstName,
        lastName: users.lastName,
        email: users.email,
        roleId: userCustomers.roleId,
        apiKeyHash: users.apiKeyHash,
        canLogin: users.canLogin,
        timezone: users.timezone,
        rowStatus: users.rowStatus,
        createdAt: users.createdAt,
        updatedAt: users.updatedAt,
        lastLoginAt: users.lastLoginAt,
      })
      .from(userCustomers)
      .innerJoin(users, eq(users.id, userCustomers.userId))
      .where(eq(userCustomers.customerId, customerId));
    return result;
  }

  /**
   * Get the account owner (Account Manager) for a customer
   * Account Manager role ID: 550e8400-e29b-41d4-a716-446655440001
   */
  async getAccountOwner(customerId: string): Promise<User | undefined> {
    const ACCOUNT_MANAGER_ROLE_ID = '550e8400-e29b-41d4-a716-446655440001';
    const result = await this.db
      .select({ user: users })
      .from(userCustomers)
      .innerJoin(users, eq(users.id, userCustomers.userId))
      .where(
        and(
          eq(userCustomers.customerId, customerId),
          eq(userCustomers.roleId, ACCOUNT_MANAGER_ROLE_ID)
        )
      )
      .limit(1);
    return result[0]?.user;
  }

  /**
   * Get ALL managers in the hierarchy for users assigned to a customer.
   * Uses recursive CTE to traverse up the manager chain.
   * Returns unique list of all managers (direct + indirect).
   */
  async getAllManagersForCustomer(customerId: string): Promise<User[]> {
    const result = await this.db.execute<{
      id: string;
      tenant_id: string;
      first_name: string;
      last_name: string;
      email: string;
      role_id: string | null;
      api_key_hash: string | null;
      can_login: boolean;
      timezone: string | null;
      row_status: number;
      created_at: Date;
      updated_at: Date;
      last_login_at: Date | null;
    }>(sql`
      WITH RECURSIVE manager_chain AS (
        -- Base case: direct managers of users assigned to customer
        SELECT DISTINCT um.manager_id
        FROM user_customers uc
        JOIN user_managers um ON um.user_id = uc.user_id
        WHERE uc.customer_id = ${customerId}

        UNION

        -- Recursive case: managers of managers
        SELECT um2.manager_id
        FROM manager_chain mc
        JOIN user_managers um2 ON um2.user_id = mc.manager_id
      )
      SELECT u.id, u.tenant_id, u.first_name, u.last_name, u.email,
             u.role_id, u.api_key_hash, u.can_login, u.timezone,
             u.row_status, u.created_at, u.updated_at, u.last_login_at
      FROM manager_chain mc
      JOIN users u ON u.id = mc.manager_id
      WHERE u.row_status = ${RowStatus.ACTIVE}
    `);

    // Map raw result to User type
    return result.map((row) => ({
      id: row.id,
      tenantId: row.tenant_id,
      firstName: row.first_name,
      lastName: row.last_name,
      email: row.email,
      roleId: row.role_id,
      apiKeyHash: row.api_key_hash,
      canLogin: row.can_login,
      timezone: row.timezone,
      rowStatus: row.row_status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      lastLoginAt: row.last_login_at,
    }));
  }

  /**
   * Get ALL managers for multiple customers in a single query.
   * Returns a Map of customerId -> User[] (managers).
   * Uses recursive CTE to traverse up the manager chain for all customers at once.
   */
  async getAllManagersForCustomers(customerIds: string[]): Promise<Map<string, User[]>> {
    if (customerIds.length === 0) return new Map();

    const result = await this.db.execute<{
      customer_id: string;
      id: string;
      tenant_id: string;
      first_name: string;
      last_name: string;
      email: string;
      role_id: string | null;
      api_key_hash: string | null;
      can_login: boolean;
      timezone: string | null;
      row_status: number;
      created_at: Date;
      updated_at: Date;
      last_login_at: Date | null;
    }>(sql`
      WITH RECURSIVE manager_chain AS (
        -- Base case: direct managers of users assigned to any of the customers
        SELECT DISTINCT uc.customer_id, um.manager_id
        FROM user_customers uc
        JOIN user_managers um ON um.user_id = uc.user_id
        WHERE uc.customer_id IN (${sql.join(customerIds.map(id => sql`${id}`), sql`, `)})

        UNION

        -- Recursive case: managers of managers (carry customer_id forward)
        SELECT mc.customer_id, um2.manager_id
        FROM manager_chain mc
        JOIN user_managers um2 ON um2.user_id = mc.manager_id
      )
      SELECT mc.customer_id, u.id, u.tenant_id, u.first_name, u.last_name, u.email,
             u.role_id, u.api_key_hash, u.can_login, u.timezone,
             u.row_status, u.created_at, u.updated_at, u.last_login_at
      FROM manager_chain mc
      JOIN users u ON u.id = mc.manager_id
      WHERE u.row_status = ${RowStatus.ACTIVE}
    `);

    const map = new Map<string, User[]>();
    for (const row of result) {
      const user: User = {
        id: row.id,
        tenantId: row.tenant_id,
        firstName: row.first_name,
        lastName: row.last_name,
        email: row.email,
        roleId: row.role_id,
        apiKeyHash: row.api_key_hash,
        canLogin: row.can_login,
        timezone: row.timezone,
        rowStatus: row.row_status,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        lastLoginAt: row.last_login_at,
      };
      const existing = map.get(row.customer_id) || [];
      // Deduplicate by manager ID within each customer
      if (!existing.some(u => u.id === user.id)) {
        existing.push(user);
      }
      map.set(row.customer_id, existing);
    }
    return map;
  }

  /**
   * Get account owners for multiple customers in a single query.
   * Returns a Map of customerId -> User (account owner).
   */
  async getAccountOwnersForCustomers(customerIds: string[]): Promise<Map<string, User>> {
    if (customerIds.length === 0) return new Map();

    const ACCOUNT_MANAGER_ROLE_ID = '550e8400-e29b-41d4-a716-446655440001';
    const result = await this.db
      .select({
        customerId: userCustomers.customerId,
        user: users,
      })
      .from(userCustomers)
      .innerJoin(users, eq(users.id, userCustomers.userId))
      .where(
        and(
          inArray(userCustomers.customerId, customerIds),
          eq(userCustomers.roleId, ACCOUNT_MANAGER_ROLE_ID)
        )
      );

    const map = new Map<string, User>();
    for (const row of result) {
      if (!map.has(row.customerId)) {
        map.set(row.customerId, row.user);
      }
    }
    return map;
  }

  /**
   * Find active users who can login (for dropdowns)
   */
  async findLoginableByTenantId(tenantId: string): Promise<User[]> {
    return this.db
      .select()
      .from(users)
      .where(
        and(
          eq(users.tenantId, tenantId),
          eq(users.rowStatus, RowStatus.ACTIVE),
          eq(users.canLogin, true),
          isNull(users.apiKeyHash) // Exclude API/service users
        )
      );
  }

  async getSubordinateIds(userId: string): Promise<string[]> {
    const result = await this.db
      .select({ subordinateId: userSubordinates.subordinateId })
      .from(userSubordinates)
      .where(eq(userSubordinates.userId, userId));
    return result.map(r => r.subordinateId);
  }

  async addCustomerAssignment(
    userId: string,
    customerId: string,
    roleId?: string
  ): Promise<UserCustomer> {
    const result = await this.db
      .insert(userCustomers)
      .values({ userId, customerId, roleId })
      .onConflictDoUpdate({
        target: [userCustomers.userId, userCustomers.customerId],
        set: { roleId },
      })
      .returning();
    return result[0];
  }

  async removeCustomerAssignment(userId: string, customerId: string): Promise<void> {
    await this.db
      .delete(userCustomers)
      .where(
        and(
          eq(userCustomers.userId, userId),
          eq(userCustomers.customerId, customerId)
        )
      );
  }

  async clearCustomerAssignments(userId: string): Promise<void> {
    await this.db
      .delete(userCustomers)
      .where(eq(userCustomers.userId, userId));
  }

  async setCustomerAssignments(
    userId: string,
    assignments: Array<{ customerId: string; roleId?: string }>
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      // Clear existing
      await tx
        .delete(userCustomers)
        .where(eq(userCustomers.userId, userId));

      // Add new
      if (assignments.length > 0) {
        await tx.insert(userCustomers).values(
          assignments.map((a) => ({
            userId,
            customerId: a.customerId,
            roleId: a.roleId,
          }))
        );
      }
    });
  }

  // ===========================================================================
  // Transfer (user-domain only: customer assignments + manager relationships)
  // ===========================================================================

  /**
   * Transfer customer assignments and manager relationships from one user to another.
   * Does NOT handle tasks — that's the TaskRepository's responsibility.
   */
  async transferCustomersAndManagers(
    sourceUserId: string,
    targetUserId: string
  ): Promise<{ customersTransferred: number; managersTransferred: number }> {
    return await this.db.transaction(async (tx) => {
      const customersTransferred = await this.transferCustomerAssignments(tx, sourceUserId, targetUserId);
      const managersTransferred = await this.transferManagerRelationships(tx, sourceUserId, targetUserId);
      return { customersTransferred, managersTransferred };
    });
  }

  /**
   * Move all customer assignments from source to target.
   * Merges with target's existing assignments (no duplicates).
   * Returns the number of customer assignments transferred.
   */
  private async transferCustomerAssignments(
    tx: Parameters<Parameters<Database['transaction']>[0]>[0],
    sourceUserId: string,
    targetUserId: string
  ): Promise<number> {
    const sourceAssignments = await tx
      .select()
      .from(userCustomers)
      .where(eq(userCustomers.userId, sourceUserId));

    if (sourceAssignments.length === 0) return 0;

    // Find which customers the target already has
    const targetAssignments = await tx
      .select({ customerId: userCustomers.customerId })
      .from(userCustomers)
      .where(eq(userCustomers.userId, targetUserId));
    const targetCustomerIds = new Set(targetAssignments.map((a) => a.customerId));

    // Insert only non-overlapping assignments to target
    const newAssignments = sourceAssignments.filter(
      (a) => !targetCustomerIds.has(a.customerId)
    );
    if (newAssignments.length > 0) {
      await tx.insert(userCustomers).values(
        newAssignments.map((a) => ({
          userId: targetUserId,
          customerId: a.customerId,
          roleId: a.roleId,
        }))
      );
    }

    // Remove all source assignments
    await tx
      .delete(userCustomers)
      .where(eq(userCustomers.userId, sourceUserId));

    return sourceAssignments.length;
  }

  /**
   * Redirect all subordinates of source to be subordinates of target.
   * Handles conflicts (target already manages the subordinate) and
   * self-references (target can't manage themselves).
   * Returns the number of manager relationships transferred.
   */
  private async transferManagerRelationships(
    tx: Parameters<Parameters<Database['transaction']>[0]>[0],
    sourceUserId: string,
    targetUserId: string
  ): Promise<number> {
    const sourceSubordinates = await tx
      .select({ userId: userManagers.userId })
      .from(userManagers)
      .where(eq(userManagers.managerId, sourceUserId));

    if (sourceSubordinates.length === 0) return 0;

    // Find who the target already manages (to avoid duplicate relationships)
    const targetExistingSubordinates = await tx
      .select({ userId: userManagers.userId })
      .from(userManagers)
      .where(eq(userManagers.managerId, targetUserId));
    const targetSubordinateIds = new Set(targetExistingSubordinates.map((s) => s.userId));

    let count = 0;
    for (const sub of sourceSubordinates) {
      const whereClause = and(
        eq(userManagers.userId, sub.userId),
        eq(userManagers.managerId, sourceUserId)
      );

      if (sub.userId === targetUserId || targetSubordinateIds.has(sub.userId)) {
        // Self-reference or duplicate — just remove the source row
        await tx.delete(userManagers).where(whereClause);
      } else {
        // Redirect to target
        await tx.update(userManagers).set({ managerId: targetUserId }).where(whereClause);
      }
      count++;
    }

    return count;
  }

  // ===========================================================================
  // Accessible Customers (Denormalized)
  // ===========================================================================

  async getAccessibleCustomerIds(userId: string): Promise<string[]> {
    const result = await this.db
      .select({ customerId: userAccessibleCustomers.customerId })
      .from(userAccessibleCustomers)
      .where(eq(userAccessibleCustomers.userId, userId));
    return result.map((r) => r.customerId);
  }

  async hasAccessToCustomer(userId: string, customerId: string): Promise<boolean> {
    const result = await this.db
      .select({ exists: sql<boolean>`true` })
      .from(userAccessibleCustomers)
      .where(
        and(
          eq(userAccessibleCustomers.userId, userId),
          eq(userAccessibleCustomers.customerId, customerId)
        )
      )
      .limit(1);
    return result.length > 0;
  }

  /**
   * Rebuild the user_accessible_customers table for a tenant.
   *
   * This uses a recursive CTE to traverse the manager hierarchy and compute
   * all customers each user can access (their own + all descendants').
   *
   * Called by Inngest with 5-minute debounce after any change to
   * user_managers or user_customers.
   */
  async rebuildAccessibleCustomers(tenantId: string): Promise<RebuildResult> {
    const start = Date.now();
    const rebuiltAt = new Date().toISOString();

    let accessibleCustomersCount = 0;
    let subordinatesCount = 0;

    logger.info({ tenantId }, 'Starting rebuildAccessibleCustomers');

    // Log diagnostic info before rebuild
    const activeUsersResult = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(users)
      .where(and(eq(users.tenantId, tenantId), eq(users.rowStatus, RowStatus.ACTIVE)));
    const activeUsersCount = Number(activeUsersResult[0]?.count ?? 0);

    const userCustomersResult = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(userCustomers)
      .innerJoin(users, eq(users.id, userCustomers.userId))
      .where(eq(users.tenantId, tenantId));
    const userCustomersCount = Number(userCustomersResult[0]?.count ?? 0);

    logger.info(
      { tenantId, activeUsersCount, userCustomersCount },
      'Rebuild diagnostics: source data counts'
    );

    if (userCustomersCount === 0) {
      logger.warn(
        { tenantId },
        'No user_customers entries found for tenant - user_accessible_customers will be empty'
      );
    }

    await this.db.transaction(async (tx) => {
      // Delete existing rows for this tenant
      logger.info({ tenantId }, 'Deleting existing user_accessible_customers');
      await tx.execute(sql`
        DELETE FROM user_accessible_customers
        WHERE user_id IN (
          SELECT id FROM users WHERE tenant_id = ${tenantId}
        )
      `);

      logger.info({ tenantId }, 'Deleting existing user_subordinates');
      await tx.execute(sql`
        DELETE FROM user_subordinates
        WHERE user_id IN (
          SELECT id FROM users WHERE tenant_id = ${tenantId}
        )
      `);

      // Rebuild using recursive CTE
      // 1. Start with each active user as their own "ancestor"
      // 2. Recursively follow manager relationships to find all descendants
      // 3. For each ancestor, collect all customers assigned to any descendant
      logger.info({ tenantId }, 'Inserting into user_accessible_customers');
      await tx.execute(sql`
        WITH RECURSIVE hierarchy AS (
          -- Base case: each active user is their own ancestor
          SELECT id AS ancestor_id, id AS descendant_id
          FROM users
          WHERE tenant_id = ${tenantId}
            AND row_status = ${RowStatus.ACTIVE}

          UNION ALL

          -- Recursive case: follow manager relationships downward
          -- If A manages B, then A is an ancestor of B
          SELECT h.ancestor_id, um.user_id AS descendant_id
          FROM hierarchy h
          JOIN user_managers um ON um.manager_id = h.descendant_id
          JOIN users u ON u.id = um.user_id
            AND u.tenant_id = ${tenantId}
            AND u.row_status = ${RowStatus.ACTIVE}
        )
        INSERT INTO user_accessible_customers (user_id, customer_id, rebuilt_at)
        SELECT DISTINCT h.ancestor_id, uc.customer_id, ${rebuiltAt}::timestamptz
        FROM hierarchy h
        JOIN user_customers uc ON uc.user_id = h.descendant_id
      `);

      // Rebuild user_subordinates using the same hierarchy logic
      // This stores which users are subordinates of each user (excluding self)
      logger.info({ tenantId }, 'Inserting into user_subordinates');
      await tx.execute(sql`
        WITH RECURSIVE hierarchy AS (
          -- Base case: each active user is their own ancestor
          SELECT id AS ancestor_id, id AS descendant_id
          FROM users
          WHERE tenant_id = ${tenantId}
            AND row_status = ${RowStatus.ACTIVE}

          UNION ALL

          -- Recursive case: follow manager relationships downward
          SELECT h.ancestor_id, um.user_id AS descendant_id
          FROM hierarchy h
          JOIN user_managers um ON um.manager_id = h.descendant_id
          JOIN users u ON u.id = um.user_id
            AND u.tenant_id = ${tenantId}
            AND u.row_status = ${RowStatus.ACTIVE}
        )
        INSERT INTO user_subordinates (user_id, subordinate_id, rebuilt_at)
        SELECT DISTINCT ancestor_id, descendant_id, ${rebuiltAt}::timestamptz
        FROM hierarchy
        WHERE ancestor_id != descendant_id  -- Exclude self
      `);
    });

    // Count the results after rebuild
    const accessibleCountResult = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(userAccessibleCustomers)
      .innerJoin(users, eq(users.id, userAccessibleCustomers.userId))
      .where(eq(users.tenantId, tenantId));

    accessibleCustomersCount = Number(accessibleCountResult[0]?.count ?? 0);

    const subordinatesCountResult = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(userSubordinates)
      .innerJoin(users, eq(users.id, userSubordinates.userId))
      .where(eq(users.tenantId, tenantId));

    subordinatesCount = Number(subordinatesCountResult[0]?.count ?? 0);

    const durationMs = Date.now() - start;

    logger.info(
      { tenantId, accessibleCustomersCount, subordinatesCount, durationMs },
      'Rebuilt accessible customers and subordinates'
    );

    return {
      deletedCount: 0, // Not tracked for simplicity
      insertedCount: accessibleCustomersCount + subordinatesCount,
      durationMs,
    };
  }

  // ===========================================================================
  // Customer-centric Team Assignment Methods (for import)
  // ===========================================================================

  /**
   * Replace all team assignments for a customer
   * Used during import to fully replace team members for a customer
   */
  async setTeamAssignmentsForCustomer(
    customerId: string,
    assignments: Array<{ userId: string; roleId?: string }>
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      // Delete all existing assignments for this customer
      await tx
        .delete(userCustomers)
        .where(eq(userCustomers.customerId, customerId));

      // Insert new assignments
      if (assignments.length > 0) {
        await tx.insert(userCustomers).values(
          assignments.map(a => ({
            userId: a.userId,
            customerId,
            roleId: a.roleId,
          }))
        );
      }

      logger.debug({ customerId, assignmentCount: assignments.length }, 'Replaced team assignments for customer');
    });
  }

  /**
   * Get all team assignments for a customer (for export)
   * Returns user email and role ID
   */
  async getTeamAssignmentsForCustomer(customerId: string): Promise<Array<{ email: string; roleId: string | null }>> {
    const result = await this.db
      .select({
        email: users.email,
        roleId: userCustomers.roleId,
      })
      .from(userCustomers)
      .innerJoin(users, eq(users.id, userCustomers.userId))
      .where(eq(userCustomers.customerId, customerId));

    return result;
  }

  /**
   * Reassign user-customer assignments from one customer to another.
   * Uses ON CONFLICT DO NOTHING for users already assigned to target.
   * Deletes remaining source assignments after transfer.
   */
  async reassignCustomer(tenantId: string, sourceCustomerId: string, targetCustomerId: string, tx?: Transaction): Promise<number> {
    const db = tx ?? this.db;
    const result = await db.execute(sql`
      INSERT INTO user_customers (user_id, customer_id, role_id, created_at)
      SELECT user_id, ${targetCustomerId}, role_id, NOW()
      FROM user_customers
      WHERE customer_id = ${sourceCustomerId}
      ON CONFLICT (user_id, customer_id) DO NOTHING
    `);
    await db.execute(sql`
      DELETE FROM user_customers
      WHERE customer_id = ${sourceCustomerId}
        AND customer_id IN (SELECT id FROM customers WHERE tenant_id = ${tenantId})
    `);
    return (result as any).rowCount ?? 0;
  }
}
