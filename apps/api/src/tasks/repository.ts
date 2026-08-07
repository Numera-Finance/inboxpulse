import { eq, and, sql, SQL, desc, asc, inArray } from 'drizzle-orm';
import { injectable, inject } from 'tsyringe';
import { ScopedRepository, affectedRows, type Database, type Transaction } from '@crm/database';
import { Signal, isAdmin, type RequestHeader } from '@crm/shared';
import { tasks, taskComments, userSubordinates, type Task, type NewTask, type TaskComment, type NewTaskComment, TaskStatus } from './schema';
import { users } from '../users/schema';
import { customers } from '../customers/schema';
import { emails } from '../emails/schema';
import { logger } from '../utils/logger';

export interface TaskWithRelations extends Task {
  customerName?: string | null;
  customerDomain?: string;
  assignedToName?: string | null;
  assignedToEmail?: string | null;
  completedByName?: string | null;
  emailSubject?: string | null;
  emailBody?: string | null;
  emailFromEmail?: string | null;
  emailFromName?: string | null;
}

export interface TaskCommentWithUser extends TaskComment {
  userName: string;
}

@injectable()
export class TaskRepository extends ScopedRepository {
  constructor(@inject('Database') db: Database) {
    super(db);
  }

  /**
   * Check if a user can act on a task (reassign, resolve, reopen, comment).
   *
   * A user may act on a task assigned to them, or on any task for a customer
   * they can access. This is the union of what the two surfaces show — the
   * escalations page (`EmailRepository.analyzedEmailAccessFilter`: customer OR
   * assigned) and the task list (`buildTaskFilters`: (hierarchy AND customer)
   * OR assigned) — so a user can act on precisely what they can see, and never
   * on anything they cannot. Two cases depend on it:
   * - The assignee of an escalation for a customer they have no access to can
   *   still work it, including handing it back.
   * - Someone with customer access can reassign a task they handed to a user
   *   outside their reporting hierarchy, instead of losing control of it. The
   *   escalations page still lists that task for them, so refusing the write
   *   would 404 on an escalation visible on screen.
   *
   * Reporting hierarchy is deliberately not a third arm: neither surface grants
   * visibility on hierarchy alone (the task list ANDs it with customer access),
   * so admitting it here would allow writes to tasks the caller cannot see.
   */
  private async hasTaskAccess(header: RequestHeader, taskId: string): Promise<boolean> {
    // First get the task to check tenant and assignedToId
    const task = await this.findById(taskId);
    if (!task || task.tenantId !== header.tenantId) {
      return false;
    }

    if (isAdmin(header.permissions)) {
      return true;
    }

    if (task.assignedToId === header.userId) {
      return true;
    }

    return this.hasCustomerAccess(header, task.customerId);
  }

  /**
   * Build freeform search condition for tasks
   */
  buildFreeformSearch(searchTerm: string): SQL | undefined {
    if (!searchTerm || searchTerm.trim() === '') {
      return undefined;
    }
    const term = `%${searchTerm}%`;
    return sql`(
      ${tasks.title} ILIKE ${term}
      OR ${tasks.id} IN (
        SELECT t.id FROM ${tasks} t
        JOIN ${customers} c ON t.customer_id = c.id
        WHERE c.name ILIKE ${term}
      )
    )`;
  }

  // ===========================================================================
  // Shared Filter Building
  // ===========================================================================

  /**
   * Build common filter conditions for task queries
   */
  private buildTaskFilters(
    header: RequestHeader,
    options: {
      status?: number;
      assignedToId?: string;
      customerId?: string;
      emailId?: string;
      search?: string;
      dateFrom?: Date;
      dateTo?: Date;
      signal?: string;
    }
  ): SQL[] {
    const conditions: SQL[] = [
      this.tenantFilter(tasks.tenantId, header),
      // Normal scoping is hierarchy AND customer access, but a direct assignee
      // always sees what is assigned to them — an escalation can be handed to
      // anyone in the tenant, including someone off the customer's team.
      sql`(
        (${this.userAccessFilter(tasks.assignedToId, header)} AND ${this.customerAccessFilter(tasks.customerId, header)})
        OR ${tasks.assignedToId} = ${header.userId}
      )`,
    ];

    if (options.status !== undefined) {
      conditions.push(eq(tasks.status, options.status));
    }

    if (options.emailId) {
      conditions.push(eq(tasks.emailId, options.emailId));
    }

    if (options.assignedToId !== undefined) {
      if (options.assignedToId === 'unassigned') {
        conditions.push(sql`${tasks.assignedToId} IS NULL`);
      } else {
        conditions.push(eq(tasks.assignedToId, options.assignedToId));
      }
    }

    if (options.customerId) {
      conditions.push(eq(tasks.customerId, options.customerId));
    }

    if (options.search) {
      const searchCondition = this.buildFreeformSearch(options.search);
      if (searchCondition) {
        conditions.push(searchCondition);
      }
    }

    if (options.dateFrom) {
      const dateFromStr = options.dateFrom instanceof Date
        ? options.dateFrom.toISOString()
        : options.dateFrom;
      conditions.push(sql`${tasks.createdAt} >= ${dateFromStr}`);
    }

    if (options.dateTo) {
      const dateToStr = options.dateTo instanceof Date
        ? options.dateTo.toISOString()
        : options.dateTo;
      conditions.push(sql`${tasks.createdAt} <= ${dateToStr}`);
    }

    if (options.signal) {
      const signalMap: Record<string, number[]> = {
        positive: [Signal.SENTIMENT_POSITIVE],
        negative: [Signal.SENTIMENT_NEGATIVE],
        neutral: [Signal.SENTIMENT_NEUTRAL],
        upsell: [Signal.UPSELL],
        churn: [Signal.CHURN_LOW, Signal.CHURN_MEDIUM, Signal.CHURN_HIGH, Signal.CHURN_CRITICAL],
        tat: [], // TAT violation is computed dynamically, not a stored signal
      };
      const signalValues = signalMap[options.signal];
      if (signalValues && signalValues.length > 0) {
        conditions.push(sql`${tasks.emailId} IN (
          SELECT e.id FROM emails e
          WHERE e.signals && ARRAY[${sql.join(signalValues.map(v => sql`${v}`), sql`, `)}]::integer[]
        )`);
      }
    }

    return conditions;
  }

  // ===========================================================================
  // Task CRUD Operations
  // ===========================================================================

  async create(data: NewTask): Promise<Task> {
    const result = await this.db.insert(tasks).values(data).returning();
    logger.debug({ taskId: result[0].id }, 'Created task');
    return result[0];
  }

  async findById(id: string): Promise<Task | undefined> {
    const result = await this.db.select().from(tasks).where(eq(tasks.id, id));
    return result[0];
  }

  async findByIdScoped(header: RequestHeader, id: string): Promise<TaskWithRelations | undefined> {
    const hasAccess = await this.hasTaskAccess(header, id);
    if (!hasAccess) {
      return undefined;
    }

    return this.findByIdWithRelations(header, id);
  }

  /**
   * Load a task with its relations, tenant-scoped but without the per-user
   * access check.
   *
   * Only for callers that have already authorized the operation and now need
   * the resulting row — notably reassign(), where the caller legitimately
   * loses access to the task the moment it is handed to someone outside their
   * hierarchy, so re-checking access here would drop the response and the
   * assignment notification.
   */
  async findByIdWithRelations(header: RequestHeader, id: string): Promise<TaskWithRelations | undefined> {
    const result = await this.db
      .select({
        id: tasks.id,
        tenantId: tasks.tenantId,
        emailId: tasks.emailId,
        customerId: tasks.customerId,
        title: tasks.title,
        status: tasks.status,
        assignedToId: tasks.assignedToId,
        createdBySystem: tasks.createdBySystem,
        problem: tasks.problem,
        resolution: tasks.resolution,
        completedById: tasks.completedById,
        createdAt: tasks.createdAt,
        updatedAt: tasks.updatedAt,
        completedAt: tasks.completedAt,
        customerName: customers.name,
        assignedToName: sql<string>`CONCAT(${users.firstName}, ' ', ${users.lastName})`.as('assignedToName'),
        assignedToEmail: users.email,
        completedByName: sql<string>`(SELECT CONCAT(u.first_name, ' ', u.last_name) FROM users u WHERE u.id = ${tasks.completedById})`.as('completedByName'),
        emailSubject: emails.subject,
        emailBody: emails.body,
        emailFromEmail: emails.fromEmail,
        emailFromName: emails.fromName,
      })
      .from(tasks)
      .leftJoin(customers, eq(tasks.customerId, customers.id))
      .leftJoin(users, eq(tasks.assignedToId, users.id))
      .leftJoin(emails, eq(tasks.emailId, emails.id))
      .where(
        and(
          eq(tasks.id, id),
          this.tenantFilter(tasks.tenantId, header)
        )
      );

    return result[0];
  }

  async findByEmailId(emailId: string): Promise<Task | undefined> {
    const result = await this.db
      .select()
      .from(tasks)
      .where(eq(tasks.emailId, emailId));
    return result[0];
  }

  /**
   * Search tasks with filters and pagination
   */
  async search(
    header: RequestHeader,
    options: {
      status?: number;
      assignedToId?: string;
      customerId?: string;
      emailId?: string;
      search?: string;
      sortBy?: 'createdAt' | 'updatedAt';
      sortOrder?: 'asc' | 'desc';
      limit?: number;
      offset?: number;
      dateFrom?: Date;
      dateTo?: Date;
      signal?: string;
    }
  ): Promise<{ items: TaskWithRelations[]; total: number }> {
    const conditions = this.buildTaskFilters(header, options);
    const where = and(...conditions);

    // Determine sort
    const sortColumn = options.sortBy === 'updatedAt' ? tasks.updatedAt : tasks.createdAt;
    const orderBy = options.sortOrder === 'asc' ? asc(sortColumn) : desc(sortColumn);

    const limit = options.limit || 20;
    const offset = options.offset || 0;

    // Get items with relations
    const items = await this.db
      .select({
        id: tasks.id,
        tenantId: tasks.tenantId,
        emailId: tasks.emailId,
        customerId: tasks.customerId,
        title: tasks.title,
        status: tasks.status,
        assignedToId: tasks.assignedToId,
        createdBySystem: tasks.createdBySystem,
        problem: tasks.problem,
        resolution: tasks.resolution,
        completedById: tasks.completedById,
        createdAt: tasks.createdAt,
        updatedAt: tasks.updatedAt,
        completedAt: tasks.completedAt,
        customerName: customers.name,
        assignedToName: sql<string>`CONCAT(${users.firstName}, ' ', ${users.lastName})`.as('assignedToName'),
        assignedToEmail: users.email,
        completedByName: sql<string>`(SELECT CONCAT(u.first_name, ' ', u.last_name) FROM users u WHERE u.id = ${tasks.completedById})`.as('completedByName'),
        emailSubject: emails.subject,
        emailBody: emails.body,
        emailFromEmail: emails.fromEmail,
        emailFromName: emails.fromName,
      })
      .from(tasks)
      .leftJoin(customers, eq(tasks.customerId, customers.id))
      .leftJoin(users, eq(tasks.assignedToId, users.id))
      .leftJoin(emails, eq(tasks.emailId, emails.id))
      .where(where)
      .orderBy(orderBy)
      .limit(limit)
      .offset(offset);

    // Get total count
    const countResult = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(tasks)
      .where(where);

    const total = Number(countResult[0]?.count ?? 0);

    return { items, total };
  }

  async update(id: string, data: Partial<NewTask>): Promise<Task | undefined> {
    const result = await this.db
      .update(tasks)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(tasks.id, id))
      .returning();
    return result[0];
  }

  async updateScoped(
    header: RequestHeader,
    id: string,
    data: Partial<NewTask>
  ): Promise<Task | undefined> {
    const hasAccess = await this.hasTaskAccess(header, id);
    if (!hasAccess) {
      return undefined;
    }

    return this.update(id, data);
  }

  async markDone(header: RequestHeader, id: string, problem: string, resolution: string): Promise<Task | undefined> {
    return this.updateScoped(header, id, {
      status: TaskStatus.DONE,
      completedAt: new Date(),
      completedById: header.userId,
      problem,
      resolution,
    });
  }

  async reopen(header: RequestHeader, id: string): Promise<Task | undefined> {
    return this.updateScoped(header, id, {
      status: TaskStatus.OPEN,
      completedAt: null,
      problem: null,
      resolution: null,
    });
  }

  /**
   * Reassign a task, returning the assignee it had immediately before the write.
   *
   * The previous assignee is captured by a CTE in the same statement rather than
   * by a preceding SELECT: a separate read leaves a window in which a concurrent
   * reassignment changes the assignee in between, which would send the
   * unassignment notification to someone who no longer held the task while the
   * person who actually lost it hears nothing. The CTE is evaluated against the
   * statement's snapshot, so it always yields the pre-UPDATE value.
   *
   * Returns undefined when the caller cannot access the task or it is gone.
   */
  async reassign(
    header: RequestHeader,
    id: string,
    assignedToId: string | null
  ): Promise<{ id: string; previousAssigneeId: string | null } | undefined> {
    const hasAccess = await this.hasTaskAccess(header, id);
    if (!hasAccess) {
      return undefined;
    }

    const rows = await this.db.execute<{ id: string; previous_assigned_to_id: string | null }>(sql`
      WITH previous AS (
        SELECT assigned_to_id FROM tasks
        WHERE id = ${id} AND tenant_id = ${header.tenantId}
      )
      UPDATE tasks
      SET assigned_to_id = ${assignedToId}, updated_at = NOW()
      WHERE id = ${id} AND tenant_id = ${header.tenantId}
      RETURNING id, (SELECT assigned_to_id FROM previous) AS previous_assigned_to_id
    `);

    const row = rows[0];
    if (!row) {
      return undefined;
    }

    return { id: row.id, previousAssigneeId: row.previous_assigned_to_id ?? null };
  }

  /**
   * Reassign all open tasks from one user to another within a tenant.
   * Returns the number of tasks reassigned.
   */
  async reassignOpenTasks(sourceUserId: string, targetUserId: string, tenantId: string): Promise<number> {
    const result = await this.db
      .update(tasks)
      .set({ assignedToId: targetUserId, updatedAt: new Date() })
      .where(
        and(
          eq(tasks.assignedToId, sourceUserId),
          eq(tasks.status, TaskStatus.OPEN),
          eq(tasks.tenantId, tenantId)
        )
      )
      .returning({ id: tasks.id });
    return result.length;
  }

  // ===========================================================================
  // Dashboard Operations
  // ===========================================================================

  /**
   * Get recent escalations for dashboard tile
   * Returns open tasks ordered by most recent, with customer and assignee info
   */
  async getRecentEscalationsScoped(
    header: RequestHeader,
    options?: {
      customerId?: string;
      limit?: number;
    }
  ): Promise<Array<{
    id: string;
    title: string;
    customerName: string | null;
    customerId: string;
    assignedToName: string | null;
    assignedToId: string | null;
    createdAt: Date;
  }>> {
    const conditions: SQL[] = [
      this.tenantFilter(tasks.tenantId, header),
      // Customer access, or assigned directly to the caller (see buildTaskFilters).
      sql`(
        ${this.customerAccessFilter(tasks.customerId, header)}
        OR ${tasks.assignedToId} = ${header.userId}
      )`,
      eq(tasks.status, TaskStatus.OPEN),
    ];

    // Add customer filter if provided
    if (options?.customerId) {
      conditions.push(eq(tasks.customerId, options.customerId));
    }

    const limit = options?.limit || 100;

    const result = await this.db
      .select({
        id: tasks.id,
        title: tasks.title,
        customerName: customers.name,
        customerId: tasks.customerId,
        assignedToName: sql<string>`CONCAT(${users.firstName}, ' ', LEFT(${users.lastName}, 1), '.')`.as('assignedToName'),
        assignedToId: tasks.assignedToId,
        createdAt: tasks.createdAt,
      })
      .from(tasks)
      .leftJoin(customers, eq(tasks.customerId, customers.id))
      .leftJoin(users, eq(tasks.assignedToId, users.id))
      .where(and(...conditions))
      .orderBy(desc(tasks.createdAt))
      .limit(limit);

    return result;
  }

  // ===========================================================================
  // Comment Operations
  // ===========================================================================

  async createComment(data: NewTaskComment): Promise<TaskComment> {
    const result = await this.db.insert(taskComments).values(data).returning();
    logger.debug({ commentId: result[0].id, taskId: data.taskId }, 'Created task comment');
    return result[0];
  }

  async getComments(taskId: string): Promise<TaskCommentWithUser[]> {
    const result = await this.db
      .select({
        id: taskComments.id,
        taskId: taskComments.taskId,
        userId: taskComments.userId,
        content: taskComments.content,
        createdAt: taskComments.createdAt,
        updatedAt: taskComments.updatedAt,
        userName: sql<string>`CONCAT(${users.firstName}, ' ', ${users.lastName})`.as('userName'),
      })
      .from(taskComments)
      .innerJoin(users, eq(taskComments.userId, users.id))
      .where(eq(taskComments.taskId, taskId))
      .orderBy(asc(taskComments.createdAt));

    return result;
  }

  async getCommentsScoped(header: RequestHeader, taskId: string): Promise<TaskCommentWithUser[]> {
    const hasAccess = await this.hasTaskAccess(header, taskId);
    if (!hasAccess) {
      return [];
    }

    return this.getComments(taskId);
  }

  async createCommentScoped(
    header: RequestHeader,
    taskId: string,
    content: string
  ): Promise<TaskComment | undefined> {
    const hasAccess = await this.hasTaskAccess(header, taskId);
    if (!hasAccess) {
      return undefined;
    }

    return this.createComment({
      taskId,
      userId: header.userId,
      content,
    });
  }

  // ===========================================================================
  // Export Operations
  // ===========================================================================

  /**
   * Export tasks with comments - no pagination limit
   * Returns all matching tasks with their comments aggregated
   */
  async exportWithComments(
    header: RequestHeader,
    options: {
      status?: number;
      assignedToId?: string;
      customerId?: string;
      dateFrom?: Date;
      dateTo?: Date;
      signal?: string;
    }
  ): Promise<Array<TaskWithRelations & { comments: TaskCommentWithUser[] }>> {
    const conditions = this.buildTaskFilters(header, options);
    const where = and(...conditions);

    // Get all tasks with relations (no limit)
    const items = await this.db
      .select({
        id: tasks.id,
        tenantId: tasks.tenantId,
        emailId: tasks.emailId,
        customerId: tasks.customerId,
        title: tasks.title,
        status: tasks.status,
        assignedToId: tasks.assignedToId,
        createdBySystem: tasks.createdBySystem,
        problem: tasks.problem,
        resolution: tasks.resolution,
        completedById: tasks.completedById,
        createdAt: tasks.createdAt,
        updatedAt: tasks.updatedAt,
        completedAt: tasks.completedAt,
        customerName: customers.name,
        assignedToName: sql<string>`CONCAT(${users.firstName}, ' ', ${users.lastName})`.as('assignedToName'),
        assignedToEmail: users.email,
        completedByName: sql<string>`(SELECT CONCAT(u.first_name, ' ', u.last_name) FROM users u WHERE u.id = ${tasks.completedById})`.as('completedByName'),
        emailSubject: emails.subject,
        emailBody: emails.body,
        emailFromEmail: emails.fromEmail,
        emailFromName: emails.fromName,
      })
      .from(tasks)
      .leftJoin(customers, eq(tasks.customerId, customers.id))
      .leftJoin(users, eq(tasks.assignedToId, users.id))
      .leftJoin(emails, eq(tasks.emailId, emails.id))
      .where(where)
      .orderBy(desc(tasks.createdAt));

    if (items.length === 0) {
      return [];
    }

    // Get all comments for these tasks in one query
    const taskIds = items.map(t => t.id);
    const allComments = await this.db
      .select({
        id: taskComments.id,
        taskId: taskComments.taskId,
        userId: taskComments.userId,
        content: taskComments.content,
        createdAt: taskComments.createdAt,
        updatedAt: taskComments.updatedAt,
        userName: sql<string>`CONCAT(${users.firstName}, ' ', ${users.lastName})`.as('userName'),
      })
      .from(taskComments)
      .innerJoin(users, eq(taskComments.userId, users.id))
      .where(inArray(taskComments.taskId, taskIds))
      .orderBy(asc(taskComments.createdAt));

    // Group comments by taskId
    const commentsByTaskId = new Map<string, TaskCommentWithUser[]>();
    for (const comment of allComments) {
      const existing = commentsByTaskId.get(comment.taskId) || [];
      existing.push(comment);
      commentsByTaskId.set(comment.taskId, existing);
    }

    // Merge comments into tasks
    return items.map(task => ({
      ...task,
      comments: commentsByTaskId.get(task.id) || [],
    }));
  }

  // ===========================================================================
  // User Subordinates Management
  // ===========================================================================

  /**
   * Get all subordinates for a user (direct + transitive)
   */
  async getSubordinates(userId: string): Promise<string[]> {
    const result = await this.db
      .select({ subordinateId: userSubordinates.subordinateId })
      .from(userSubordinates)
      .where(eq(userSubordinates.userId, userId));

    return result.map(r => r.subordinateId);
  }

  /**
   * Get users that can be assigned tasks/escalations.
   *
   * Any active user in the tenant is assignable, regardless of reporting
   * hierarchy or customer-team membership: escalations frequently need to go
   * to whoever can actually resolve them, not only to a subordinate or to
   * someone already on the customer's team. Being assigned grants the
   * assignee visibility of that one escalation (see `buildTaskFilters` and
   * `EmailRepository.searchAnalyzedEmails`) — it does not widen their access
   * to the customer's other data.
   *
   * The caller is included — you can assign an escalation to yourself, and
   * taking one back is the common case. Do not try to single that row out
   * client-side: the web app's session user id is the better-auth id, not
   * `users.id` (the two tables have independent keys and are mapped by email
   * in `user-context.ts`), so it never matches an id from this list. The
   * caller is listed by name like everyone else.
   *
   * The permission to actually assign is enforced on the route
   * (`PUT /api/tasks/:id/assign` requires TASK_EDIT).
   */
  async getAssignableUsers(header: RequestHeader): Promise<Array<{ id: string; name: string }>> {
    return this.db
      .select({
        id: users.id,
        name: sql<string>`CONCAT(${users.firstName}, ' ', ${users.lastName})`.as('name'),
      })
      .from(users)
      .where(
        and(
          this.tenantFilter(users.tenantId, header),
          sql`${users.rowStatus} = 0` // Active users only
        )
      )
      .orderBy(sql`lower(${users.firstName})`, sql`lower(${users.lastName})`);
  }

  /**
   * Reassign all tasks from one customer to another.
   */
  async reassignCustomer(tenantId: string, sourceCustomerId: string, targetCustomerId: string, tx?: Transaction): Promise<number> {
    const db = tx ?? this.db;
    const result = await db.execute(sql`
      UPDATE tasks
      SET customer_id = ${targetCustomerId}, updated_at = NOW()
      WHERE customer_id = ${sourceCustomerId} AND tenant_id = ${tenantId}
    `);
    return affectedRows(result);
  }
}
