import { injectable, inject } from 'tsyringe';
import { z } from 'zod';
import { eq, and } from 'drizzle-orm';
import { format } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import type { RequestHeader } from '@crm/shared';
import type { Database } from '@crm/database';
import { TaskRepository, type TaskWithRelations, type TaskCommentWithUser } from './repository';
import { TaskStatus, type Task, type TaskComment, tasks } from './schema';
import { customers } from '../customers/schema';
import { users } from '../users/schema';
import { UserRepository } from '../users/repository';
import { logger } from '../utils/logger';

// =============================================================================
// Zod Schemas for request validation
// =============================================================================

export const taskSearchRequestSchema = z.object({
  status: z.enum(['open', 'done']).optional(),
  assignedToId: z.string().optional(),
  customerId: z.string().uuid().optional(),
  search: z.string().optional(),
  sortBy: z.enum(['createdAt', 'updatedAt']).optional(),
  sortOrder: z.enum(['asc', 'desc']).optional(),
  limit: z.number().int().positive().max(100).optional(),
  offset: z.number().int().min(0).optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
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

// =============================================================================
// Derived types from Zod schemas
// =============================================================================

export type TaskSearchRequest = z.infer<typeof taskSearchRequestSchema>;
export type CreateTaskRequest = z.infer<typeof createTaskRequestSchema>;
export type ReassignTaskRequest = z.infer<typeof reassignTaskRequestSchema>;
export type AddCommentRequest = z.infer<typeof addCommentRequestSchema>;

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
    @inject(UserRepository) private userRepository: UserRepository
  ) {}

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
      search: request.search,
      sortBy: request.sortBy,
      sortOrder: request.sortOrder,
      limit: request.limit,
      offset: request.offset,
      dateFrom,
      dateTo,
    });

    return {
      items,
      total,
      limit: request.limit || 20,
      offset: request.offset || 0,
    };
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

    return this.taskRepository.create({
      tenantId: header.tenantId,
      customerId: request.customerId,
      title: request.title,
      emailId: request.emailId,
      assignedToId: request.assignedToId,
      createdBySystem: false,
    });
  }

  /**
   * Create task from negative email (system-created)
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

    return this.taskRepository.create({
      tenantId,
      customerId,
      emailId,
      title: emailSubject || 'Negative sentiment email',
      createdBySystem: true,
    });
  }

  /**
   * Mark task as done
   */
  async markDone(header: RequestHeader, id: string): Promise<Task | undefined> {
    logger.info({ taskId: id }, 'Marking task as done');
    return this.taskRepository.markDone(header, id);
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
  async reassign(header: RequestHeader, id: string, assignedToId: string | null): Promise<Task | undefined> {
    logger.info({ taskId: id, assignedToId }, 'Reassigning task');
    return this.taskRepository.reassign(header, id, assignedToId);
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
          eq(tasks.createdBySystem, true)
        )
      );

    if (escalationTasks.length === 0) {
      logger.debug({ tenantId }, 'No open escalations found');
      return new Map();
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

    for (const { task } of escalationTasks) {
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
    }

    // Group tasks by customer and collect managers
    const customerIds = [...new Set(escalationTasks.map(t => t.task.customerId))];
    const managerEscalationMap = new Map<string, ManagerEscalationData>();

    for (const customerId of customerIds) {
      // Get all managers in the hierarchy for this customer
      const managers = await this.userRepository.getAllManagersForCustomer(customerId);

      // Get account owner
      const accountOwner = await this.userRepository.getAccountOwner(customerId);
      const accountOwnerName = accountOwner
        ? `${accountOwner.firstName} ${accountOwner.lastName}`
        : 'Not assigned';

      // Get tasks for this customer
      const customerTasks = escalationTasks.filter(t => t.task.customerId === customerId);

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
            metrics: { ...metrics },
          });
        }

        const managerData = managerEscalationMap.get(manager.id)!;

        // Add escalations for this customer
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
            detailsUrl: `${process.env.APP_URL || 'http://localhost:3000'}/tasks/${task.id}`,
          });
        }
      }
    }

    return managerEscalationMap;
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
   * Send escalation notification to a manager via the notifications service.
   */
  async sendEscalationNotification(
    tenantId: string,
    data: ManagerEscalationData
  ): Promise<boolean> {
    try {
      const response = await fetch(
        `${process.env.NOTIFICATIONS_SERVICE_URL || 'http://localhost:4004'}/api/notifications/send`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-tenant-id': tenantId,
          },
          body: JSON.stringify({
            template: 'escalation-batch',
            channel: 'email',
            recipient: {
              userId: data.manager.id,
              email: data.manager.email,
              name: `${data.manager.firstName} ${data.manager.lastName}`,
            },
            data: {
              recipientName: data.manager.firstName,
              escalations: data.escalations,
              metrics: data.metrics,
            },
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
        logger.error(
          { managerId: data.manager.id, status: response.status },
          'Failed to send escalation notification'
        );
        return false;
      }
    } catch (error) {
      logger.error({ managerId: data.manager.id, error }, 'Error sending escalation notification');
      return false;
    }
  }
}
