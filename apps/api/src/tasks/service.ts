import { injectable, inject } from 'tsyringe';
import { z } from 'zod';
import type { RequestHeader } from '@crm/shared';
import { TaskRepository, type TaskWithRelations, type TaskCommentWithUser } from './repository';
import { TaskStatus, type Task, type TaskComment } from './schema';
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

@injectable()
export class TaskService {
  constructor(
    @inject(TaskRepository) private taskRepository: TaskRepository
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
}
