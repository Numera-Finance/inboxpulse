import { injectable, inject } from 'tsyringe';
import { CustomerRepository } from '../customers/repository';
import { TenantRepository } from '../tenants/repository';
import { RoleRepository } from '../roles/repository';
import { TaskRepository } from '../tasks/repository';
import { sql, desc, asc, and, isNull, inArray, type SQL } from 'drizzle-orm';
import { NotFoundError, ValidationError, isAdmin, type SearchRequest, type SearchResponse, type ImportResponse, type ImportError, getCustomerRoleByName, getCustomerRoleName } from '@crm/shared';
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
    @inject(RoleRepository) private roleRepository: RoleRepository,
    @inject(TaskRepository) private taskRepository: TaskRepository
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

    // Extract '_search' and '_hierarchy' queries for special handling
    const searchQueries = searchRequest.queries.filter(q => q.field === '_search');
    const hierarchyQueries = searchRequest.queries.filter(q => q.field === '_hierarchy');
    const otherQueries = searchRequest.queries.filter(q => q.field !== '_search' && q.field !== '_hierarchy');

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

    // Apply hierarchy filtering: non-admins see only self + subordinates
    if (hierarchyQueries.some(q => q.value === 'subordinates')) {
      if (!isAdmin(requestHeader.permissions ?? [])) {
        const subordinateIds = await this.userRepository.getSubordinateIds(requestHeader.userId);
        const allowedIds = [requestHeader.userId, ...subordinateIds];
        conditions.push(inArray(users.id, allowedIds));
      }
    }

    const where = and(...conditions);

    // Determine sort expression. Supports:
    //  - direct columns from fieldMapping (case-insensitive for text)
    //  - 'name': firstName + lastName, case-insensitive
    //  - 'role': roles.name (LEFT JOIN, case-insensitive, nulls last via COALESCE)
    //  - 'lastLoginAt': direct column
    const sortBy = searchRequest.sortBy;
    const sortDir = searchRequest.sortOrder === 'desc' ? desc : asc;
    const textFields = new Set(['firstName', 'lastName', 'email']);
    let orderByClause: SQL;
    if (sortBy === 'name') {
      orderByClause = sortDir(sql`lower(${users.firstName} || ' ' || ${users.lastName})`);
    } else if (sortBy === 'role') {
      orderByClause = sortDir(sql`lower(coalesce(${roles.name}, ''))`);
    } else if (sortBy === 'lastLoginAt') {
      orderByClause = sortDir(users.lastLoginAt);
    } else if (sortBy && this.fieldMapping[sortBy as keyof typeof this.fieldMapping]) {
      const col = this.fieldMapping[sortBy as keyof typeof this.fieldMapping];
      orderByClause = sortDir(textFields.has(sortBy) ? sql`lower(${col})` : col);
    } else {
      orderByClause = sortDir(users.createdAt);
    }

    // Pagination
    const limit = searchRequest.limit || 20;
    const offset = searchRequest.offset || 0;

    // Execute search with sorting and pagination.
    // The LEFT JOIN on roles is required by UserRepository.buildFreeformSearch
    // (matches roles.name) and by the 'role' sort branch above.
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

    // Include relations if requested
    const includeCustomerAssignments = searchRequest.include?.includes('customerAssignments');
    const includeManagers = searchRequest.include?.includes('managers');
    let items: UserWithRelations[] = userItems;

    if (includeCustomerAssignments || includeManagers) {
      items = await Promise.all(
        userItems.map(async (user) => ({
          ...user,
          ...(includeCustomerAssignments && {
            customerAssignments: await this.getCustomerAssignments(user.id),
          }),
          ...(includeManagers && {
            managers: await this.getManagers(user.id),
          }),
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

    // Get tenant domains
    const tenant = await this.tenantRepository.findById(tenantId);
    if (!tenant?.domains?.length) {
      logger.debug({ tenantId }, 'No tenant domains configured, skipping user auto-creation');
      return result;
    }

    const tenantDomains = tenant.domains.map(d => d.toLowerCase());

    // Filter participants matching any tenant domain
    const tenantParticipants = participants.filter((p) => {
      const emailDomain = p.email.split('@')[1]?.toLowerCase();
      return emailDomain && tenantDomains.includes(emailDomain);
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
          canLogin: false, // System-created users cannot login until explicitly enabled
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
  // Transfer
  // ===========================================================================

  /**
   * Transfer all responsibilities (customers, open tasks, manager relationships)
   * from one user to another.
   *
   * Orchestrates across domains:
   * - UserRepository: customer assignments + manager relationships
   * - TaskRepository: open task reassignment
   */
  async transferToUser(
    requestHeader: RequestHeader,
    sourceUserId: string,
    targetUserId: string
  ): Promise<{ customersTransferred: number; tasksTransferred: number; managersTransferred: number }> {
    if (sourceUserId === targetUserId) {
      throw new ValidationError('Cannot transfer a user to themselves');
    }

    const sourceUser = await this.userRepository.findById(sourceUserId, requestHeader);
    if (!sourceUser) {
      throw new NotFoundError('Source user', sourceUserId);
    }

    const targetUser = await this.userRepository.findById(targetUserId, requestHeader);
    if (!targetUser) {
      throw new NotFoundError('Target user', targetUserId);
    }

    // 1. Transfer customer assignments + manager relationships (user domain)
    const { customersTransferred, managersTransferred } =
      await this.userRepository.transferCustomersAndManagers(sourceUserId, targetUserId);

    // 2. Reassign open tasks (task domain)
    const tasksTransferred = await this.taskRepository.reassignOpenTasks(
      sourceUserId,
      targetUserId,
      requestHeader.tenantId
    );

    const result = { customersTransferred, tasksTransferred, managersTransferred };

    logger.info(
      {
        tenantId: requestHeader.tenantId,
        sourceUserId,
        targetUserId,
        ...result,
      },
      'Transferred user responsibilities'
    );

    await this.queueAccessRebuild(requestHeader.tenantId);

    return result;
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
  ): Promise<ImportResponse> {
    const { parseCSV, parseManagerEmails, groupImportRows } = await import('./import-export');
    const rows = parseCSV(csvContent);
    const grouped = groupImportRows(rows);

    const errors: ImportError[] = [];
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

  /**
   * Import users from a file (CSV or Excel)
   * Supports simple format: name, email, role, department
   */
  async importUsersFromFile(
    tenantId: string,
    file: File
  ): Promise<ImportResponse> {
    const errors: ImportError[] = [];
    let imported = 0;

    logger.info({ fileName: file.name, fileSize: file.size }, 'Starting user import');

    // Parse file based on type
    let records: Array<Record<string, any>>;

    const isExcel = file.name.endsWith('.xlsx') || file.name.endsWith('.xls');

    if (isExcel) {
      // Parse Excel file
      const XLSX = await import('xlsx');
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: 'array' });
      const firstSheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[firstSheetName];
      records = XLSX.utils.sheet_to_json(worksheet, { defval: '' });
      logger.info({ sheetName: firstSheetName, recordCount: records.length }, 'Parsed Excel file');
      if (records.length > 0) {
        logger.info({ columns: Object.keys(records[0]) }, 'Excel columns found');
      }
    } else {
      // Parse CSV file
      const content = await file.text();
      const lines = content.split('\n').filter(line => line.trim() !== '');
      if (lines.length < 2) {
        return { imported: 0, errors: [{ row: 0, email: '', error: 'File is empty or has no data rows' }] };
      }

      // Parse header
      const headers = this.parseCSVLine(lines[0]).map(h => h.trim().toLowerCase());

      // Parse data rows
      records = [];
      for (let i = 1; i < lines.length; i++) {
        const values = this.parseCSVLine(lines[i]);
        const record: Record<string, string> = {};
        headers.forEach((header, index) => {
          record[header] = values[index]?.trim() || '';
        });
        records.push(record);
      }
    }

    // Normalize column names (handle case variations)
    records = records.map(record => {
      const normalized: Record<string, any> = {};
      for (const [key, value] of Object.entries(record)) {
        normalized[key.toLowerCase().trim()] = value;
      }
      return normalized;
    });

    logger.info({ recordCount: records.length }, 'Processing records');

    // Process records
    for (let i = 0; i < records.length; i++) {
      const record = records[i];
      const rowNum = i + 2; // +2 for 1-based index and header row

      try {
        // Get email (required)
        const email = String(record.email || '').trim().toLowerCase();
        if (!email) {
          errors.push({ row: rowNum, email: '', error: 'Email is required' });
          continue;
        }

        // Parse name into first and last name
        const fullName = String(record.name || '').trim();
        if (!fullName) {
          errors.push({ row: rowNum, email, error: 'Name is required' });
          continue;
        }

        const nameParts = fullName.split(/\s+/);
        const firstName = nameParts[0] || '';
        const lastName = nameParts.slice(1).join(' ') || '';

        // Look up role by name if provided
        let roleId: string | undefined;
        const roleName = String(record.role || '').trim();
        if (roleName) {
          const role = await this.roleRepository.findByName(tenantId, roleName);
          if (role) {
            roleId = role.id;
          } else {
            // Role not found - log warning but continue import
            logger.warn({ roleName, email, row: rowNum }, 'Role not found, skipping role assignment');
          }
        }

        // Upsert user
        await this.userRepository.upsert({
          tenantId,
          firstName,
          lastName,
          email,
          roleId,
          rowStatus: RowStatus.ACTIVE,
        });

        imported++;
      } catch (error: any) {
        logger.error({ error: error.message, row: rowNum }, 'Error importing user');
        errors.push({
          row: rowNum,
          email: String(record.email || ''),
          error: error.message || 'Unknown error',
        });
      }
    }

    // Queue rebuild after import
    if (imported > 0) {
      await this.queueAccessRebuild(tenantId);
    }

    logger.info({ imported, errorCount: errors.length }, 'User import completed');
    return { imported, errors };
  }

  /**
   * Parse a single CSV line, handling quoted fields
   */
  private parseCSVLine(line: string): string[] {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      const nextChar = line[i + 1];

      if (char === '"') {
        if (inQuotes && nextChar === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === ',' && !inQuotes) {
        result.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }

    result.push(current.trim());
    return result;
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
            const domains = await this.customerRepository.getDomains(assignment.customerId, tenantId);
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
