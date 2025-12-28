/**
 * Notification app schemas
 * Creates notification schemas with references to tenants and users
 * 
 * Note: This app needs access to tenants and users tables from the main database
 */

import { createNotificationSchemas } from '@crm/notifications';
import { pgTable, uuid, varchar, text, timestamp, boolean, smallint } from 'drizzle-orm/pg-core';
import { v7 as uuidv7 } from 'uuid';

// Define minimal tenant and user schemas for references
// These match the main database schema
export const tenants = pgTable('tenants', {
  id: uuid('id').primaryKey().$defaultFn(() => uuidv7()),
  name: text('name').notNull(),
  domain: varchar('domain', { length: 255 }),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const users = pgTable('users', {
  id: uuid('id').primaryKey().$defaultFn(() => uuidv7()),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  firstName: varchar('first_name', { length: 60 }).notNull(),
  lastName: varchar('last_name', { length: 60 }).notNull(),
  email: varchar('email', { length: 255 }).notNull(),
  roleId: uuid('role_id'),
  apiKeyHash: varchar('api_key_hash', { length: 255 }),
  canLogin: boolean('can_login').notNull().default(true),
  rowStatus: smallint('row_status').notNull().default(0),
  lastLoginAt: timestamp('last_login_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

// Create notification schemas
export const {
  notificationTypes,
  userNotificationPreferences,
  notificationBatches,
  notifications,
  notificationActions,
  notificationBatchActions,
  userChannelAddresses,
  notificationAuditLog,
  notificationBounceComplaints,
} = createNotificationSchemas(tenants.id, users.id);

// Re-export types
export type NotificationType = typeof notificationTypes.$inferSelect;
export type NewNotificationType = typeof notificationTypes.$inferInsert;

export type UserNotificationPreference = typeof userNotificationPreferences.$inferSelect;
export type NewUserNotificationPreference = typeof userNotificationPreferences.$inferInsert;

export type NotificationBatch = typeof notificationBatches.$inferSelect;
export type NewNotificationBatch = typeof notificationBatches.$inferInsert;

export type Notification = typeof notifications.$inferSelect;
export type NewNotification = typeof notifications.$inferInsert;

export type NotificationAction = typeof notificationActions.$inferSelect;
export type NewNotificationAction = typeof notificationActions.$inferInsert;

export type NotificationBatchAction = typeof notificationBatchActions.$inferSelect;
export type NewNotificationBatchAction = typeof notificationBatchActions.$inferInsert;

export type UserChannelAddress = typeof userChannelAddresses.$inferSelect;
export type NewUserChannelAddress = typeof userChannelAddresses.$inferInsert;

export type NotificationAuditLog = typeof notificationAuditLog.$inferSelect;
export type NewNotificationAuditLog = typeof notificationAuditLog.$inferInsert;

export type NotificationBounceComplaint = typeof notificationBounceComplaints.$inferSelect;
export type NewNotificationBounceComplaint = typeof notificationBounceComplaints.$inferInsert;
