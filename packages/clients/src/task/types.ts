import { z } from 'zod';

/**
 * Task status values
 */
export const TaskStatus = {
  OPEN: 0,
  DONE: 1,
} as const;

export type TaskStatusType = (typeof TaskStatus)[keyof typeof TaskStatus];

/**
 * Zod schema for Task
 */
export const taskSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  emailId: z.string().uuid().nullable().optional(),
  customerId: z.string().uuid(),
  title: z.string(),
  status: z.number().int(),
  assignedToId: z.string().uuid().nullable().optional(),
  createdBySystem: z.boolean(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
  completedAt: z.coerce.date().nullable().optional(),
  // Relations (populated by API)
  customerName: z.string().nullable().optional(),
  customerDomain: z.string().optional(),
  assignedToName: z.string().nullable().optional(),
  emailSubject: z.string().nullable().optional(),
  emailBody: z.string().nullable().optional(),
  emailFromEmail: z.string().nullable().optional(),
  emailFromName: z.string().nullable().optional(),
});

export type Task = z.infer<typeof taskSchema>;

/**
 * Zod schema for TaskComment
 */
export const taskCommentSchema = z.object({
  id: z.string().uuid(),
  taskId: z.string().uuid(),
  userId: z.string().uuid(),
  content: z.string(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
  userName: z.string(),
});

export type TaskComment = z.infer<typeof taskCommentSchema>;

/**
 * Signal filter values for email sentiment/signal filtering
 */
export type SignalFilterType = 'positive' | 'negative' | 'neutral' | 'upsell' | 'churn' | 'tat';

/**
 * Search request for tasks
 */
export interface TaskSearchRequest {
  status?: 'open' | 'done';
  assignedToId?: string;
  customerId?: string;
  search?: string;
  sortBy?: 'createdAt' | 'updatedAt';
  sortOrder?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
  dateFrom?: Date | string;
  dateTo?: Date | string;
  signal?: SignalFilterType;
}

/**
 * Search response for tasks
 */
export interface TaskSearchResponse {
  items: Task[];
  total: number;
  limit: number;
  offset: number;
}

/**
 * Request to create a task
 */
export interface CreateTaskRequest {
  customerId: string;
  title: string;
  emailId?: string;
  assignedToId?: string;
}

/**
 * Assignable user for dropdown
 */
export interface AssignableUser {
  id: string;
  name: string;
}

/**
 * Export request for tasks (no pagination limit)
 */
export interface TaskExportRequest {
  status?: 'open' | 'done';
  assignedToId?: string;
  customerId?: string;
  dateFrom?: Date | string;
  dateTo?: Date | string;
  signal?: SignalFilterType;
}

/**
 * Task with comments for export
 */
export interface TaskWithComments extends Task {
  comments: TaskComment[];
}
