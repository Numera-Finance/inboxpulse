import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as api from '@/lib/api';
import type { TaskSearchRequest, CreateTaskRequest } from '@/lib/api';

// Query keys for cache management
export const taskKeys = {
  all: ['tasks'] as const,
  lists: () => [...taskKeys.all, 'list'] as const,
  list: (filters: TaskSearchRequest) => [...taskKeys.lists(), filters] as const,
  details: () => [...taskKeys.all, 'detail'] as const,
  detail: (id: string) => [...taskKeys.details(), id] as const,
  comments: (taskId: string) => [...taskKeys.all, 'comments', taskId] as const,
  assignableUsers: () => [...taskKeys.all, 'assignable-users'] as const,
};

/**
 * Hook to search/list tasks with pagination and filtering
 */
export function useTasks(request: TaskSearchRequest) {
  return useQuery({
    queryKey: taskKeys.list(request),
    queryFn: () => api.searchTasks(request),
  });
}

/**
 * Hook to get a single task by ID with relations
 */
export function useTask(id: string) {
  return useQuery({
    queryKey: taskKeys.detail(id),
    queryFn: () => api.getTask(id),
    enabled: !!id,
  });
}

/**
 * Hook to get comments for a task
 */
export function useTaskComments(taskId: string) {
  return useQuery({
    queryKey: taskKeys.comments(taskId),
    queryFn: () => api.getTaskComments(taskId),
    enabled: !!taskId,
  });
}

/**
 * Hook to get users that can be assigned tasks
 */
export function useAssignableUsers() {
  return useQuery({
    queryKey: taskKeys.assignableUsers(),
    queryFn: () => api.getAssignableUsers(),
  });
}

/**
 * Hook to create a new task
 */
export function useCreateTask() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateTaskRequest) => api.createTask(data),
    onSuccess: (task) => {
      // Update the cache for this specific task
      queryClient.setQueryData(taskKeys.detail(task.id), task);
      // Invalidate lists to refetch
      queryClient.invalidateQueries({ queryKey: taskKeys.lists() });
    },
  });
}

/**
 * Hook to mark a task as done
 */
export function useMarkTaskDone() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => api.markTaskDone(id),
    onSuccess: (task) => {
      queryClient.setQueryData(taskKeys.detail(task.id), task);
      queryClient.invalidateQueries({ queryKey: taskKeys.lists() });
    },
  });
}

/**
 * Hook to reopen a task
 */
export function useReopenTask() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => api.reopenTask(id),
    onSuccess: (task) => {
      queryClient.setQueryData(taskKeys.detail(task.id), task);
      queryClient.invalidateQueries({ queryKey: taskKeys.lists() });
    },
  });
}

/**
 * Hook to reassign a task
 */
export function useReassignTask() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, assignedToId }: { id: string; assignedToId: string | null }) =>
      api.reassignTask(id, assignedToId),
    onSuccess: (task) => {
      queryClient.setQueryData(taskKeys.detail(task.id), task);
      queryClient.invalidateQueries({ queryKey: taskKeys.lists() });
    },
  });
}

/**
 * Hook to add a comment to a task
 */
export function useAddTaskComment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ taskId, content }: { taskId: string; content: string }) =>
      api.addTaskComment(taskId, content),
    onSuccess: (_, variables) => {
      // Invalidate comments for this task
      queryClient.invalidateQueries({ queryKey: taskKeys.comments(variables.taskId) });
    },
  });
}
