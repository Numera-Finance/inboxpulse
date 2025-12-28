/**
 * Notification database schemas
 * 
 * Note: These schemas reference tenants and users tables which must be provided
 * by the consuming application. Use createNotificationSchemas() factory function
 * to create schemas with proper references.
 */

import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  boolean,
  integer,
  jsonb,
  index,
  uniqueIndex,
  type PgTable,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { sql } from '@crm/database';
import { v7 as uuidv7 } from 'uuid';
import type { NotificationChannel, NotificationPriority, NotificationStatus, BatchStatus } from '../types/core';

/**
 * Create notification schemas with references to tenant and user tables
 * 
 * @param tenantsId - Tenant ID column reference
 * @param usersId - User ID column reference
 */
export function createNotificationSchemas(
  tenantsId: AnyPgColumn,
  usersId: AnyPgColumn
) {
  const notificationTypes = pgTable(
    'notification_types',
    {
      id: uuid('id')
        .primaryKey()
        .$defaultFn(() => uuidv7()),
      tenantId: uuid('tenant_id')
        .notNull()
        .references(() => tenantsId, { onDelete: 'cascade' }),
      
      name: varchar('name', { length: 100 }).notNull(),
      description: text('description'),
      category: varchar('category', { length: 50 }),
      
      defaultChannels: jsonb('default_channels').$type<NotificationChannel[]>().notNull().default([]),
      defaultFrequency: varchar('default_frequency', { length: 20 }).notNull().default('immediate'),
      defaultBatchInterval: jsonb('default_batch_interval'),
      
      requiredPermission: varchar('required_permission', { length: 100 }),
      autoSubscribeEnabled: boolean('auto_subscribe_enabled').default(false),
      subscriptionConditions: jsonb('subscription_conditions'),
      
      requiresAction: boolean('requires_action').notNull().default(false),
      defaultExpiresAfterHours: integer('default_expires_after_hours'),
      defaultPriority: varchar('default_priority', { length: 20 }).default('normal'),
      
      templateConfig: jsonb('template_config'),
      deduplicationConfig: jsonb('deduplication_config'),
      
      isActive: boolean('is_active').notNull().default(true),
      createdAt: timestamp('created_at', { withTimezone: true })
        .notNull()
        .defaultNow(),
      updatedAt: timestamp('updated_at', { withTimezone: true })
        .notNull()
        .defaultNow(),
    },
    (table: any) => [
      uniqueIndex('uniq_notification_types_tenant_name').on(table.tenantId, table.name),
      index('idx_notification_types_tenant').on(table.tenantId),
      index('idx_notification_types_active').on(table.tenantId, table.isActive),
      index('idx_notification_types_permission').on(table.requiredPermission).where(sql`required_permission IS NOT NULL`),
    ]
  );

  const userNotificationPreferences = pgTable(
    'user_notification_preferences',
    {
      id: uuid('id')
        .primaryKey()
        .$defaultFn(() => uuidv7()),
      tenantId: uuid('tenant_id')
        .notNull()
        .references(() => tenantsId, { onDelete: 'cascade' }),
      userId: uuid('user_id')
        .notNull()
        .references(() => usersId, { onDelete: 'cascade' }),
      notificationTypeId: uuid('notification_type_id')
        .notNull()
        .references(() => notificationTypes.id, { onDelete: 'cascade' }),
      
      enabled: boolean('enabled').notNull().default(true),
      channels: jsonb('channels').$type<NotificationChannel[]>().notNull().default([]),
      frequency: varchar('frequency', { length: 20 }).notNull().default('immediate'),
      batchInterval: jsonb('batch_interval'),
      quietHours: jsonb('quiet_hours'),
      timezone: varchar('timezone', { length: 50 }),
      
      subscriptionSource: varchar('subscription_source', { length: 50 }).default('manual'),
      autoSubscribedAt: timestamp('auto_subscribed_at', { withTimezone: true }),
      
      createdAt: timestamp('created_at', { withTimezone: true })
        .notNull()
        .defaultNow(),
      updatedAt: timestamp('updated_at', { withTimezone: true })
        .notNull()
        .defaultNow(),
    },
    (table: any) => [
      uniqueIndex('uniq_user_notification_preferences').on(table.userId, table.notificationTypeId),
      index('idx_user_notification_preferences_user').on(table.userId),
      index('idx_user_notification_preferences_type').on(table.notificationTypeId),
      index('idx_user_notification_preferences_enabled').on(table.userId, table.enabled).where(sql`enabled = true`),
    ]
  );

  const notificationBatches = pgTable(
    'notification_batches',
    {
      id: uuid('id')
        .primaryKey()
        .$defaultFn(() => uuidv7()),
      tenantId: uuid('tenant_id')
        .notNull()
        .references(() => tenantsId, { onDelete: 'cascade' }),
      userId: uuid('user_id')
        .notNull()
        .references(() => usersId, { onDelete: 'cascade' }),
      notificationTypeId: uuid('notification_type_id')
        .notNull()
        .references(() => notificationTypes.id, { onDelete: 'cascade' }),
      
      channel: varchar('channel', { length: 50 }).notNull(),
      batchInterval: jsonb('batch_interval').notNull(),
      
      status: varchar('status', { length: 20 }).notNull().default('pending'),
      scheduledFor: timestamp('scheduled_for', { withTimezone: true }).notNull(),
      sentAt: timestamp('sent_at', { withTimezone: true }),
      
      aggregatedContent: jsonb('aggregated_content'),
      deliveryAttempts: jsonb('delivery_attempts').$type<unknown[]>().default([]),
      
      createdAt: timestamp('created_at', { withTimezone: true })
        .notNull()
        .defaultNow(),
      updatedAt: timestamp('updated_at', { withTimezone: true })
        .notNull()
        .defaultNow(),
    },
    (table: any) => [
      index('idx_notification_batches_user').on(table.userId),
      index('idx_notification_batches_scheduled').on(table.scheduledFor, table.status).where(sql`status = 'pending'`),
      index('idx_notification_batches_type').on(table.notificationTypeId),
    ]
  );

  const notifications = pgTable(
    'notifications',
    {
      id: uuid('id')
        .primaryKey()
        .$defaultFn(() => uuidv7()),
      tenantId: uuid('tenant_id')
        .notNull()
        .references(() => tenantsId, { onDelete: 'cascade' }),
      userId: uuid('user_id')
        .notNull()
        .references(() => usersId, { onDelete: 'cascade' }),
      notificationTypeId: uuid('notification_type_id')
        .notNull()
        .references(() => notificationTypes.id, { onDelete: 'cascade' }),
      
      title: varchar('title', { length: 255 }).notNull(),
      body: text('body').notNull(),
      metadata: jsonb('metadata').default({}),
      actionItems: jsonb('action_items'),
      
      status: varchar('status', { length: 20 }).notNull().default('pending'),
      priority: varchar('priority', { length: 20 }).default('normal'),
      scheduledFor: timestamp('scheduled_for', { withTimezone: true }),
      expiresAt: timestamp('expires_at', { withTimezone: true }),
      sentAt: timestamp('sent_at', { withTimezone: true }),
      readAt: timestamp('read_at', { withTimezone: true }),
      
      batchId: uuid('batch_id').references(() => notificationBatches.id, { onDelete: 'set null' }),
      channel: varchar('channel', { length: 50 }),
      
      eventKey: varchar('event_key', { length: 255 }),
      eventVersion: integer('event_version'),
      idempotencyKey: varchar('idempotency_key', { length: 255 }),
      
      deliveryAttempts: jsonb('delivery_attempts').$type<unknown[]>().default([]),
      engagement: jsonb('engagement'),
      locale: varchar('locale', { length: 10 }),
      
      createdAt: timestamp('created_at', { withTimezone: true })
        .notNull()
        .defaultNow(),
      updatedAt: timestamp('updated_at', { withTimezone: true })
        .notNull()
        .defaultNow(),
    },
    (table: any) => [
      index('idx_notifications_user').on(table.userId),
      index('idx_notifications_type').on(table.notificationTypeId),
      index('idx_notifications_status').on(table.status, table.scheduledFor).where(sql`status IN ('pending', 'batched')`),
      index('idx_notifications_batch').on(table.batchId),
      index('idx_notifications_scheduled').on(table.scheduledFor).where(sql`scheduled_for IS NOT NULL`),
      index('idx_notifications_expires').on(table.expiresAt).where(sql`expires_at IS NOT NULL`),
      index('idx_notifications_read').on(table.readAt).where(sql`read_at IS NULL`),
      index('idx_notifications_priority').on(table.priority),
      uniqueIndex('idx_notifications_idempotency').on(table.idempotencyKey).where(sql`idempotency_key IS NOT NULL`),
      uniqueIndex('idx_notifications_event_key').on(table.userId, table.notificationTypeId, table.eventKey).where(sql`event_key IS NOT NULL`),
      index('idx_notifications_channel').on(table.channel),
    ]
  );

  const notificationBatchActions = pgTable(
    'notification_batch_actions',
    {
      id: uuid('id')
        .primaryKey()
        .$defaultFn(() => uuidv7()),
      tenantId: uuid('tenant_id')
        .notNull()
        .references(() => tenantsId, { onDelete: 'cascade' }),
      userId: uuid('user_id')
        .notNull()
        .references(() => usersId, { onDelete: 'cascade' }),
      
      actionType: varchar('action_type', { length: 50 }).notNull(),
      notificationIds: jsonb('notification_ids').$type<string[]>().notNull(),
      actionData: jsonb('action_data').default({}),
      
      status: varchar('status', { length: 20 }).notNull().default('pending'),
      processedAt: timestamp('processed_at', { withTimezone: true }),
      errorMessage: text('error_message'),
      
      createdAt: timestamp('created_at', { withTimezone: true })
        .notNull()
        .defaultNow(),
      updatedAt: timestamp('updated_at', { withTimezone: true })
        .notNull()
        .defaultNow(),
    },
    (table: any) => [
      index('idx_notification_batch_actions_user').on(table.userId),
      index('idx_notification_batch_actions_status').on(table.status).where(sql`status = 'pending'`),
    ]
  );

  const notificationActions = pgTable(
    'notification_actions',
    {
      id: uuid('id')
        .primaryKey()
        .$defaultFn(() => uuidv7()),
      tenantId: uuid('tenant_id')
        .notNull()
        .references(() => tenantsId, { onDelete: 'cascade' }),
      userId: uuid('user_id')
        .notNull()
        .references(() => usersId, { onDelete: 'cascade' }),
      notificationId: uuid('notification_id')
        .notNull()
        .references(() => notifications.id, { onDelete: 'cascade' }),
      
      actionType: varchar('action_type', { length: 50 }).notNull(),
      actionData: jsonb('action_data').default({}),
      batchActionId: uuid('batch_action_id').references(() => notificationBatchActions.id, { onDelete: 'set null' }),
      
      status: varchar('status', { length: 20 }).notNull().default('pending'),
      processedAt: timestamp('processed_at', { withTimezone: true }),
      errorMessage: text('error_message'),
      
      createdAt: timestamp('created_at', { withTimezone: true })
        .notNull()
        .defaultNow(),
      updatedAt: timestamp('updated_at', { withTimezone: true })
        .notNull()
        .defaultNow(),
    },
    (table: any) => [
      index('idx_notification_actions_notification').on(table.notificationId),
      index('idx_notification_actions_user').on(table.userId),
      index('idx_notification_actions_batch').on(table.batchActionId),
      index('idx_notification_actions_status').on(table.status).where(sql`status = 'pending'`),
    ]
  );

  const userChannelAddresses = pgTable(
    'user_channel_addresses',
    {
      id: uuid('id')
        .primaryKey()
        .$defaultFn(() => uuidv7()),
      tenantId: uuid('tenant_id')
        .notNull()
        .references(() => tenantsId, { onDelete: 'cascade' }),
      userId: uuid('user_id')
        .notNull()
        .references(() => usersId, { onDelete: 'cascade' }),
      channel: varchar('channel', { length: 50 }).notNull(),
      address: varchar('address', { length: 255 }).notNull(),
      
      isVerified: boolean('is_verified').default(false),
      verifiedAt: timestamp('verified_at', { withTimezone: true }),
      bounceCount: integer('bounce_count').default(0),
      complaintCount: integer('complaint_count').default(0),
      isDisabled: boolean('is_disabled').default(false),
      metadata: jsonb('metadata'),
      
      createdAt: timestamp('created_at', { withTimezone: true })
        .notNull()
        .defaultNow(),
      updatedAt: timestamp('updated_at', { withTimezone: true })
        .notNull()
        .defaultNow(),
    },
    (table: any) => [
      uniqueIndex('uniq_user_channel_addresses').on(table.tenantId, table.userId, table.channel),
      index('idx_user_channel_addresses_user').on(table.userId),
      index('idx_user_channel_addresses_channel').on(table.channel, table.isDisabled).where(sql`is_disabled = false`),
      index('idx_user_channel_addresses_verified').on(table.isVerified).where(sql`is_verified = true`),
    ]
  );

  const notificationAuditLog = pgTable(
    'notification_audit_log',
    {
      id: uuid('id')
        .primaryKey()
        .$defaultFn(() => uuidv7()),
      tenantId: uuid('tenant_id')
        .notNull()
        .references(() => tenantsId, { onDelete: 'cascade' }),
      
      eventType: varchar('event_type', { length: 50 }).notNull(),
      entityType: varchar('entity_type', { length: 50 }).notNull(),
      entityId: uuid('entity_id'),
      userId: uuid('user_id').references(() => usersId, { onDelete: 'set null' }),
      
      changes: jsonb('changes'),
      metadata: jsonb('metadata'),
      
      createdAt: timestamp('created_at', { withTimezone: true })
        .notNull()
        .defaultNow(),
    },
    (table: any) => [
      index('idx_notification_audit_log_tenant').on(table.tenantId),
      index('idx_notification_audit_log_entity').on(table.entityType, table.entityId),
      index('idx_notification_audit_log_user').on(table.userId),
      index('idx_notification_audit_log_created').on(table.createdAt),
      index('idx_notification_audit_log_event').on(table.eventType),
    ]
  );

  const notificationBounceComplaints = pgTable(
    'notification_bounce_complaints',
    {
      id: uuid('id')
        .primaryKey()
        .$defaultFn(() => uuidv7()),
      tenantId: uuid('tenant_id')
        .notNull()
        .references(() => tenantsId, { onDelete: 'cascade' }),
      userId: uuid('user_id')
        .notNull()
        .references(() => usersId, { onDelete: 'cascade' }),
      channelAddressId: uuid('channel_address_id').references(() => userChannelAddresses.id, { onDelete: 'set null' }),
      
      emailAddress: varchar('email_address', { length: 255 }),
      eventType: varchar('event_type', { length: 50 }).notNull(),
      provider: varchar('provider', { length: 50 }).notNull(),
      providerEventId: varchar('provider_event_id', { length: 255 }).notNull(),
      reason: text('reason'),
      metadata: jsonb('metadata'),
      
      processed: boolean('processed').default(false),
      processedAt: timestamp('processed_at', { withTimezone: true }),
      
      createdAt: timestamp('created_at', { withTimezone: true })
        .notNull()
        .defaultNow(),
    },
    (table: any) => [
      uniqueIndex('uniq_notification_bounce_complaints_provider').on(table.provider, table.providerEventId),
      index('idx_notification_bounce_complaints_user').on(table.userId),
      index('idx_notification_bounce_complaints_email').on(table.emailAddress),
      index('idx_notification_bounce_complaints_processed').on(table.processed).where(sql`processed = false`),
      index('idx_notification_bounce_complaints_event').on(table.eventType),
    ]
  );

  return {
    notificationTypes,
    userNotificationPreferences,
    notificationBatches,
    notifications,
    notificationActions,
    notificationBatchActions,
    userChannelAddresses,
    notificationAuditLog,
    notificationBounceComplaints,
  };
}
