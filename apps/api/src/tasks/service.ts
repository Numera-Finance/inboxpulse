import { injectable, inject } from 'tsyringe';
import type { RequestHeader } from '@crm/shared';
import { TaskRepository, type TaskWithRelations, type TaskCommentWithUser } from './repository';
import { TaskStatus, type Task, type TaskComment } from './schema';
import { logger } from '../utils/logger';

export interface TaskSearchRequest {
  status?: 'open' | 'done';
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

export interface TaskSearchResponse {
  items: TaskWithRelations[];
  total: number;
  limit: number;
  offset: number;
}

export interface CreateTaskRequest {
  customerId: string;
  title: string;
  emailId?: string;
  assignedToId?: string;
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

    const { items, total } = await this.taskRepository.search(header, {
      status,
      assignedToId: request.assignedToId,
      customerId: request.customerId,
      search: request.search,
      sortBy: request.sortBy,
      sortOrder: request.sortOrder,
      limit: request.limit,
      offset: request.offset,
      dateFrom: request.dateFrom,
      dateTo: request.dateTo,
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
