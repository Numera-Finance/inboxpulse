import { eq, and, sql, SQL, desc, asc, inArray } from 'drizzle-orm';
import { injectable, inject } from 'tsyringe';
import type { Database } from '@crm/database';
import { isAdmin, type RequestHeader } from '@crm/shared';
import { tasks, taskComments, userSubordinates, type Task, type NewTask, type TaskComment, type NewTaskComment, TaskStatus } from './schema';
import { users } from '../users/schema';
import { customers } from '../customers/schema';
import { emails } from '../emails/schema';
import { logger } from '../utils/logger';

export interface TaskWithRelations extends Task {
  customerName?: string | null;
  customerDomain?: string;
  assignedToName?: string | null;
  emailSubject?: string | null;
  emailBody?: string | null;
  emailFromEmail?: string | null;
  emailFromName?: string | null;
}

export interface TaskCommentWithUser extends TaskComment {
  userName: string;
}

@injectable()
export class TaskRepository {
  constructor(@inject('Database') private db: Database) {}

  /**
   * Check if user can access a task (their own or subordinate's)
   */
  private async hasTaskAccess(header: RequestHeader, taskId: string): Promise<boolean> {
    if (isAdmin(header.permissions)) {
      return true;
    }

    const result = await this.db.execute(sql`
      SELECT 1 FROM ${tasks} t
      WHERE t.id = ${taskId}
        AND t.tenant_id = ${header.tenantId}
        AND (
          t.assigned_to_id = ${header.userId}
          OR t.assigned_to_id IS NULL
          OR t.assigned_to_id IN (
            SELECT subordinate_id FROM ${userSubordinates}
            WHERE user_id = ${header.userId}
          )
        )
      LIMIT 1
    `);
    return result.length > 0;
  }

  /**
   * SQL filter for task access control
   * User can see: unassigned, their own, or subordinate's tasks
   */
  private taskAccessFilter(header: RequestHeader): SQL {
    if (isAdmin(header.permissions)) {
      return sql`true`;
    }

    return sql`(
      ${tasks.assignedToId} IS NULL
      OR ${tasks.assignedToId} = ${header.userId}
      OR ${tasks.assignedToId} IN (
        SELECT subordinate_id FROM ${userSubordinates}
        WHERE user_id = ${header.userId}
      )
    )`;
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
          eq(tasks.tenantId, header.tenantId)
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
    const conditions: SQL[] = [
      eq(tasks.tenantId, header.tenantId),
      this.taskAccessFilter(header),
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
      // Convert Date to ISO string for postgres driver compatibility
      const dateFromStr = options.dateFrom instanceof Date
        ? options.dateFrom.toISOString()
        : options.dateFrom;
      conditions.push(sql`${tasks.createdAt} >= ${dateFromStr}`);
    }

    if (options.dateTo) {
      // Convert Date to ISO string for postgres driver compatibility
      const dateToStr = options.dateTo instanceof Date
        ? options.dateTo.toISOString()
        : options.dateTo;
      conditions.push(sql`${tasks.createdAt} <= ${dateToStr}`);
    }

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
   * Get users that can be assigned tasks (subordinates only, excluding self)
   * The current user is shown as "Me" in the frontend dropdown
   */
  async getAssignableUsers(header: RequestHeader): Promise<Array<{ id: string; name: string }>> {
    // Get subordinates only (exclude self - frontend has "Me" option)
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
          eq(users.tenantId, header.tenantId),
          inArray(users.id, subordinateIds)
        )
      );

    return result;
  }
}
