# Tasks & Escalation Implementation Plan

## Overview

This document outlines the implementation plan for the Escalation page using Tasks. The implementation will reuse the existing InboxView component system and follow the established patterns in the codebase.

---

## 1. Database Schema

### 1.1 Tasks Table (`tasks`)

```sql
CREATE TABLE tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    
    -- Reference to email that triggered this task
    email_id UUID REFERENCES emails(id) ON DELETE SET NULL,
    
    -- Customer reference
    customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    
    -- Assignment
    assigned_to_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    
    -- Status: 'open' | 'done'
    status VARCHAR(20) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done')),
    
    -- Task metadata
    title TEXT NOT NULL, -- Derived from email subject or custom
    description TEXT, -- Derived from email body or custom
    
    -- Dates
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    done_at TIMESTAMPTZ, -- When status changed to 'done'
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Priority (optional, for future use)
    priority VARCHAR(20) DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'critical')),
    
    -- Additional metadata
    metadata JSONB DEFAULT '{}'::jsonb
);

-- Indexes
CREATE INDEX idx_tasks_tenant_status ON tasks(tenant_id, status);
CREATE INDEX idx_tasks_assigned_user ON tasks(assigned_to_user_id, status);
CREATE INDEX idx_tasks_customer ON tasks(customer_id);
CREATE INDEX idx_tasks_email ON tasks(email_id);
CREATE INDEX idx_tasks_created ON tasks(created_at DESC);
CREATE INDEX idx_tasks_status_created ON tasks(status, created_at DESC);
```

### 1.2 Task Comments Table (`task_comments`)

```sql
CREATE TABLE task_comments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    
    -- Comment content
    comment TEXT NOT NULL,
    
    -- Author
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    
    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_task_comments_task ON task_comments(task_id, created_at DESC);
CREATE INDEX idx_task_comments_user ON task_comments(user_id);
CREATE INDEX idx_task_comments_tenant ON task_comments(tenant_id);
```

### 1.3 SQL Migration File

**File:** `apps/api/sql/tasks.sql`

```sql
-- =============================================================================
-- Tasks Table
-- =============================================================================
-- Tasks created from negative emails or manual escalation
-- DEPENDENCIES: Run after tenants.sql, users.sql, customers.sql, emails.sql
-- =============================================================================

DROP TABLE IF EXISTS task_comments CASCADE;
DROP TABLE IF EXISTS tasks CASCADE;

CREATE TABLE tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    
    -- Reference to email that triggered this task
    email_id UUID REFERENCES emails(id) ON DELETE SET NULL,
    
    -- Customer reference
    customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    
    -- Assignment
    assigned_to_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    
    -- Status: 'open' | 'done'
    status VARCHAR(20) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done')),
    
    -- Task metadata
    title TEXT NOT NULL,
    description TEXT,
    
    -- Dates
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    done_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Priority (optional, for future use)
    priority VARCHAR(20) DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'critical')),
    
    -- Additional metadata
    metadata JSONB DEFAULT '{}'::jsonb
);

CREATE INDEX idx_tasks_tenant_status ON tasks(tenant_id, status);
CREATE INDEX idx_tasks_assigned_user ON tasks(assigned_to_user_id, status);
CREATE INDEX idx_tasks_customer ON tasks(customer_id);
CREATE INDEX idx_tasks_email ON tasks(email_id);
CREATE INDEX idx_tasks_created ON tasks(created_at DESC);
CREATE INDEX idx_tasks_status_created ON tasks(status, created_at DESC);

-- =============================================================================
-- Task Comments Table
-- =============================================================================

CREATE TABLE task_comments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    
    -- Comment content
    comment TEXT NOT NULL,
    
    -- Author
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    
    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_task_comments_task ON task_comments(task_id, created_at DESC);
CREATE INDEX idx_task_comments_user ON task_comments(user_id);
CREATE INDEX idx_task_comments_tenant ON task_comments(tenant_id);
```

---

## 2. Backend Implementation

### 2.1 Schema (`apps/api/src/tasks/schema.ts`)

```typescript
import { pgTable, uuid, text, timestamp, varchar, jsonb, index } from 'drizzle-orm/pg-core';
import { v7 as uuidv7 } from 'uuid';
import { tenants } from '../tenants/schema';
import { users } from '../users/schema';
import { customers } from '../customers/schema';
import { emails } from '../emails/schema';

export const tasks = pgTable(
  'tasks',
  {
    id: uuid('id').primaryKey().$defaultFn(() => uuidv7()),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
    
    emailId: uuid('email_id').references(() => emails.id, { onDelete: 'set null' }),
    customerId: uuid('customer_id').notNull().references(() => customers.id, { onDelete: 'cascade' }),
    assignedToUserId: uuid('assigned_to_user_id').references(() => users.id, { onDelete: 'set null' }),
    
    status: varchar('status', { length: 20 }).notNull().default('open'),
    title: text('title').notNull(),
    description: text('description'),
    
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    doneAt: timestamp('done_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    
    priority: varchar('priority', { length: 20 }).default('normal'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}),
  },
  (table) => [
    index('idx_tasks_tenant_status').on(table.tenantId, table.status),
    index('idx_tasks_assigned_user').on(table.assignedToUserId, table.status),
    index('idx_tasks_customer').on(table.customerId),
    index('idx_tasks_email').on(table.emailId),
    index('idx_tasks_created').on(table.createdAt),
    index('idx_tasks_status_created').on(table.status, table.createdAt),
  ]
);

export const taskComments = pgTable(
  'task_comments',
  {
    id: uuid('id').primaryKey().$defaultFn(() => uuidv7()),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
    taskId: uuid('task_id').notNull().references(() => tasks.id, { onDelete: 'cascade' }),
    
    comment: text('comment').notNull(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_task_comments_task').on(table.taskId, table.createdAt),
    index('idx_task_comments_user').on(table.userId),
    index('idx_task_comments_tenant').on(table.tenantId),
  ]
);

export type Task = typeof tasks.$inferSelect;
export type NewTask = typeof tasks.$inferInsert;
export type TaskComment = typeof taskComments.$inferSelect;
export type NewTaskComment = typeof taskComments.$inferInsert;
```

### 2.2 Repository (`apps/api/src/tasks/repository.ts`)

```typescript
import { injectable, inject } from 'tsyringe';
import { eq, and, or, desc, ilike, gte, lte, inArray, isNull } from 'drizzle-orm';
import type { Database } from '@crm/database';
import type { RequestHeader } from '@crm/shared';
import { BaseRepository } from '../utils/base-repository';
import { tasks, taskComments, type Task, type NewTask, type TaskComment, type NewTaskComment } from './schema';
import { userManagers } from '../users/schema';

export interface TaskFilters {
  status?: 'open' | 'done' | 'all';
  assignedToUserId?: string | 'unassigned' | 'me' | 'my-team';
  customerId?: string;
  dateFrom?: Date;
  dateTo?: Date;
  search?: string;
}

export interface TaskPagination {
  page: number;
  limit: number;
}

export interface TaskPage {
  items: Task[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
}

@injectable()
export class TaskRepository extends BaseRepository {
  constructor(@inject('Database') db: Database) {
    super(db, tasks);
  }

  /**
   * Get tasks with scoped access (user's tasks + subordinates' tasks)
   */
  async findScoped(
    header: RequestHeader,
    filters: TaskFilters = {},
    pagination: TaskPagination = { page: 1, limit: 20 }
  ): Promise<TaskPage> {
    const { tenantId, userId } = header;
    
    // Build user scope: user's own tasks + subordinates' tasks
    const subordinateUserIds = await this.getSubordinateUserIds(userId, tenantId);
    const accessibleUserIds = [userId, ...subordinateUserIds];
    
    // Build conditions
    const conditions = [eq(tasks.tenantId, tenantId)];
    
    // Status filter
    if (filters.status && filters.status !== 'all') {
      conditions.push(eq(tasks.status, filters.status));
    }
    
    // Assignment filter
    if (filters.assignedToUserId) {
      if (filters.assignedToUserId === 'me') {
        conditions.push(eq(tasks.assignedToUserId, userId));
      } else if (filters.assignedToUserId === 'my-team') {
        conditions.push(inArray(tasks.assignedToUserId, accessibleUserIds));
      } else if (filters.assignedToUserId === 'unassigned') {
        conditions.push(isNull(tasks.assignedToUserId));
      } else {
        // Only allow if user has access to this user's tasks
        if (accessibleUserIds.includes(filters.assignedToUserId)) {
          conditions.push(eq(tasks.assignedToUserId, filters.assignedToUserId));
        }
      }
    } else {
      // Default: show tasks assigned to user or subordinates
      conditions.push(
        or(
          inArray(tasks.assignedToUserId, accessibleUserIds),
          isNull(tasks.assignedToUserId) // Include unassigned
        )!
      );
    }
    
    // Customer filter
    if (filters.customerId) {
      conditions.push(eq(tasks.customerId, filters.customerId));
    }
    
    // Date range filter
    if (filters.dateFrom) {
      conditions.push(gte(tasks.createdAt, filters.dateFrom));
    }
    if (filters.dateTo) {
      conditions.push(lte(tasks.createdAt, filters.dateTo));
    }
    
    // Search filter (title, description)
    if (filters.search) {
      const searchPattern = `%${filters.search}%`;
      conditions.push(
        or(
          ilike(tasks.title, searchPattern),
          ilike(tasks.description, searchPattern)
        )!
      );
    }
    
    // Count total
    const totalResult = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(tasks)
      .where(and(...conditions));
    const total = Number(totalResult[0]?.count || 0);
    
    // Fetch paginated results
    const offset = (pagination.page - 1) * pagination.limit;
    const items = await this.db
      .select()
      .from(tasks)
      .where(and(...conditions))
      .orderBy(desc(tasks.createdAt))
      .limit(pagination.limit)
      .offset(offset);
    
    return {
      items: items as Task[],
      total,
      page: pagination.page,
      limit: pagination.limit,
      hasMore: offset + pagination.limit < total,
    };
  }

  /**
   * Get subordinate user IDs (users who report to this user)
   */
  private async getSubordinateUserIds(userId: string, tenantId: string): Promise<string[]> {
    const subordinates = await this.db
      .select({ userId: userManagers.userId })
      .from(userManagers)
      .where(eq(userManagers.managerId, userId));
    
    return subordinates.map(s => s.userId);
  }

  /**
   * Get task with comments
   */
  async findByIdWithComments(id: string, header: RequestHeader): Promise<(Task & { comments: TaskComment[] }) | null> {
    const task = await this.findById(id, header);
    if (!task) return null;
    
    const comments = await this.db
      .select()
      .from(taskComments)
      .where(and(
        eq(taskComments.taskId, id),
        eq(taskComments.tenantId, header.tenantId)
      ))
      .orderBy(desc(taskComments.createdAt));
    
    return {
      ...task,
      comments: comments as TaskComment[],
    };
  }

  /**
   * Create task
   */
  async create(data: NewTask, header: RequestHeader): Promise<Task> {
    const result = await this.db
      .insert(tasks)
      .values({
        ...data,
        tenantId: header.tenantId,
      })
      .returning();
    
    return result[0] as Task;
  }

  /**
   * Update task
   */
  async update(id: string, data: Partial<NewTask>, header: RequestHeader): Promise<Task | null> {
    const updateData: any = {
      ...data,
      updatedAt: new Date(),
    };
    
    // If status changed to 'done', set doneAt
    if (data.status === 'done' && !data.doneAt) {
      updateData.doneAt = new Date();
    }
    // If status changed from 'done' to 'open', clear doneAt
    if (data.status === 'open' && data.doneAt === null) {
      updateData.doneAt = null;
    }
    
    const result = await this.db
      .update(tasks)
      .set(updateData)
      .where(and(
        eq(tasks.id, id),
        eq(tasks.tenantId, header.tenantId)
      ))
      .returning();
    
    return result[0] as Task || null;
  }

  /**
   * Add comment to task
   */
  async addComment(taskId: string, comment: string, header: RequestHeader): Promise<TaskComment> {
    const result = await this.db
      .insert(taskComments)
      .values({
        taskId,
        comment,
        userId: header.userId,
        tenantId: header.tenantId,
      })
      .returning();
    
    return result[0] as TaskComment;
  }

  /**
   * Reassign task
   */
  async reassign(id: string, assignedToUserId: string | null, header: RequestHeader): Promise<Task | null> {
    return this.update(id, { assignedToUserId }, header);
  }

  /**
   * Mark task as done
   */
  async markDone(id: string, header: RequestHeader): Promise<Task | null> {
    return this.update(id, { status: 'done' }, header);
  }
}
```

### 2.3 Service (`apps/api/src/tasks/service.ts`)

```typescript
import { injectable, inject } from 'tsyringe';
import type { Database } from '@crm/database';
import type { RequestHeader } from '@crm/shared';
import { TaskRepository, type TaskFilters, type TaskPagination } from './repository';
import { EmailRepository } from '../emails/repository';

@injectable()
export class TaskService {
  constructor(
    @inject('Database') private db: Database,
    @inject('TaskRepository') private taskRepo: TaskRepository,
    @inject('EmailRepository') private emailRepo: EmailRepository
  ) {}

  /**
   * Create task from negative email
   */
  async createFromEmail(emailId: string, header: RequestHeader): Promise<Task> {
    const email = await this.emailRepo.findById(emailId, header);
    if (!email) {
      throw new Error(`Email not found: ${emailId}`);
    }
    
    // Extract customer from email participants
    const customerId = await this.extractCustomerFromEmail(email, header);
    if (!customerId) {
      throw new Error('Could not determine customer from email');
    }
    
    return this.taskRepo.create({
      emailId: email.id,
      customerId,
      title: email.subject || 'Untitled Task',
      description: email.body || '',
      status: 'open',
      assignedToUserId: null, // Will be assigned by rules later
    }, header);
  }

  /**
   * Get tasks with filters and pagination
   */
  async findTasks(
    filters: TaskFilters,
    pagination: TaskPagination,
    header: RequestHeader
  ) {
    return this.taskRepo.findScoped(header, filters, pagination);
  }

  /**
   * Get task by ID with comments
   */
  async getTaskById(id: string, header: RequestHeader) {
    return this.taskRepo.findByIdWithComments(id, header);
  }

  /**
   * Mark task as done
   */
  async markDone(id: string, header: RequestHeader) {
    return this.taskRepo.markDone(id, header);
  }

  /**
   * Reassign task
   */
  async reassign(id: string, assignedToUserId: string | null, header: RequestHeader) {
    // Validate that assigned user is accessible (user or subordinate)
    if (assignedToUserId) {
      const subordinateIds = await this.taskRepo.getSubordinateUserIds(header.userId, header.tenantId);
      const accessibleIds = [header.userId, ...subordinateIds];
      if (!accessibleIds.includes(assignedToUserId)) {
        throw new Error('Cannot assign task to user outside your scope');
      }
    }
    
    return this.taskRepo.reassign(id, assignedToUserId, header);
  }

  /**
   * Add comment to task
   */
  async addComment(taskId: string, comment: string, header: RequestHeader) {
    return this.taskRepo.addComment(taskId, comment, header);
  }

  /**
   * Extract customer ID from email participants
   */
  private async extractCustomerFromEmail(email: any, header: RequestHeader): Promise<string | null> {
    // Implementation: Extract customer from email participants
    // This would query email_participants table to find customer
    // For now, return null - to be implemented based on your email_participants schema
    return null;
  }
}
```

### 2.4 Routes (`apps/api/src/tasks/routes.ts`)

```typescript
import { Hono } from 'hono';
import { container } from 'tsyringe';
import { z } from 'zod';
import { TaskService } from './service';
import { handleGetRequest, handlePostRequest } from '../utils/api-handler';
import type { RequestHeader } from '@crm/shared';

const app = new Hono();

const taskFiltersSchema = z.object({
  status: z.enum(['open', 'done', 'all']).optional(),
  assignedToUserId: z.string().uuid().or(z.enum(['unassigned', 'me', 'my-team'])).optional(),
  customerId: z.string().uuid().optional(),
  dateFrom: z.string().datetime().optional(),
  dateTo: z.string().datetime().optional(),
  search: z.string().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

const createTaskFromEmailSchema = z.object({
  emailId: z.string().uuid(),
});

const addCommentSchema = z.object({
  comment: z.string().min(1),
});

const reassignTaskSchema = z.object({
  assignedToUserId: z.string().uuid().nullable(),
});

/**
 * GET /api/tasks
 * Get tasks with filters and pagination
 */
app.get('/', handleGetRequest(async (c, header: RequestHeader) => {
  const query = taskFiltersSchema.parse(c.req.query());
  
  const taskService = container.resolve(TaskService);
  const result = await taskService.findTasks(
    {
      status: query.status,
      assignedToUserId: query.assignedToUserId,
      customerId: query.customerId,
      dateFrom: query.dateFrom ? new Date(query.dateFrom) : undefined,
      dateTo: query.dateTo ? new Date(query.dateTo) : undefined,
      search: query.search,
    },
    {
      page: query.page,
      limit: query.limit,
    },
    header
  );
  
  return result;
}));

/**
 * GET /api/tasks/:id
 * Get task by ID with comments
 */
app.get('/:id', handleGetRequest(async (c, header: RequestHeader) => {
  const id = c.req.param('id');
  
  const taskService = container.resolve(TaskService);
  const task = await taskService.getTaskById(id, header);
  
  if (!task) {
    return c.json({ error: 'Task not found' }, 404);
  }
  
  return task;
}));

/**
 * POST /api/tasks
 * Create task from email
 */
app.post('/', handlePostRequest(async (c, header: RequestHeader) => {
  const body = createTaskFromEmailSchema.parse(await c.req.json());
  
  const taskService = container.resolve(TaskService);
  const task = await taskService.createFromEmail(body.emailId, header);
  
  return task;
}));

/**
 * POST /api/tasks/:id/done
 * Mark task as done
 */
app.post('/:id/done', handlePostRequest(async (c, header: RequestHeader) => {
  const id = c.req.param('id');
  
  const taskService = container.resolve(TaskService);
  const task = await taskService.markDone(id, header);
  
  if (!task) {
    return c.json({ error: 'Task not found' }, 404);
  }
  
  return task;
}));

/**
 * POST /api/tasks/:id/reassign
 * Reassign task
 */
app.post('/:id/reassign', handlePostRequest(async (c, header: RequestHeader) => {
  const id = c.req.param('id');
  const body = reassignTaskSchema.parse(await c.req.json());
  
  const taskService = container.resolve(TaskService);
  const task = await taskService.reassign(id, body.assignedToUserId, header);
  
  if (!task) {
    return c.json({ error: 'Task not found' }, 404);
  }
  
  return task;
}));

/**
 * POST /api/tasks/:id/comments
 * Add comment to task
 */
app.post('/:id/comments', handlePostRequest(async (c, header: RequestHeader) => {
  const id = c.req.param('id');
  const body = addCommentSchema.parse(await c.req.json());
  
  const taskService = container.resolve(TaskService);
  const comment = await taskService.addComment(id, body.comment, header);
  
  return comment;
}));

export default app;
```

---

## 3. Frontend Implementation

### 3.1 Task Adapter (`apps/web/components/inbox/adapters.ts` - Add)

```typescript
import type { Task, TaskComment } from '@/lib/types/tasks';
import type { InboxItem, InboxItemContent, InboxItemAdapter, InboxContentAdapter } from './types';

/**
 * Convert Task to InboxItem
 */
export const taskToInboxItem: InboxItemAdapter<Task> = (task: Task): InboxItem<Task> => {
  return {
    id: task.id,
    type: 'task',
    subject: task.title,
    preview: task.description || '',
    timestamp: new Date(task.createdAt),
    isRead: task.status === 'done',
    isStarred: false,
    sender: {
      id: task.assignedToUserId || undefined,
      name: 'System', // Will be populated with actual user name
      email: undefined,
    },
    recipients: task.assignedToUserId ? [{
      id: task.assignedToUserId,
      name: 'Assigned User', // Will be populated
    }] : undefined,
    status: task.status === 'done' ? 'resolved' : 'open',
    priority: mapTaskPriority(task.priority),
    customerId: task.customerId,
    customerName: undefined, // Will be populated
    originalData: task,
  };
};

/**
 * Convert Task with comments to InboxItemContent
 */
export const taskToInboxContent: InboxContentAdapter<Task & { comments?: TaskComment[] }> = (
  task: Task & { comments?: TaskComment[] }
): InboxItemContent => {
  const commentsHtml = task.comments?.map(c => `
    <div class="task-comment">
      <div class="comment-author">${c.userId}</div>
      <div class="comment-date">${new Date(c.createdAt).toLocaleString()}</div>
      <div class="comment-body">${c.comment}</div>
    </div>
  `).join('') || '';
  
  return {
    id: task.id,
    subject: task.title,
    body: `${task.description || ''}\n\n${commentsHtml}`,
    bodyFormat: 'html',
    from: {
      id: task.assignedToUserId || undefined,
      name: 'System',
    },
    timestamp: new Date(task.createdAt),
    metadata: {
      taskId: task.id,
      emailId: task.emailId,
      customerId: task.customerId,
      status: task.status,
      comments: task.comments || [],
    },
  };
};

function mapTaskPriority(priority?: string | null): 'critical' | 'high' | 'medium' | 'low' {
  switch (priority) {
    case 'critical': return 'critical';
    case 'high': return 'high';
    case 'low': return 'low';
    default: return 'medium';
  }
}
```

### 3.2 Extensible Filter Component (`apps/web/components/tasks/task-filters.tsx`)

```typescript
"use client"

import * as React from "react"
import { Calendar, User, Building2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Calendar as CalendarComponent } from "@/components/ui/calendar"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { format } from "date-fns"

export interface TaskFilter {
  status?: 'open' | 'done' | 'all'
  assignedToUserId?: string | 'unassigned' | 'me' | 'my-team'
  customerId?: string
  dateFrom?: Date
  dateTo?: Date
}

export interface FilterConfig {
  id: string
  label: string
  icon?: React.ReactNode
  type: 'status' | 'assignee' | 'customer' | 'date-range'
  options?: Array<{ value: string; label: string }>
}

interface TaskFiltersProps {
  filters: TaskFilter
  onFiltersChange: (filters: TaskFilter) => void
  filterConfigs?: FilterConfig[]
  availableAssignees?: Array<{ id: string; name: string }>
  availableCustomers?: Array<{ id: string; name: string }>
}

export function TaskFilters({
  filters,
  onFiltersChange,
  filterConfigs = [],
  availableAssignees = [],
  availableCustomers = [],
}: TaskFiltersProps) {
  const [dateRange, setDateRange] = React.useState<{ from?: Date; to?: Date }>({
    from: filters.dateFrom,
    to: filters.dateTo,
  })

  const updateFilter = (key: keyof TaskFilter, value: any) => {
    onFiltersChange({ ...filters, [key]: value })
  }

  const clearFilter = (key: keyof TaskFilter) => {
    const newFilters = { ...filters }
    delete newFilters[key]
    onFiltersChange(newFilters)
  }

  const activeFilterCount = Object.keys(filters).filter(k => filters[k as keyof TaskFilter] !== undefined).length

  // Default filter configs
  const defaultConfigs: FilterConfig[] = [
    {
      id: 'status',
      label: 'Status',
      type: 'status',
      options: [
        { value: 'all', label: 'All' },
        { value: 'open', label: 'Open' },
        { value: 'done', label: 'Done' },
      ],
    },
    {
      id: 'assignee',
      label: 'Assigned To',
      icon: <User className="h-4 w-4" />,
      type: 'assignee',
      options: [
        { value: 'me', label: 'Me' },
        { value: 'my-team', label: 'My Team' },
        { value: 'unassigned', label: 'Unassigned' },
        ...availableAssignees.map(a => ({ value: a.id, label: a.name })),
      ],
    },
    {
      id: 'customer',
      label: 'Customer',
      icon: <Building2 className="h-4 w-4" />,
      type: 'customer',
      options: availableCustomers.map(c => ({ value: c.id, label: c.name })),
    },
    {
      id: 'date',
      label: 'Date',
      icon: <Calendar className="h-4 w-4" />,
      type: 'date-range',
    },
  ]

  const allConfigs = [...defaultConfigs, ...filterConfigs]

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {allConfigs.map((config) => {
        if (config.type === 'status') {
          return (
            <Select
              key={config.id}
              value={filters.status || 'all'}
              onValueChange={(value) => updateFilter('status', value === 'all' ? undefined : value)}
            >
              <SelectTrigger className="h-8 w-[120px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {config.options?.map(opt => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )
        }

        if (config.type === 'assignee') {
          return (
            <Select
              key={config.id}
              value={filters.assignedToUserId || ''}
              onValueChange={(value) => updateFilter('assignedToUserId', value || undefined)}
            >
              <SelectTrigger className="h-8 w-[140px]">
                <div className="flex items-center gap-2">
                  {config.icon}
                  <SelectValue placeholder={config.label} />
                </div>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">All</SelectItem>
                {config.options?.map(opt => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )
        }

        if (config.type === 'customer') {
          return (
            <Select
              key={config.id}
              value={filters.customerId || ''}
              onValueChange={(value) => updateFilter('customerId', value || undefined)}
            >
              <SelectTrigger className="h-8 w-[160px]">
                <div className="flex items-center gap-2">
                  {config.icon}
                  <SelectValue placeholder={config.label} />
                </div>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">All Customers</SelectItem>
                {config.options?.map(opt => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )
        }

        if (config.type === 'date-range') {
          return (
            <Popover key={config.id}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className={cn(
                    "h-8 justify-start text-left font-normal",
                    !dateRange.from && "text-muted-foreground"
                  )}
                >
                  {config.icon}
                  {dateRange.from ? (
                    dateRange.to ? (
                      <>
                        {format(dateRange.from, "LLL dd, y")} -{" "}
                        {format(dateRange.to, "LLL dd, y")}
                      </>
                    ) : (
                      format(dateRange.from, "LLL dd, y")
                    )
                  ) : (
                    <span>Pick a date</span>
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <CalendarComponent
                  initialFocus
                  mode="range"
                  defaultMonth={dateRange.from}
                  selected={{ from: dateRange.from, to: dateRange.to }}
                  onSelect={(range) => {
                    setDateRange(range || {})
                    updateFilter('dateFrom', range?.from)
                    updateFilter('dateTo', range?.to)
                  }}
                  numberOfMonths={2}
                />
              </PopoverContent>
            </Popover>
          )
        }

        return null
      })}

      {activeFilterCount > 0 && (
        <Button
          variant="ghost"
          size="sm"
          className="h-8"
          onClick={() => onFiltersChange({})}
        >
          Clear ({activeFilterCount})
        </Button>
      )}
    </div>
  )
}
```

### 3.3 Escalations Page (`apps/web/app/escalations/page.tsx` - Update)

```typescript
"use client"

import * as React from "react"
import { AppShell } from "@/components/app-shell"
import { InboxView } from "@/components/inbox"
import { TaskFilters, type TaskFilter } from "@/components/tasks/task-filters"
import type { InboxItem, InboxItemContent, InboxFilter, InboxPagination, InboxPage } from "@/components/inbox/types"
import { taskToInboxItem, taskToInboxContent } from "@/components/inbox/adapters"
import { api } from "@/lib/api"

export default function EscalationsPage() {
  const [filters, setFilters] = React.useState<TaskFilter>({})
  const [selectedTask, setSelectedTask] = React.useState<InboxItem | null>(null)

  const callbacks = {
    onFetchItems: async (
      filter: InboxFilter,
      pagination: InboxPagination
    ): Promise<InboxPage<InboxItem>> => {
      // Convert InboxFilter to TaskFilter
      const taskFilters: TaskFilter = {
        status: filter.status === 'all' ? undefined : filter.status,
        assignedToUserId: filters.assignedToUserId,
        customerId: filters.customerId,
        dateFrom: filter.dateFrom,
        dateTo: filter.dateTo,
        search: filter.query,
      }

      const response = await api.get('/tasks', {
        params: {
          ...taskFilters,
          page: pagination.page,
          limit: pagination.limit,
        },
      })

      const tasks = response.data.items || []
      return {
        items: tasks.map(taskToInboxItem),
        total: response.data.total || 0,
        page: pagination.page,
        limit: pagination.limit,
        hasMore: response.data.hasMore || false,
      }
    },

    onFetchContent: async (itemId: string): Promise<InboxItemContent> => {
      const response = await api.get(`/tasks/${itemId}`)
      return taskToInboxContent(response.data)
    },

    onSelect: (item: InboxItem) => {
      setSelectedTask(item)
    },

    onUpdateStatus: async (itemId: string, status: 'open' | 'in_progress' | 'resolved' | 'archived') => {
      if (status === 'resolved') {
        await api.post(`/tasks/${itemId}/done`)
      }
      // Refresh list
    },

    onAssign: async (itemId: string, userId: string) => {
      await api.post(`/tasks/${itemId}/reassign`, { assignedToUserId: userId })
    },

    onResolve: async (itemId: string) => {
      await api.post(`/tasks/${itemId}/done`)
    },
  }

  return (
    <AppShell>
      <div className="flex h-[calc(100vh-3.5rem)] flex-col">
        <div className="border-b p-4">
          <div className="flex items-center justify-between mb-4">
            <h1 className="text-2xl font-semibold">Escalations</h1>
          </div>
          <TaskFilters
            filters={filters}
            onFiltersChange={setFilters}
          />
        </div>
        
        <div className="flex-1 overflow-hidden">
          <InboxView
            config={{
              itemType: 'task',
              showSearch: true,
              showStatusFilter: true,
              showPriority: true,
              showCustomer: true,
              searchPlaceholder: "Search tasks...",
            }}
            callbacks={callbacks}
            selectedItem={selectedTask}
            initialFilter={{
              status: filters.status || 'all',
              customerId: filters.customerId,
              dateFrom: filters.dateFrom,
              dateTo: filters.dateTo,
            }}
          />
        </div>
      </div>
    </AppShell>
  )
}
```

### 3.4 Task Detail Panel Actions (`apps/web/components/inbox/inbox-detail-panel.tsx` - Extend)

Add task-specific actions:
- Done button (primary)
- Reassign dropdown
- Add comment section

---

## 4. Integration Points

### 4.1 Auto-Create Tasks from Negative Emails

**Location:** `apps/api/src/emails/inngest/functions.ts` or email analysis service

When an email is analyzed and detected as negative/escalation:
1. Check if task already exists for this email
2. Create task via `TaskService.createFromEmail()`
3. Optionally trigger notification

---

## 5. UI Changes Summary

### 5.1 New Components
- `TaskFilters` - Extensible filter component
- Task-specific adapters in `inbox/adapters.ts`

### 5.2 Updated Components
- `EscalationsPage` - Use `InboxView` instead of custom implementation
- `InboxDetailPanel` - Add task actions (Done, Reassign, Add Comment)

### 5.3 Filter Extensibility

The `TaskFilters` component accepts `filterConfigs` prop, allowing future filters to be added:

```typescript
<TaskFilters
  filters={filters}
  onFiltersChange={setFilters}
  filterConfigs={[
    {
      id: 'priority',
      label: 'Priority',
      type: 'select', // New type
      options: [
        { value: 'critical', label: 'Critical' },
        { value: 'high', label: 'High' },
      ],
    },
  ]}
/>
```

---

## 6. Implementation Checklist

### Backend
- [ ] Create SQL migration file (`apps/api/sql/tasks.sql`)
- [ ] Create schema file (`apps/api/src/tasks/schema.ts`)
- [ ] Create repository (`apps/api/src/tasks/repository.ts`)
- [ ] Create service (`apps/api/src/tasks/service.ts`)
- [ ] Create routes (`apps/api/src/tasks/routes.ts`)
- [ ] Register routes in main app (`apps/api/src/index.ts`)
- [ ] Register repository/service in DI container
- [ ] Add task creation trigger in email analysis service

### Frontend
- [ ] Create task adapters (`apps/web/components/inbox/adapters.ts`)
- [ ] Create `TaskFilters` component (`apps/web/components/tasks/task-filters.tsx`)
- [ ] Update `EscalationsPage` to use `InboxView`
- [ ] Extend `InboxDetailPanel` with task actions
- [ ] Add API client methods for tasks
- [ ] Add task types (`apps/web/lib/types/tasks.ts`)

### Testing
- [ ] Test task creation from email
- [ ] Test scoped access (user + subordinates)
- [ ] Test filters (status, assignee, customer, date, search)
- [ ] Test actions (Done, Reassign, Add Comment)
- [ ] Test pagination

---

## 7. Future Enhancements

1. **Task Assignment Rules** - Auto-assign based on customer, email content, etc.
2. **Task Templates** - Predefined task types
3. **Task Dependencies** - Link related tasks
4. **Task Time Tracking** - Track time spent on tasks
5. **Task Notifications** - Notify assignees of new tasks/comments
6. **Task Analytics** - Dashboard for task metrics

---

## Notes

- The implementation reuses the existing `InboxView` component, ensuring UI consistency
- Filters are extensible via `filterConfigs` prop
- Scoped access ensures users only see their tasks and subordinates' tasks
- Task creation from emails is automatic when negative sentiment is detected
- The system follows existing patterns (schema → repository → service → routes)
