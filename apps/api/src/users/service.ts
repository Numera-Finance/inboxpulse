import { injectable, inject } from 'tsyringe';
import { CustomerRepository } from '../customers/repository';
import { TenantRepository } from '../tenants/repository';
import { RoleRepository } from '../roles/repository';
import { sql, desc, asc, and, isNull } from 'drizzle-orm';
import { NotFoundError, type SearchRequest, type SearchResponse, getCustomerRoleByName, getCustomerRoleName } from '@crm/shared';
import { scopedSearch } from '@crm/database';
import type { Database } from '@crm/database';
import { UserRepository } from './repository';
import { inngest } from '../inngest/instance';
import { logger } from '../utils/logger';
import { users, RowStatus } from './schema';
import { roles, type Role } from '../roles/schema';
import type { User, NewUser, UserCustomer } from './schema';
import type { RequestHeader } from '@crm/shared';
import { eq } from 'drizzle-orm';

export interface UserWithRelations extends User {
  managers?: User[];
  customerAssignments?: UserCustomer[];
  role?: Role | null;
}

@injectable()
export class UserService {
  private fieldMapping: {
    tenantId: typeof users.tenantId;
    firstName: typeof users.firstName;
    lastName: typeof users.lastName;
    email: typeof users.email;
    rowStatus: typeof users.rowStatus;
    createdAt: typeof users.createdAt;
    updatedAt: typeof users.updatedAt;
  };

  constructor(
    @inject('Database') private db: Database,
    @inject(UserRepository) private userRepository: UserRepository,
    @inject(CustomerRepository) private customerRepository: CustomerRepository,
    @inject(TenantRepository) private tenantRepository: TenantRepository,
    @inject(RoleRepository) private roleRepository: RoleRepository
  ) {
    // Initialize field mapping
    this.fieldMapping = {
      tenantId: users.tenantId,
      firstName: users.firstName,
      lastName: users.lastName,
      email: users.email,
      rowStatus: users.rowStatus,
      createdAt: users.createdAt,
      updatedAt: users.updatedAt,
    };
  }

  // ===========================================================================
  // User CRUD
  // ===========================================================================

  async getById(requestHeader: RequestHeader, id: string): Promise<User | undefined> {
    return this.userRepository.findById(id, requestHeader);
  }

  async getByEmail(tenantId: string, email: string): Promise<User | undefined> {
    return this.userRepository.findByEmail(tenantId, email);
  }

  async getByTenantId(tenantId: string): Promise<User[]> {
    return this.userRepository.findByTenantId(tenantId);
  }

  async findByEmails(tenantId: string, emails: string[]): Promise<Map<string, User>> {
    return this.userRepository.findByEmails(tenantId, emails);
  }

  async search(
    requestHeader: RequestHeader,
    searchRequest: SearchRequest
  ): Promise<SearchResponse<UserWithRelations>> {
    const context = {
      tenantId: requestHeader.tenantId,
      userId: requestHeader.userId,
    };

    // Extract '_search' queries for freeform search
    const searchQueries = searchRequest.queries.filter(q => q.field === '_search');
    const otherQueries = searchRequest.queries.filter(q => q.field !== '_search');

    // Build scoped search query with tenant isolation
    // Also exclude API/service users (those with apiKeyHash set)
    const scopedWhere = scopedSearch(this.db, users, this.fieldMapping, context)
      .applyQueries(otherQueries)
      .build();

    // Build conditions including freeform search
    const conditions = [scopedWhere, isNull(users.apiKeyHash)];
    for (const query of searchQueries) {
      if (typeof query.value === 'string') {
        const freeformCondition = this.userRepository.buildFreeformSearch(query.value);
        if (freeformCondition) {
          conditions.push(freeformCondition);
        }
      }
    }

    const where = and(...conditions);

    // Determine sort column
    const sortBy = searchRequest.sortBy as keyof typeof this.fieldMapping | undefined;
    const sortColumn = sortBy && this.fieldMapping[sortBy]
      ? this.fieldMapping[sortBy]
      : users.createdAt;
    const orderByClause = searchRequest.sortOrder === 'asc'
      ? asc(sortColumn)
      : desc(sortColumn);

    // Pagination
    const limit = searchRequest.limit || 20;
    const offset = searchRequest.offset || 0;

    // Execute search with sorting and pagination
    // Join with roles to get role name
    const results = await this.db
      .select({
        user: users,
        role: roles,
      })
      .from(users)
      .leftJoin(roles, eq(users.roleId, roles.id))
      .where(where)
      .orderBy(orderByClause)
      .limit(limit)
      .offset(offset);

    // Map results to include role
    const userItems = results.map((r) => ({
      ...r.user,
      role: r.role,
    }));

    // Get total count
    const countResult = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(users)
      .where(where);

    const total = Number(countResult[0]?.count ?? 0);

    // Include customer assignments if requested
    const includeCustomerAssignments = searchRequest.include?.includes('customerAssignments');
    let items: UserWithRelations[] = userItems;

    if (includeCustomerAssignments) {
      items = await Promise.all(
        userItems.map(async (user) => ({
          ...user,
          customerAssignments: await this.getCustomerAssignments(user.id),
        }))
      );
    }

    return {
      items,
      total,
      limit,
      offset,
    };
  }

  async create(tenantId: string, data: Omit<NewUser, 'tenantId'>): Promise<User> {
    const user = await this.userRepository.create({
      ...data,
      tenantId,
    });

    logger.info(
      { tenantId, userId: user.id, email: user.email },
      'Created user'
    );

    return user;
  }

  async update(
    id: string,
    data: Partial<Omit<NewUser, 'tenantId'>>
  ): Promise<User | undefined> {
    const user = await this.userRepository.update(id, data);

    if (user) {
      logger.info({ userId: id }, 'Updated user');
    }

    return user;
  }

  async markActive(tenantId: string, id: string): Promise<User> {
    const user = await this.userRepository.update(id, {
      rowStatus: RowStatus.ACTIVE,
    });

    if (!user) {
      throw new NotFoundError('User', id);
    }

    logger.info({ tenantId, userId: id }, 'Marked user as active');
    await this.queueAccessRebuild(tenantId);

    return user;
  }

  async markInactive(tenantId: string, id: string): Promise<User> {
    const user = await this.userRepository.update(id, {
      rowStatus: RowStatus.INACTIVE,
    });

    if (!user) {
      throw new NotFoundError('User', id);
    }

    logger.info({ tenantId, userId: id }, 'Marked user as inactive');
    await this.queueAccessRebuild(tenantId);

    return user;
  }

  /**
   * Ensure users exist for email addresses matching the tenant domain.
   * Called during email processing to auto-create users from email participants.
   *
   * @param tenantId - The tenant ID
   * @param participants - Array of email participants with email and optional name
   * @returns Map of email address to user (existing or newly created)
   */
  async ensureUsersFromEmails(
    tenantId: string,
    participants: Array<{ email: string; name?: string }>
  ): Promise<Map<string, User>> {
    const result = new Map<string, User>();

    if (participants.length === 0) {
      return result;
    }

    // Get tenant domain
    const tenant = await this.tenantRepository.findById(tenantId);
    if (!tenant?.domain) {
      logger.debug({ tenantId }, 'No tenant domain configured, skipping user auto-creation');
      return result;
    }

    const tenantDomain = tenant.domain.toLowerCase();

    // Filter participants matching tenant domain
    const tenantParticipants = participants.filter((p) => {
      const emailDomain = p.email.split('@')[1]?.toLowerCase();
      return emailDomain === tenantDomain;
    });

    if (tenantParticipants.length === 0) {
      return result;
    }

    // Get emails list
    const emails = tenantParticipants.map((p) => p.email.toLowerCase());

    // Check which users already exist
    const existingUsers = await this.userRepository.findByEmails(tenantId, emails);

    // Add existing users to result
    for (const [email, user] of existingUsers) {
      result.set(email, user);
    }

    // Find emails that need user creation
    const emailsToCreate = tenantParticipants.filter(
      (p) => !existingUsers.has(p.email.toLowerCase())
    );

    if (emailsToCreate.length === 0) {
      return result;
    }

    // Get default "User" role for new users
    const userRole = await this.roleRepository.findByName(tenantId, 'User');

    // Create users for remaining emails
    for (const participant of emailsToCreate) {
      try {
        // Parse name into first/last
        const { firstName, lastName } = this.parseEmailName(participant.email, participant.name);

        const newUser = await this.userRepository.create({
          tenantId,
          firstName,
          lastName,
          email: participant.email.toLowerCase(),
          roleId: userRole?.id,
          rowStatus: RowStatus.ACTIVE,
        });

        result.set(participant.email.toLowerCase(), newUser);

        logger.info(
          { tenantId, userId: newUser.id, email: newUser.email },
          'Auto-created user from email'
        );
      } catch (error: any) {
        // Log but don't fail - might be race condition with concurrent email processing
        logger.warn(
          { tenantId, email: participant.email, error: error.message },
          'Failed to auto-create user from email'
        );
      }
    }

    return result;
  }

  /**
   * Parse email name into first and last name
   */
  private parseEmailName(
    email: string,
    displayName?: string
  ): { firstName: string; lastName: string } {
    if (displayName && displayName.trim()) {
      const parts = displayName.trim().split(/\s+/);
      if (parts.length >= 2) {
        return {
          firstName: parts[0],
          lastName: parts.slice(1).join(' '),
        };
      }
      return { firstName: parts[0], lastName: '' };
    }

    // Fallback: extract from email local part (before @)
    const localPart = email.split('@')[0];
    // Handle common formats: first.last, first_last, firstlast
    const nameParts = localPart.split(/[._]/);
    if (nameParts.length >= 2) {
      return {
        firstName: this.capitalize(nameParts[0]),
        lastName: this.capitalize(nameParts.slice(1).join(' ')),
      };
    }
    return { firstName: this.capitalize(localPart), lastName: '' };
  }

  private capitalize(str: string): string {
    return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
  }

  // ===========================================================================
  // Manager Relationships
  // ===========================================================================

  async getManagers(userId: string): Promise<User[]> {
    return this.userRepository.getManagers(userId);
  }

  async getDirectReports(managerId: string): Promise<User[]> {
    return this.userRepository.getDirectReports(managerId);
  }

  async addManager(
    tenantId: string,
    userId: string,
    managerId: string
  ): Promise<void> {
    await this.userRepository.addManager(userId, managerId);

    logger.info(
      { tenantId, userId, managerId },
      'Added manager relationship'
    );

    await this.queueAccessRebuild(tenantId);
  }

  async removeManager(
    tenantId: string,
    userId: string,
    managerId: string
  ): Promise<void> {
    await this.userRepository.removeManager(userId, managerId);

    logger.info(
      { tenantId, userId, managerId },
      'Removed manager relationship'
    );

    await this.queueAccessRebuild(tenantId);
  }

  async setManagers(
    tenantId: string,
    userId: string,
    managerIds: string[]
  ): Promise<void> {
    await this.userRepository.setManagers(userId, managerIds);

    logger.info(
      { tenantId, userId, managerCount: managerIds.length },
      'Set managers for user'
    );

    await this.queueAccessRebuild(tenantId);
  }

  // ===========================================================================
  // Customer Assignments
  // ===========================================================================

  async getCustomerAssignments(userId: string): Promise<UserCustomer[]> {
    return this.userRepository.getCustomerAssignments(userId);
  }

  /**
   * Get all users assigned to a specific customer
   */
  async getUsersByCustomer(customerId: string): Promise<Array<User & { roleId: string | null }>> {
    return this.userRepository.getUsersByCustomer(customerId);
  }

  async addCustomerAssignment(
    tenantId: string,
    userId: string,
    customerId: string,
    roleId?: string
  ): Promise<void> {
    await this.userRepository.addCustomerAssignment(userId, customerId, roleId);

    logger.info(
      { tenantId, userId, customerId, roleId },
      'Added customer assignment'
    );

    await this.queueAccessRebuild(tenantId);
  }

  async removeCustomerAssignment(
    tenantId: string,
    userId: string,
    customerId: string
  ): Promise<void> {
    await this.userRepository.removeCustomerAssignment(userId, customerId);

    logger.info(
      { tenantId, userId, customerId },
      'Removed customer assignment'
    );

    await this.queueAccessRebuild(tenantId);
  }

  async setCustomerAssignments(
    tenantId: string,
    userId: string,
    assignments: Array<{ customerId: string; roleId?: string }>
  ): Promise<void> {
    await this.userRepository.setCustomerAssignments(userId, assignments);

    logger.info(
      { tenantId, userId, assignmentCount: assignments.length },
      'Set customer assignments for user'
    );

    await this.queueAccessRebuild(tenantId);
  }

  // ===========================================================================
  // Access Control
  // ===========================================================================

  async getAccessibleCustomerIds(userId: string): Promise<string[]> {
    return this.userRepository.getAccessibleCustomerIds(userId);
  }

  async hasAccessToCustomer(userId: string, customerId: string): Promise<boolean> {
    return this.userRepository.hasAccessToCustomer(userId, customerId);
  }

  /**
   * Get user's permissions from their role
   */
  async getUserPermissions(tenantId: string, userId: string): Promise<number[]> {
    const user = await this.userRepository.findById(userId, { tenantId, userId, permissions: [] });
    if (!user || !user.roleId) {
      return [];
    }

    const role = await this.roleRepository.findById(user.roleId);
    return role?.permissions ?? [];
  }

  /**
   * Check if user has any customer assignments
   */
  async hasAnyCustomers(userId: string): Promise<boolean> {
    const assignments = await this.userRepository.getCustomerAssignments(userId);
    return assignments.length > 0;
  }

  /**
   * Check if user has a manager
   */
  async hasManager(userId: string): Promise<boolean> {
    const managers = await this.userRepository.getManagers(userId);
    return managers.length > 0;
  }

  // ===========================================================================
  // Rebuild (called by Inngest)
  // ===========================================================================

  async rebuildAccessibleCustomers(tenantId: string): Promise<void> {
    await this.userRepository.rebuildAccessibleCustomers(tenantId);
  }

  // ===========================================================================
  // Import/Export
  // ===========================================================================

  async importUsers(
    tenantId: string,
    csvContent: string
  ): Promise<{ imported: number; errors: Array<{ row: number; email: string; error: string }> }> {
    const { parseCSV, parseManagerEmails, groupImportRows } = await import('./import-export');
    const rows = parseCSV(csvContent);
    const grouped = groupImportRows(rows);

    const errors: Array<{ row: number; email: string; error: string }> = [];
    let imported = 0;

    for (const [email, userRows] of grouped.entries()) {
      try {
        // Use first row for user data
        const firstRow = userRows[0];

        // Create or update user
        const user = await this.userRepository.upsert({
          tenantId,
          firstName: firstRow.firstName,
          lastName: firstRow.lastName,
          email: firstRow.email,
          rowStatus: firstRow.active === '1' ? RowStatus.INACTIVE : RowStatus.ACTIVE,
        });

        // Add managers
        const managerEmails = parseManagerEmails(firstRow.managerEmails);
        if (managerEmails.length > 0) {
          const managerIds: string[] = [];
          for (const managerEmail of managerEmails) {
            const manager = await this.getByEmail(tenantId, managerEmail);
            if (manager) {
              managerIds.push(manager.id);
            } else {
              errors.push({
                row: rows.indexOf(firstRow) + 1,
                email: firstRow.email,
                error: `Manager not found: ${managerEmail}`,
              });
            }
          }
          if (managerIds.length > 0) {
            await this.setManagers(tenantId, user.id, managerIds);
          }
        }

        // Add customers (one row per customer)
        const assignments: Array<{ customerId: string; roleId?: string }> = [];
        const seenCustomerIds = new Set<string>();
        for (const row of userRows) {
          if (row.customerDomain && row.customerDomain.trim() !== '') {
            const customer = await this.customerRepository.findByDomain(tenantId, row.customerDomain);
            if (customer) {
              // Avoid duplicates
              if (!seenCustomerIds.has(customer.id)) {
                // Parse role name to roleId
                let roleId: string | undefined;
                if (row.role && row.role.trim() !== '') {
                  const role = getCustomerRoleByName(row.role);
                  if (role) {
                    roleId = role.id;
                  } else {
                    errors.push({
                      row: rows.indexOf(row) + 1,
                      email: row.email,
                      error: `Invalid role: ${row.role}`,
                    });
                  }
                }
                assignments.push({ customerId: customer.id, roleId });
                seenCustomerIds.add(customer.id);
              }
            } else {
              errors.push({
                row: rows.indexOf(row) + 1,
                email: row.email,
                error: `Customer not found: ${row.customerDomain}`,
              });
            }
          }
        }
        if (assignments.length > 0) {
          await this.setCustomerAssignments(tenantId, user.id, assignments);
        }

        imported++;
      } catch (error: any) {
        errors.push({
          row: rows.indexOf(userRows[0]) + 1,
          email: userRows[0].email,
          error: error.message || 'Unknown error',
        });
      }
    }

    // Queue rebuild after import
    await this.queueAccessRebuild(tenantId);

    return { imported, errors };
  }

  async exportUsers(tenantId: string): Promise<string> {
    const { generateCSV } = await import('./import-export');
    const users = await this.getByTenantId(tenantId);

    const exportData = await Promise.all(
      users.map(async (user) => {
        const managers = await this.getManagers(user.id);
        const customerAssignments = await this.getCustomerAssignments(user.id);

        // Get customer domains and role names
        const customers = await Promise.all(
          customerAssignments.map(async (assignment) => {
            const domains = await this.customerRepository.getDomains(assignment.customerId);
            return {
              domain: domains.length > 0 ? domains[0] : '',
              roleName: getCustomerRoleName(assignment.roleId),
            };
          })
        );

        return {
          user,
          managers: managers.map((m) => ({ email: m.email })),
          customers: customers.filter((c) => c.domain && c.domain.length > 0),
        };
      })
    );

    return generateCSV(exportData);
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  /**
   * Queue a rebuild of the user_accessible_customers table.
   * Uses Inngest debounce (5 minutes) to batch rapid changes.
   */
  private async queueAccessRebuild(tenantId: string): Promise<void> {
    try {
      await inngest.send({
        name: 'user/access.rebuild',
        data: { tenantId },
      });

      logger.debug({ tenantId }, 'Queued access rebuild');
    } catch (error) {
      // Log but don't fail the operation - rebuild will happen eventually
      logger.error(
        { error, tenantId },
        'Failed to queue access rebuild'
      );
    }
  }
}
