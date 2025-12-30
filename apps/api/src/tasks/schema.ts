import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  smallint,
  text,
  boolean,
  index,
} from 'drizzle-orm/pg-core';
import { v7 as uuidv7 } from 'uuid';
import { tenants } from '../tenants/schema';
import { users } from '../users/schema';
import { customers } from '../customers/schema';
import { emails } from '../emails/schema';

/**
 * Task status enum values
 */
export const TaskStatus = {
  OPEN: 0,
  DONE: 1,
} as const;

export type TaskStatusType = (typeof TaskStatus)[keyof typeof TaskStatus];

/**
 * Tasks - Auto-created from negative sentiment emails or manually created
 *
 * Tasks are scoped: user can see their own tasks + tasks of their subordinates.
 * Subordinates are derived from userManagers table.
 */
export const tasks = pgTable(
  'tasks',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),

    // Reference to source email (nullable for manually created tasks)
    emailId: uuid('email_id').references(() => emails.id, { onDelete: 'set null' }),

    // Customer association
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'cascade' }),

    // Task details
    title: text('title').notNull(),

    // Status: 0 = open, 1 = done
    status: smallint('status').notNull().default(TaskStatus.OPEN),

    // Assignment
    assignedToId: uuid('assigned_to_id').references(() => users.id, { onDelete: 'set null' }),

    // Whether this task was auto-created by the system (from negative email)
    createdBySystem: boolean('created_by_system').notNull().default(false),

    // Timestamps
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (table) => [
    index('idx_tasks_tenant').on(table.tenantId),
    index('idx_tasks_tenant_status').on(table.tenantId, table.status),
    index('idx_tasks_assigned').on(table.assignedToId, table.status),
    index('idx_tasks_customer').on(table.customerId),
    index('idx_tasks_email').on(table.emailId),
    index('idx_tasks_created').on(table.tenantId, table.createdAt),
  ]
);

/**
 * Task Comments - Comments on tasks
 */
export const taskComments = pgTable(
  'task_comments',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),

    // Comment author
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    // Comment content
    content: text('content').notNull(),

    // Timestamps
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('idx_task_comments_task').on(table.taskId),
    index('idx_task_comments_user').on(table.userId),
  ]
);

/**
 * User Subordinates - Denormalized table for efficient subordinate queries
 *
 * Contains ALL subordinates a user has (direct + transitive).
 * Rebuilt asynchronously when userManagers changes.
 *
 * This enables O(1) access control queries for tasks.
 */
export const userSubordinates = pgTable(
  'user_subordinates',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    subordinateId: uuid('subordinate_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    rebuiltAt: timestamp('rebuilt_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    index('idx_user_subordinates_user').on(table.userId),
    index('idx_user_subordinates_subordinate').on(table.subordinateId),
  ]
);

// =============================================================================
// Type Exports
// =============================================================================

export type Task = typeof tasks.$inferSelect;
export type NewTask = typeof tasks.$inferInsert;

export type TaskComment = typeof taskComments.$inferSelect;
export type NewTaskComment = typeof taskComments.$inferInsert;

export type UserSubordinate = typeof userSubordinates.$inferSelect;
