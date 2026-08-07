import { injectable, inject } from 'tsyringe';
import { z } from 'zod';
import { eq, and, sql, type SQL, type Column } from 'drizzle-orm';
import { format } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import { type RequestHeader, getServiceAuthHeaders, CUSTOMER_ROLES, Permission, NotFoundError, InvalidInputError } from '@crm/shared';
import type { Database } from '@crm/database';
import { TaskRepository, type TaskWithRelations, type TaskCommentWithUser } from './repository';
import { TaskStatus, type Task, type TaskComment, tasks } from './schema';
import { customers } from '../customers/schema';
import { users } from '../users/schema';
import { UserRepository } from '../users/repository';
import { ContactRepository } from '../contacts/repository';
import { logger } from '../utils/logger';
import { getEnv } from '../env';

// =============================================================================
// Zod Schemas for request validation
// =============================================================================

export const taskSearchRequestSchema = z.object({
  status: z.enum(['open', 'done']).optional(),
  assignedToId: z.string().optional(),
  customerId: z.string().uuid().optional(),
  emailId: z.string().uuid().optional(),
  search: z.string().optional(),
  sortBy: z.enum(['createdAt', 'updatedAt']).optional(),
  sortOrder: z.enum(['asc', 'desc']).optional(),
  limit: z.number().int().positive().max(100).optional(),
  offset: z.number().int().min(0).optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  signal: z.enum(['positive', 'negative', 'neutral', 'upsell', 'churn', 'tat']).optional(),
});

export const taskExportRequestSchema = z.object({
  status: z.enum(['open', 'done']).optional(),
  assignedToId: z.string().optional(),
  customerId: z.string().uuid().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  signal: z.enum(['positive', 'negative', 'neutral', 'upsell', 'churn', 'tat']).optional(),
});

export const createTaskRequestSchema = z.object({
  customerId: z.string().uuid(),
  title: z.string().min(1).max(500),
  emailId: z.string().uuid().optional(),
  assignedToId: z.string().uuid().optional(),
});

export const reassignTaskRequestSchema = z.object({
  assignedToId: z.string().uuid().nullable(),
});

export const addCommentRequestSchema = z.object({
  content: z.string().min(1).max(5000),
});

// Problem/resolution are required for sentiment-driven escalations (the UI's
// MarkDoneDialog enforces non-empty client-side), but the TAT-breach resolve
// path is a status acknowledgement and supplies them as empty strings. Allow
// empty here so that path doesn't fail server-side validation.
export const markDoneRequestSchema = z.object({
  problem: z.string().max(5000),
  resolution: z.string().max(5000),
});

// =============================================================================
// Derived types from Zod schemas
// =============================================================================

export type TaskSearchRequest = z.infer<typeof taskSearchRequestSchema>;
export type TaskExportRequest = z.infer<typeof taskExportRequestSchema>;
export type CreateTaskRequest = z.infer<typeof createTaskRequestSchema>;
export type ReassignTaskRequest = z.infer<typeof reassignTaskRequestSchema>;
export type AddCommentRequest = z.infer<typeof addCommentRequestSchema>;
export type MarkDoneRequest = z.infer<typeof markDoneRequestSchema>;

export interface TaskSearchResponse {
  items: TaskWithRelations[];
  total: number;
  limit: number;
  offset: number;
}

// =============================================================================
// Escalation Notification Types
// =============================================================================

export interface EscalationMetrics {
  new: number;
  open1Day: number;
  open3Days: number;
  openMoreThan3Days: number;
}

export interface EscalationItem {
  id: string;
  customer: string;
  subject: string;
  dateOpened: string;
  assignedTo: string;
  accountOwner: string;
  detailsUrl: string;
}

export interface ManagerEscalationData {
  manager: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    timezone: string | null;
  };
  escalations: EscalationItem[];
  metrics: EscalationMetrics;
}

@injectable()
export class TaskService {
  constructor(
    @inject('Database') private db: Database,
    @inject(TaskRepository) private taskRepository: TaskRepository,
    @inject(UserRepository) private userRepository: UserRepository,
    @inject(ContactRepository) private contactRepository: ContactRepository
  ) { }

  /**
   * Search tasks with filters
   */
  async search(
    header: RequestHeader,
    request: TaskSearchRequest
  ): Promise<TaskSearchResponse> {
    const status = request.status === 'open' ? TaskStatus.OPEN
      : request.status === 'done' ? TaskStatus.DONE
        : undefined;

    // Convert date strings to Date objects for repository
    const dateFrom = request.dateFrom ? new Date(request.dateFrom) : undefined;
    const dateTo = request.dateTo ? new Date(request.dateTo) : undefined;

    const { items, total } = await this.taskRepository.search(header, {
      status,
      assignedToId: request.assignedToId,
      customerId: request.customerId,
      emailId: request.emailId,
      search: request.search,
      sortBy: request.sortBy,
      sortOrder: request.sortOrder,
      limit: request.limit,
      offset: request.offset,
      dateFrom,
      dateTo,
      signal: request.signal,
    });

    return {
      items,
      total,
      limit: request.limit || 20,
      offset: request.offset || 0,
    };
  }

  /**
   * Export tasks with comments - no pagination limit
   */
  async exportWithComments(
    header: RequestHeader,
    request: TaskExportRequest
  ): Promise<Array<TaskWithRelations & {
    comments: Array<{ userName: string; content: string; createdAt: Date }>;
    contactRoles: { bookKeeping: string; accountant: string; controller: string; srController: string };
  }>> {
    const status = request.status === 'open' ? TaskStatus.OPEN
      : request.status === 'done' ? TaskStatus.DONE
        : undefined;

    const dateFrom = request.dateFrom ? new Date(request.dateFrom) : undefined;
    const dateTo = request.dateTo ? new Date(request.dateTo) : undefined;

    logger.info({ request, status, dateFrom, dateTo }, 'Export request');

    const result = await this.taskRepository.exportWithComments(header, {
      status,
      assignedToId: request.assignedToId,
      customerId: request.customerId,
      dateFrom,
      dateTo,
      signal: request.signal,
    });

    // Fetch contacts for all unique customers to derive role columns
    const uniqueCustomerIds = [...new Set(result.map(t => t.customerId).filter(Boolean))];
    const contactsByCustomer = new Map<string, Array<{ name: string | null; title: string | null }>>();
    await Promise.all(
      uniqueCustomerIds.map(async (customerId) => {
        try {
          const contacts = await this.contactRepository.findByCustomerId(customerId);
          contactsByCustomer.set(customerId, contacts);
        } catch {
          // skip if fetch fails
        }
      })
    );

    const enriched = result.map(task => ({
      ...task,
      contactRoles: this.matchContactRoles(contactsByCustomer.get(task.customerId)),
    }));

    logger.info({
      totalTasks: result.length,
      tasksWithComments: result.filter(t => t.comments.length > 0).length,
      totalComments: result.reduce((sum, t) => sum + t.comments.length, 0),
    }, 'Export result');

    return enriched;
  }

  private matchContactRoles(
    contacts?: Array<{ name: string | null; title: string | null }>
  ): { bookKeeping: string; accountant: string; controller: string; srController: string } {
    const result = { bookKeeping: '', accountant: '', controller: '', srController: '' };
    if (!contacts) return result;

    const matchers: Array<{ key: keyof typeof result; patterns: string[] }> = [
      { key: 'srController', patterns: ['sr controller', 'sr. controller', 'senior controller'] },
      { key: 'controller', patterns: ['controller'] },
      { key: 'bookKeeping', patterns: ['book keeping', 'bookkeeping', 'book keeper', 'bookkeeper'] },
      { key: 'accountant', patterns: ['accountant'] },
    ];

    for (const contact of contacts) {
      const titleLower = (contact.title || '').toLowerCase().trim();
      if (!titleLower) continue;
      for (const { key, patterns } of matchers) {
        if (result[key]) continue;
        if (patterns.some(p => titleLower.includes(p))) {
          result[key] = contact.name || contact.title || '';
        }
      }
    }
    return result;
  }

  /**
   * Get task by ID with relations
   */
  async getById(header: RequestHeader, id: string): Promise<TaskWithRelations | undefined> {
    return this.taskRepository.findByIdScoped(header, id);
  }

  /**
   * Create a new task
   */
  async create(header: RequestHeader, request: CreateTaskRequest): Promise<Task> {
    logger.info({ customerId: request.customerId, title: request.title }, 'Creating task');

    // Same hole as reassign(): the schema only checks the id parses as a UUID.
    await this.assertAssignableUser(header, request.assignedToId ?? null);

    const task = await this.taskRepository.create({
      tenantId: header.tenantId,
      customerId: request.customerId,
      title: request.title,
      emailId: request.emailId,
      assignedToId: request.assignedToId,
      createdBySystem: false,
    });

    // Send notification if task is assigned. Unscoped read for the same reason
    // as reassign(): the assignee may sit outside the creator's hierarchy.
    if (task.assignedToId) {
      const taskWithRelations = await this.taskRepository.findByIdWithRelations(header, task.id);
      if (taskWithRelations) {
        // Get assigner name (the user who created the task)
        const assigner = await this.userRepository.findById(header.userId);
        const assignerName = assigner ? `${assigner.firstName} ${assigner.lastName}` : undefined;
        // Fire and forget - don't block on notification
        this.sendTaskAssignedNotification(taskWithRelations, assignerName).catch(() => { });
      }
    }

    return task;
  }

  /**
   * Create task from negative email (system-created).
   * Auto-assigns to the customer's controller or account manager if available.
   */
  async createFromEmail(
    tenantId: string,
    customerId: string,
    emailId: string,
    emailSubject: string
  ): Promise<Task> {
    // Check if task already exists for this email
    const existing = await this.taskRepository.findByEmailId(emailId);
    if (existing) {
      logger.debug({ emailId }, 'Task already exists for email');
      return existing;
    }

    logger.info({ emailId, customerId }, 'Auto-creating task from negative email');

    const task = await this.taskRepository.create({
      tenantId,
      customerId,
      emailId,
      title: emailSubject || 'Negative sentiment email',
      createdBySystem: true,
    });

    // Auto-assign to customer's controller or account manager
    await this.autoAssignTask(tenantId, task.id, customerId, emailId);

    return task;
  }

  /**
   * Auto-assign a system-created task to the customer's team member.
   *
   * Priority: Controller > Account Manager.
   * Uses a system RequestHeader to call reassign() with the same semantics
   * as the UI (notifications, logging).
   * Non-blocking — logs and continues on failure.
   */
  private async autoAssignTask(
    tenantId: string,
    taskId: string,
    customerId: string,
    emailId: string
  ): Promise<void> {
    try {
      // Active members only — getUsersByCustomer does not filter on rowStatus,
      // and reassign() now rejects a deactivated assignee, so an offboarded
      // Controller would otherwise block auto-assignment for the whole customer
      // instead of falling through to the Account Manager.
      const teamMembers = (await this.userRepository.getUsersByCustomer(customerId))
        .filter(member => member.rowStatus === 0);
      if (teamMembers.length === 0) {
        logger.debug({ taskId, customerId }, 'No active team members for customer, skipping auto-assign');
        return;
      }

      // Priority 1: Controller
      const controller = teamMembers.find(m => m.roleId === CUSTOMER_ROLES.CONTROLLER.id);
      // Priority 2: Account Manager
      const accountManager = teamMembers.find(m => m.roleId === CUSTOMER_ROLES.ACCOUNT_MANAGER.id);

      const assignee = controller || accountManager;
      if (!assignee) {
        logger.debug({ taskId, customerId }, 'No controller or account manager found, skipping auto-assign');
        return;
      }

      const systemHeader: RequestHeader = {
        tenantId,
        userId: '00000000-0000-0000-0000-000000000000',
        permissions: [Permission.ADMIN],
      };

      await this.reassign(systemHeader, taskId, assignee.id);

      logger.info(
        { taskId, emailId, customerId, assigneeId: assignee.id, role: controller ? 'Controller' : 'Account Manager' },
        'Auto-assigned task to customer team member'
      );
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn(
        { taskId, emailId, customerId, error: message },
        'Failed to auto-assign task (non-blocking)'
      );
    }
  }

  /**
   * Mark task as done
   */
  async markDone(header: RequestHeader, id: string, problem: string, resolution: string): Promise<Task | undefined> {
    logger.info({ taskId: id }, 'Marking task as done');
    return this.taskRepository.markDone(header, id, problem, resolution);
  }

  /**
   * Reopen task
   */
  async reopen(header: RequestHeader, id: string): Promise<Task | undefined> {
    logger.info({ taskId: id }, 'Reopening task');
    return this.taskRepository.reopen(header, id);
  }

  /**
   * Reassign task to another user
   */
  async reassign(header: RequestHeader, id: string, assignedToId: string | null): Promise<TaskWithRelations | undefined> {
    logger.info({ taskId: id, assignedToId }, 'Reassigning task');

    // The route only validates that assignedToId parses as a UUID, and the
    // repository authorizes the caller against the task, never the assignee.
    // Without this the column's FK (users.id, which is not tenant-scoped)
    // accepts a deactivated user — leaving the escalation with an assignee who
    // cannot log in — or a user from another tenant, whose address would then
    // receive an assignment email naming this tenant's customer and subject.
    await this.assertAssignableUser(header, assignedToId);

    const result = await this.taskRepository.reassign(header, id, assignedToId);
    if (!result) return undefined;

    const { previousAssigneeId } = result;

    // Fetch full task with relations (customerName, assignedToName, etc.).
    // Deliberately unscoped: reassign() already authorized the caller against
    // the *pre-update* task, and handing an escalation to someone outside the
    // caller's hierarchy would now fail a scoped re-read — silently dropping
    // both the response and the assignment notification.
    const taskWithRelations = await this.taskRepository.findByIdWithRelations(header, result.id);
    if (!taskWithRelations) return undefined;

    // Name of whoever performed the change, for either notification.
    const actor = await this.userRepository.findById(header.userId);
    const actorName = actor ? `${actor.firstName} ${actor.lastName}` : undefined;

    // Never notify someone about their own action — taking an escalation or
    // dropping one you hold are both things you just did on screen.
    if (assignedToId && assignedToId !== header.userId) {
      // Fire and forget - don't block on notification
      this.sendTaskAssignedNotification(taskWithRelations, actorName).catch(() => { });
    } else if (!assignedToId && previousAssigneeId && previousAssigneeId !== header.userId) {
      // Removal: tell whoever was holding it. Being assigned is one of the two
      // ways a user reaches an escalation, so for an assignee outside the
      // customer's team this is the only signal they get — the escalation has
      // just disappeared from every list they can see.
      this.sendTaskUnassignedNotification(taskWithRelations, previousAssigneeId, actorName).catch(() => { });
    }

    return taskWithRelations;
  }

  /**
   * Reject an assignment target that is not an active user of this tenant.
   *
   * `null` (removing the assignment) is always allowed. Anything else must
   * resolve to a live user in the caller's tenant: `tasks.assigned_to_id`
   * references `users.id`, which is shared across tenants, so the FK alone
   * permits both cross-tenant ids and deactivated accounts.
   */
  private async assertAssignableUser(
    header: RequestHeader,
    assignedToId: string | null
  ): Promise<void> {
    if (assignedToId === null) return;

    const assignee = await this.userRepository.findById(assignedToId, header);
    if (!assignee) {
      throw new NotFoundError('User', assignedToId);
    }
    if (assignee.rowStatus !== 0) {
      throw new InvalidInputError('Cannot assign to a deactivated user');
    }
  }

  /**
   * Get comments for a task
   */
  async getComments(header: RequestHeader, taskId: string): Promise<TaskCommentWithUser[]> {
    return this.taskRepository.getCommentsScoped(header, taskId);
  }

  /**
   * Add comment to task
   */
  async addComment(header: RequestHeader, taskId: string, content: string): Promise<TaskComment | undefined> {
    logger.info({ taskId, userId: header.userId }, 'Adding comment to task');
    return this.taskRepository.createCommentScoped(header, taskId, content);
  }

  /**
   * Get users that can be assigned tasks (for dropdown)
   */
  async getAssignableUsers(header: RequestHeader): Promise<Array<{ id: string; name: string }>> {
    return this.taskRepository.getAssignableUsers(header);
  }

  // ===========================================================================
  // Escalation Notification Processing
  // ===========================================================================

  /**
   * Get all open escalation data for a tenant, grouped by manager.
   * This is used by the Inngest cron function to send batch notifications.
   * Returns a map of manager ID to their escalation data.
   */
  async getEscalationDataForTenant(tenantId: string): Promise<Map<string, ManagerEscalationData>> {
    const now = new Date();

    // Get all open escalation tasks (created by system, status = OPEN)
    const escalationTasks = await this.db
      .select({
        task: tasks,
        customerName: customers.name,
        assignedToFirstName: users.firstName,
        assignedToLastName: users.lastName,
      })
      .from(tasks)
      .innerJoin(customers, eq(tasks.customerId, customers.id))
      .leftJoin(users, eq(tasks.assignedToId, users.id))
      .where(
        and(
          eq(tasks.tenantId, tenantId),
          eq(tasks.status, TaskStatus.OPEN),
          eq(tasks.createdBySystem, true),
          // Only escalations openable on the page (sender mapped to a customer).
          this.escalationOpenableCondition(tasks.emailId, tasks.tenantId)
        )
      );

    if (escalationTasks.length === 0) {
      logger.info({ tenantId }, 'No open escalations found');
      return new Map();
    }

    logger.info(
      { tenantId, escalationTaskCount: escalationTasks.length },
      'Found open escalation tasks'
    );

    // Calculate date boundaries for per-manager metrics
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);
    const yesterdayStart = new Date(todayStart);
    yesterdayStart.setDate(yesterdayStart.getDate() - 1);
    const threeDaysAgoStart = new Date(todayStart);
    threeDaysAgoStart.setDate(threeDaysAgoStart.getDate() - 3);

    // Batch-fetch managers and account owners for all customers in 2 queries
    const customerIds = [...new Set(escalationTasks.map(t => t.task.customerId))];
    logger.info(
      { tenantId, customerIds, customerCount: customerIds.length },
      'Fetching managers and account owners for escalation customers'
    );

    const [managersMap, accountOwnersMap] = await Promise.all([
      this.userRepository.getAllManagersForCustomers(customerIds),
      this.userRepository.getAccountOwnersForCustomers(customerIds),
    ]);

    logger.info(
      {
        tenantId,
        managersFound: managersMap.size,
        managerCustomerIds: [...managersMap.keys()],
        accountOwnersFound: accountOwnersMap.size,
      },
      'Manager and account owner lookup results'
    );

    // Group tasks by customer
    const tasksByCustomer = new Map<string, typeof escalationTasks>();
    for (const entry of escalationTasks) {
      const existing = tasksByCustomer.get(entry.task.customerId) || [];
      existing.push(entry);
      tasksByCustomer.set(entry.task.customerId, existing);
    }

    // Build manager escalation map
    const managerEscalationMap = new Map<string, ManagerEscalationData>();

    for (const customerId of customerIds) {
      const managers = managersMap.get(customerId) || [];
      const accountOwner = accountOwnersMap.get(customerId);
      const accountOwnerName = accountOwner
        ? `${accountOwner.firstName} ${accountOwner.lastName}`
        : 'Not assigned';

      const customerTasks = tasksByCustomer.get(customerId) || [];

      for (const manager of managers) {
        if (!managerEscalationMap.has(manager.id)) {
          managerEscalationMap.set(manager.id, {
            manager: {
              id: manager.id,
              email: manager.email,
              firstName: manager.firstName,
              lastName: manager.lastName,
              timezone: manager.timezone,
            },
            escalations: [],
            metrics: { new: 0, open1Day: 0, open3Days: 0, openMoreThan3Days: 0 },
          });
        }

        const managerData = managerEscalationMap.get(manager.id)!;

        for (const { task, customerName, assignedToFirstName, assignedToLastName } of customerTasks) {
          const assignedToName = assignedToFirstName && assignedToLastName
            ? `${assignedToFirstName} ${assignedToLastName}`
            : 'Unassigned';

          managerData.escalations.push({
            id: task.id,
            customer: customerName || 'Unknown Customer',
            subject: task.title,
            dateOpened: format(new Date(task.createdAt), 'MMM d, yyyy'),
            assignedTo: assignedToName,
            accountOwner: accountOwnerName,
            detailsUrl: this.escalationDetailsUrl(task.emailId),
          });

          // Categorize this task for per-manager metrics
          const createdAt = new Date(task.createdAt);
          if (createdAt >= todayStart) {
            managerData.metrics.new++;
          } else if (createdAt >= yesterdayStart) {
            managerData.metrics.open1Day++;
          } else if (createdAt >= threeDaysAgoStart) {
            managerData.metrics.open3Days++;
          } else {
            managerData.metrics.openMoreThan3Days++;
          }
        }
      }
    }

    return managerEscalationMap;
  }

  /**
   * Get escalation data for a specific manager.
   * Used by the notifications service to fetch data for batch emails.
   * Returns escalations for customers managed by this user (directly or via subordinates).
   */
  async getEscalationsForManager(
    header: RequestHeader,
    managerId: string,
    since?: Date
  ): Promise<{ escalations: EscalationItem[]; metrics: EscalationMetrics }> {
    const now = new Date();

    // Get all subordinate IDs for this manager (users they manage directly or indirectly)
    const subordinateIds = await this.getSubordinateIds(managerId, header.tenantId);

    // Include the manager's own customers too
    const userIdsToCheck = [managerId, ...subordinateIds];

    // Get all customers assigned to these users
    const customerIds = await this.getCustomerIdsForUsers(userIdsToCheck);

    if (customerIds.length === 0) {
      return { escalations: [], metrics: { new: 0, open1Day: 0, open3Days: 0, openMoreThan3Days: 0 } };
    }

    // Get escalation tasks for these customers
    const { inArray } = await import('drizzle-orm');
    let whereConditions = and(
      eq(tasks.tenantId, header.tenantId),
      eq(tasks.status, TaskStatus.OPEN),
      eq(tasks.createdBySystem, true),
      inArray(tasks.customerId, customerIds),
      // Only escalations openable on the page (sender mapped to a customer).
      this.escalationOpenableCondition(tasks.emailId, tasks.tenantId)
    );

    // Apply 'since' filter if provided (for incremental updates)
    // Note: We still return all open tasks, but could use this for filtering
    // For now, we ignore 'since' and always return all open escalations

    const escalationTasks = await this.db
      .select({
        task: tasks,
        customerName: customers.name,
        assignedToFirstName: users.firstName,
        assignedToLastName: users.lastName,
      })
      .from(tasks)
      .innerJoin(customers, eq(tasks.customerId, customers.id))
      .leftJoin(users, eq(tasks.assignedToId, users.id))
      .where(whereConditions);

    if (escalationTasks.length === 0) {
      return { escalations: [], metrics: { new: 0, open1Day: 0, open3Days: 0, openMoreThan3Days: 0 } };
    }

    // Calculate date boundaries for metrics
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);

    const yesterdayStart = new Date(todayStart);
    yesterdayStart.setDate(yesterdayStart.getDate() - 1);

    const threeDaysAgoStart = new Date(todayStart);
    threeDaysAgoStart.setDate(threeDaysAgoStart.getDate() - 3);

    // Calculate metrics (no duplicates - mutually exclusive categories)
    const metrics: EscalationMetrics = {
      new: 0,
      open1Day: 0,
      open3Days: 0,
      openMoreThan3Days: 0,
    };

    const escalations: EscalationItem[] = [];

    for (const { task, customerName, assignedToFirstName, assignedToLastName } of escalationTasks) {
      const createdAt = new Date(task.createdAt);
      if (createdAt >= todayStart) {
        metrics.new++;
      } else if (createdAt >= yesterdayStart) {
        metrics.open1Day++;
      } else if (createdAt >= threeDaysAgoStart) {
        metrics.open3Days++;
      } else {
        metrics.openMoreThan3Days++;
      }

      // Get account owner for this customer
      const accountOwner = await this.userRepository.getAccountOwner(task.customerId);
      const accountOwnerName = accountOwner
        ? `${accountOwner.firstName} ${accountOwner.lastName}`
        : 'Not assigned';

      const assignedToName = assignedToFirstName && assignedToLastName
        ? `${assignedToFirstName} ${assignedToLastName}`
        : 'Unassigned';

      escalations.push({
        id: task.id,
        customer: customerName || 'Unknown Customer',
        subject: task.title,
        dateOpened: format(new Date(task.createdAt), 'MMM d, yyyy'),
        assignedTo: assignedToName,
        accountOwner: accountOwnerName,
        detailsUrl: this.escalationDetailsUrl(task.emailId),
      });
    }

    return { escalations, metrics };
  }

  /**
   * Get all subordinate user IDs for a manager (direct and indirect reports)
   */
  private async getSubordinateIds(managerId: string, tenantId: string): Promise<string[]> {
    const result = await this.db.execute<{ subordinate_id: string }>(sql`
      WITH RECURSIVE subordinates AS (
        -- Base case: direct reports
        SELECT um.user_id AS subordinate_id
        FROM user_managers um
        JOIN users u ON u.id = um.user_id
        WHERE um.manager_id = ${managerId}
          AND u.tenant_id = ${tenantId}
          AND u.row_status = 0

        UNION

        -- Recursive case: reports of reports
        SELECT um2.user_id AS subordinate_id
        FROM subordinates s
        JOIN user_managers um2 ON um2.manager_id = s.subordinate_id
        JOIN users u ON u.id = um2.user_id
        WHERE u.tenant_id = ${tenantId}
          AND u.row_status = 0
      )
      SELECT DISTINCT subordinate_id FROM subordinates
    `);

    return result.map(r => r.subordinate_id);
  }

  /**
   * Get all customer IDs assigned to a list of users
   */
  private async getCustomerIdsForUsers(userIds: string[]): Promise<string[]> {
    if (userIds.length === 0) return [];

    const { inArray } = await import('drizzle-orm');
    const { userCustomers } = await import('../users/schema');

    const result = await this.db
      .select({ customerId: userCustomers.customerId })
      .from(userCustomers)
      .where(inArray(userCustomers.userId, userIds));

    return [...new Set(result.map(r => r.customerId))];
  }

  /**
   * Check if it's time to send notifications to a manager based on their timezone.
   * Currently defaults to 8am local time daily.
   */
  shouldSendNotification(timezone: string | null, now: Date = new Date()): boolean {
    const tz = timezone || 'Asia/Kolkata';
    const managerLocalTime = toZonedTime(now, tz);
    const currentHour = managerLocalTime.getHours();

    // Default: daily at 8am local time
    // TODO: Read from user notification preferences
    return currentHour === 8;
  }

  /**
   * Send escalation batch notification to a manager via the notifications service.
   */
  async sendEscalationNotification(
    tenantId: string,
    data: ManagerEscalationData
  ): Promise<boolean> {
    try {
      const notificationsUrl = getEnv().SERVICE_NOTIFICATIONS_URL;
      const response = await fetch(
        `${notificationsUrl}/api/notifications/send/escalation-batch`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-tenant-id': tenantId,
            'x-user-id': data.manager.id,
            ...getServiceAuthHeaders(),
          },
          body: JSON.stringify({
            escalations: data.escalations,
            metrics: data.metrics,
            recipientName: data.manager.firstName,
            recipientEmail: data.manager.email,
          }),
        }
      );

      if (response.ok) {
        logger.info(
          { managerId: data.manager.id, escalationCount: data.escalations.length },
          'Sent escalation batch notification'
        );
        return true;
      } else {
        const errorData = await response.json().catch(() => ({}));
        logger.error(
          { managerId: data.manager.id, status: response.status, error: errorData },
          'Failed to send escalation notification'
        );
        return false;
      }
    } catch (error) {
      logger.error({ managerId: data.manager.id, error }, 'Error sending escalation notification');
      return false;
    }
  }

  /**
   * Single source of truth for "can this escalation be opened on the page".
   *
   * Mirrors the openability rule of the detail fetch (`getAnalyzedEmailById`):
   * the email exists for the tenant and its SENDER (direction='from') maps to a
   * customer. Escalations whose sender isn't a mapped customer (e.g. customer
   * identified via a to/cc address) can't be opened from the escalations page,
   * so their links are dead-ends.
   *
   * NOTE: deliberately does NOT filter on analysis_status — the detail page
   * opens such emails regardless of analysis state, so a stricter check here
   * would suppress notifications whose links actually work. Both the per-task
   * gate and the digest filter consume this one predicate so they can't drift.
   *
   * @param emailIdExpr  email id — a bound value or a correlated column (e.g. `tasks.emailId`)
   * @param tenantIdExpr tenant id — a bound value or a correlated column
   */
  private escalationOpenableCondition(
    emailIdExpr: SQL | Column | string,
    tenantIdExpr: SQL | Column | string
  ): SQL {
    return sql`EXISTS (
      SELECT 1
      FROM emails e
      INNER JOIN email_participants ep ON ep.email_id = e.id AND ep.direction = 'from'
      INNER JOIN customers c2 ON c2.id = ep.customer_id
      WHERE e.id = ${emailIdExpr}
        AND e.tenant_id = ${tenantIdExpr}
    )`;
  }

  /** Whether a specific escalation email is openable on the page. */
  private async isEscalationOpenable(tenantId: string, emailId: string): Promise<boolean> {
    const rows = await this.db.execute<{ openable: boolean }>(
      sql`SELECT ${this.escalationOpenableCondition(emailId, tenantId)} AS openable`
    );
    return rows[0]?.openable ?? false;
  }

  /**
   * Build the escalations deep-link for a task's email. The escalations page
   * resolves by analyzed-email id; when there's no email we fall back to the
   * list. Single web base (WEB_URL) so every escalation link — assignment
   * notifications and manager digests — points at the same host.
   */
  private escalationDetailsUrl(emailId: string | null): string {
    const base = getEnv().WEB_URL;
    return emailId ? `${base}/escalations/${emailId}` : `${base}/escalations`;
  }

  /**
   * Send task-assigned notification via the notifications service.
   * Called when a task is created with an assignee or reassigned.
   * Checks user preferences before sending.
   */
  async sendTaskAssignedNotification(
    task: TaskWithRelations,
    assignedByName?: string
  ): Promise<boolean> {
    if (!task.assignedToId) {
      logger.debug({ taskId: task.id }, 'No assignee, skipping notification');
      return false;
    }

    const recipientEmail = task.assignedToEmail;
    if (!recipientEmail) {
      logger.warn({ taskId: task.id }, 'No email for assignee, skipping notification');
      return false;
    }

    // Auto-created escalations link to the escalations page, which can only open
    // an escalation whose email sender maps to a customer. If such an escalation
    // isn't openable, its link is a dead-end, so skip the notification. This
    // gate is scoped to system-created escalations only — manually-created tasks
    // keep the original behaviour (notify whenever there's a recipient), since
    // they aren't subject to the escalations-page sender-attribution rule.
    if (
      task.createdBySystem &&
      (!task.emailId || !(await this.isEscalationOpenable(task.tenantId, task.emailId)))
    ) {
      logger.info(
        { taskId: task.id, emailId: task.emailId },
        'Escalation not openable on escalations page (sender not mapped to a customer); skipping assignment notification'
      );
      return false;
    }

    const notificationsUrl = getEnv().SERVICE_NOTIFICATIONS_URL;

    const detailsUrl = this.escalationDetailsUrl(task.emailId);

    try {
      // Call /send - the notification service handles preference checks
      const response = await fetch(
        `${notificationsUrl}/api/notifications/send`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-tenant-id': task.tenantId,
            'x-user-id': task.assignedToId,
            ...getServiceAuthHeaders(),
          },
          body: JSON.stringify({
            templateName: 'task.assigned',
            recipientEmail,
            data: {
              task: {
                id: task.id,
                customer: task.customerName || 'Unknown Customer',
                subject: task.title,
                dateOpened: format(new Date(task.createdAt), 'MMM d, yyyy'),
                assignedTo: task.assignedToName || 'Unassigned',
                assignedBy: assignedByName || null,
                accountOwner: task.assignedToName || 'Unknown', // TODO: Get actual account owner
                detailsUrl,
              },
              recipientName: task.assignedToName?.split(' ')[0] || 'Team',
            },
          }),
        }
      );

      if (response.ok) {
        logger.info(
          { taskId: task.id, assignedToId: task.assignedToId },
          'Sent task-assigned notification'
        );
        return true;
      } else {
        const errorData = await response.json().catch(() => ({}));
        logger.error(
          { taskId: task.id, status: response.status, error: errorData },
          'Failed to send task-assigned notification'
        );
        return false;
      }
    } catch (error) {
      logger.error({ taskId: task.id, error }, 'Error sending task-assigned notification');
      return false;
    }
  }

  /**
   * Send task-unassigned notification to the user an escalation was taken from.
   *
   * Called when reassign() clears the assignee. `task` is the row *after* the
   * write, so its assignee fields are empty — the recipient is looked up from
   * the id captured beforehand.
   *
   * Unlike the assigned notification there is no openable-escalation gate,
   * because this email carries no deep link: the recipient may have just lost
   * the only access path they had to that escalation, so a link would 404 for
   * exactly the people who most need telling.
   */
  async sendTaskUnassignedNotification(
    task: TaskWithRelations,
    previousAssigneeId: string,
    removedByName?: string
  ): Promise<boolean> {
    const recipient = await this.userRepository.findById(previousAssigneeId);
    if (!recipient?.email) {
      logger.warn(
        { taskId: task.id, previousAssigneeId },
        'No email for previous assignee, skipping unassignment notification'
      );
      return false;
    }

    const notificationsUrl = getEnv().SERVICE_NOTIFICATIONS_URL;

    try {
      const response = await fetch(
        `${notificationsUrl}/api/notifications/send`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-tenant-id': task.tenantId,
            'x-user-id': previousAssigneeId,
            ...getServiceAuthHeaders(),
          },
          body: JSON.stringify({
            templateName: 'task.unassigned',
            recipientEmail: recipient.email,
            data: {
              task: {
                id: task.id,
                customer: task.customerName || 'Unknown Customer',
                subject: task.title,
                dateOpened: format(new Date(task.createdAt), 'MMM d, yyyy'),
                removedBy: removedByName || null,
              },
              recipientName: recipient.firstName || 'there',
            },
          }),
        }
      );

      if (response.ok) {
        logger.info(
          { taskId: task.id, previousAssigneeId },
          'Sent task-unassigned notification'
        );
        return true;
      }

      const errorData = await response.json().catch(() => ({}));
      logger.error(
        { taskId: task.id, status: response.status, error: errorData },
        'Failed to send task-unassigned notification'
      );
      return false;
    } catch (error) {
      logger.error({ taskId: task.id, error }, 'Error sending task-unassigned notification');
      return false;
    }
  }
}
