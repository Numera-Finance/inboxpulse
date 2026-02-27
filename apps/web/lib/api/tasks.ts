import { getTaskClient } from './clients';
import type {
  Task,
  TaskComment,
  TaskSearchRequest,
  TaskSearchResponse,
  CreateTaskRequest,
  AssignableUser,
  MarkDoneRequest,
} from '@crm/clients';

/**
 * Search tasks with filters and pagination
 */
export async function searchTasks(
  request: TaskSearchRequest,
  signal?: AbortSignal
): Promise<TaskSearchResponse> {
  return getTaskClient().search(request, signal);
}

/**
 * Get a task by ID with relations
 */
export async function getTask(id: string, signal?: AbortSignal): Promise<Task | null> {
  return getTaskClient().getById(id, signal);
}

/**
 * Create a new task
 */
export async function createTask(
  data: CreateTaskRequest,
  signal?: AbortSignal
): Promise<Task> {
  return getTaskClient().create(data, signal);
}

/**
 * Mark a task as done
 */
export async function markTaskDone(id: string, data: MarkDoneRequest, signal?: AbortSignal): Promise<Task> {
  return getTaskClient().markDone(id, data, signal);
}

/**
 * Reopen a done task
 */
export async function reopenTask(id: string, signal?: AbortSignal): Promise<Task> {
  return getTaskClient().reopen(id, signal);
}

/**
 * Reassign a task to another user
 */
export async function reassignTask(
  id: string,
  assignedToId: string | null,
  signal?: AbortSignal
): Promise<Task> {
  return getTaskClient().reassign(id, assignedToId, signal);
}

/**
 * Get comments for a task
 */
export async function getTaskComments(
  taskId: string,
  signal?: AbortSignal
): Promise<TaskComment[]> {
  return getTaskClient().getComments(taskId, signal);
}

/**
 * Add a comment to a task
 */
export async function addTaskComment(
  taskId: string,
  content: string,
  signal?: AbortSignal
): Promise<TaskComment> {
  return getTaskClient().addComment(taskId, content, signal);
}

/**
 * Get users that can be assigned tasks
 */
export async function getAssignableUsers(signal?: AbortSignal): Promise<AssignableUser[]> {
  return getTaskClient().getAssignableUsers(signal);
}
