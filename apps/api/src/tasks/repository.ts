import { eq, and, sql, SQL, desc, asc, inArray } from 'drizzle-orm';
import { injectable, inject } from 'tsyringe';
import { ScopedRepository, type Database } from '@crm/database';
import { Permission, type RequestHeader } from '@crm/shared';
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
   * Check if user can access a task (their own or subordinate's)
   * Uses the inherited hasUserAccess but also verifies tenant
   */
  private async hasTaskAccess(header: RequestHeader, taskId: string): Promise<boolean> {
    // First get the task to check tenant and assignedToId
    const task = await this.findById(taskId);
    if (!task || task.tenantId !== header.tenantId) {
      return false;
    }
    return this.hasUserAccess(header, task.assignedToId);
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
      search?: string;
      dateFrom?: Date;
      dateTo?: Date;
    }
  ): SQL[] {
    const conditions: SQL[] = [
      this.tenantFilter(tasks.tenantId, header),
      this.userAccessFilter(tasks.assignedToId, header),
    ];

    if (options.status !== undefined) {
      conditions.push(eq(tasks.status, options.status));
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
        createdAt: tasks.createdAt,
        updatedAt: tasks.updatedAt,
        completedAt: tasks.completedAt,
        customerName: customers.name,
        assignedToName: sql<string>`CONCAT(${users.firstName}, ' ', ${users.lastName})`.as('assignedToName'),
        assignedToEmail: users.email,
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
      search?: string;
      sortBy?: 'createdAt' | 'updatedAt';
      sortOrder?: 'asc' | 'desc';
      limit?: number;
      offset?: number;
      dateFrom?: Date;
      dateTo?: Date;
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
        createdAt: tasks.createdAt,
        updatedAt: tasks.updatedAt,
        completedAt: tasks.completedAt,
        customerName: customers.name,
        assignedToName: sql<string>`CONCAT(${users.firstName}, ' ', ${users.lastName})`.as('assignedToName'),
        assignedToEmail: users.email,
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

  async markDone(header: RequestHeader, id: string): Promise<Task | undefined> {
    return this.updateScoped(header, id, {
      status: TaskStatus.DONE,
      completedAt: new Date(),
    });
  }

  async reopen(header: RequestHeader, id: string): Promise<Task | undefined> {
    return this.updateScoped(header, id, {
      status: TaskStatus.OPEN,
      completedAt: null,
    });
  }

  async reassign(header: RequestHeader, id: string, assignedToId: string | null): Promise<Task | undefined> {
    return this.updateScoped(header, id, { assignedToId });
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
        createdAt: tasks.createdAt,
        updatedAt: tasks.updatedAt,
        completedAt: tasks.completedAt,
        customerName: customers.name,
        assignedToName: sql<string>`CONCAT(${users.firstName}, ' ', ${users.lastName})`.as('assignedToName'),
        assignedToEmail: users.email,
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
   * Get users that can be assigned tasks
   * - Admins: can assign to any user in tenant (excluding self)
   * - Others: can only assign to subordinates
   * The current user is shown as "Me" in the frontend dropdown
   */
  async getAssignableUsers(header: RequestHeader): Promise<Array<{ id: string; name: string }>> {
    const isAdmin = header.permissions?.includes(Permission.ADMIN) ?? false;

    if (isAdmin) {
      // Admins can assign to any user in the tenant (excluding themselves)
      const result = await this.db
        .select({
          id: users.id,
          name: sql<string>`CONCAT(${users.firstName}, ' ', ${users.lastName})`.as('name'),
        })
        .from(users)
        .where(
          and(
            this.tenantFilter(users.tenantId, header),
            sql`${users.id} != ${header.userId}`,
            sql`${users.rowStatus} = 0` // Active users only
          )
        )
        .orderBy(users.firstName, users.lastName);

      return result;
    }

    // Non-admins: get subordinates only (exclude self - frontend has "Me" option)
    const subordinateIds = await this.getSubordinates(header.userId);

    // If no subordinates, return empty array
    if (subordinateIds.length === 0) {
      return [];
    }

    const result = await this.db
      .select({
        id: users.id,
        name: sql<string>`CONCAT(${users.firstName}, ' ', ${users.lastName})`.as('name'),
      })
      .from(users)
      .where(
        and(
          this.tenantFilter(users.tenantId, header),
          inArray(users.id, subordinateIds)
        )
      )
      .orderBy(users.firstName, users.lastName);

    return result;
  }
}
