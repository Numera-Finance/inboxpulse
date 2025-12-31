import { BaseClient } from '../base-client';
import type { ApiResponse } from '@crm/shared';
import type {
  Task,
  TaskComment,
  TaskSearchRequest,
  TaskSearchResponse,
  CreateTaskRequest,
  AssignableUser,
} from './types';

/**
 * Client for task-related API operations
 */
export class TaskClient extends BaseClient {
  /**
   * Search tasks with filters
   */
  async search(request: TaskSearchRequest, signal?: AbortSignal): Promise<TaskSearchResponse> {
    const response = await this.post<ApiResponse<TaskSearchResponse>>(
      '/api/tasks/search',
      request,
      signal
    );

    if (!response?.data) {
      throw new Error('Invalid API response: missing data');
    }

    return response.data;
  }

  /**
   * Get task by ID with relations
   */
  async getById(id: string, signal?: AbortSignal): Promise<Task | null> {
    const response = await this.get<ApiResponse<Task>>(`/api/tasks/${id}`, signal);
    return response?.data || null;
  }

  /**
   * Create a new task
   */
  async create(data: CreateTaskRequest, signal?: AbortSignal): Promise<Task> {
    const response = await this.post<ApiResponse<Task>>('/api/tasks', data, signal);

    if (!response?.data) {
      throw new Error('Invalid API response: missing data');
    }

    return response.data;
  }

  /**
   * Mark task as done
   */
  async markDone(id: string, signal?: AbortSignal): Promise<Task> {
    const response = await this.post<ApiResponse<Task>>(`/api/tasks/${id}/done`, {}, signal);

    if (!response?.data) {
      throw new Error('Invalid API response: missing data');
    }

    return response.data;
  }

  /**
   * Reopen a done task
   */
  async reopen(id: string, signal?: AbortSignal): Promise<Task> {
    const response = await this.post<ApiResponse<Task>>(`/api/tasks/${id}/reopen`, {}, signal);

    if (!response?.data) {
      throw new Error('Invalid API response: missing data');
    }

    return response.data;
  }

  /**
   * Reassign task to another user
   */
  async reassign(id: string, assignedToId: string | null, signal?: AbortSignal): Promise<Task> {
    const response = await this.put<ApiResponse<Task>>(
      `/api/tasks/${id}/assign`,
      { assignedToId },
      signal
    );

    if (!response?.data) {
      throw new Error('Invalid API response: missing data');
    }

    return response.data;
  }

  /**
   * Get comments for a task
   */
  async getComments(taskId: string, signal?: AbortSignal): Promise<TaskComment[]> {
    const response = await this.get<ApiResponse<TaskComment[]>>(
      `/api/tasks/${taskId}/comments`,
      signal
    );

    return response?.data || [];
  }

  /**
   * Add comment to task
   */
  async addComment(taskId: string, content: string, signal?: AbortSignal): Promise<TaskComment> {
    const response = await this.post<ApiResponse<TaskComment>>(
      `/api/tasks/${taskId}/comments`,
      { content },
      signal
    );

    if (!response?.data) {
      throw new Error('Invalid API response: missing data');
    }

    return response.data;
  }

  /**
   * Get users that can be assigned tasks
   */
  async getAssignableUsers(signal?: AbortSignal): Promise<AssignableUser[]> {
    const response = await this.get<ApiResponse<AssignableUser[]>>(
      '/api/tasks/assignable-users',
      signal
    );

    return response?.data || [];
  }
}
