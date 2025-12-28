# Notifications Module - Implementation Design

## Overview

Complete implementation design including database schemas, TypeScript interfaces, Zod schemas, service architecture, and multi-project reuse patterns.

---

## Table of Contents

1. [Database Schemas](#database-schemas)
2. [TypeScript Interfaces](#typescript-interfaces)
3. [Zod Schemas](#zod-schemas)
4. [Service Architecture](#service-architecture)
5. [Template & Event Specification](#template--event-specification)
6. [Multi-Project Reuse](#multi-project-reuse)
7. [Package Structure](#package-structure)

---

## Database Schemas

### Schema: `notification_types`

```sql
CREATE TABLE notification_types (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    
    -- Type identification
    name VARCHAR(100) NOT NULL, -- e.g., "escalation_alert"
    description TEXT,
    category VARCHAR(50), -- 'alerts', 'approvals', 'digests', 'system'
    
    -- Default configuration
    default_channels JSONB NOT NULL DEFAULT '[]'::jsonb, -- Array of channel names
    default_frequency VARCHAR(20) NOT NULL DEFAULT 'immediate', -- 'immediate' | 'batched'
    default_batch_interval JSONB, -- { type: 'minutes', value: 15 } or null for immediate
    
    -- Permission-based subscription
    required_permission VARCHAR(100), -- Permission string required to receive this notification
    auto_subscribe_enabled BOOLEAN DEFAULT false,
    subscription_conditions JSONB, -- { hasCustomers?: boolean, hasManager?: boolean }
    
    -- Features
    requires_action BOOLEAN NOT NULL DEFAULT false,
    default_expires_after_hours INTEGER, -- Default expiry time, null for no expiry
    default_priority VARCHAR(20) DEFAULT 'normal', -- 'critical', 'high', 'normal', 'low'
    
    -- Template configuration
    template_config JSONB, -- { channels: {...}, data_loader_enabled: boolean, variable_mapping: {...} }
    
    -- Deduplication configuration
    deduplication_config JSONB, -- { strategy: 'overwrite'|'create_new'|'ignore', event_key_fields: [...], update_window_minutes: number }
    
    -- Metadata
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    CONSTRAINT uniq_notification_types_tenant_name UNIQUE (tenant_id, name)
);

CREATE INDEX idx_notification_types_tenant ON notification_types(tenant_id);
CREATE INDEX idx_notification_types_active ON notification_types(tenant_id, is_active);
CREATE INDEX idx_notification_types_permission ON notification_types(required_permission) WHERE required_permission IS NOT NULL;
```

### Schema: `user_notification_preferences`

```sql
CREATE TABLE user_notification_preferences (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    notification_type_id UUID NOT NULL REFERENCES notification_types(id) ON DELETE CASCADE,
    
    -- Preference settings
    enabled BOOLEAN NOT NULL DEFAULT true,
    channels JSONB NOT NULL DEFAULT '[]'::jsonb, -- Array of channel names
    frequency VARCHAR(20) NOT NULL DEFAULT 'immediate', -- 'immediate' | 'batched'
    batch_interval JSONB, -- { type: 'minutes', value: 15 } or null for immediate
    
    -- Quiet hours (optional)
    quiet_hours JSONB, -- { start: "22:00", end: "08:00", timezone: "America/New_York" }
    timezone VARCHAR(50), -- IANA timezone, inherits from users table if null
    
    -- Subscription tracking
    subscription_source VARCHAR(50) DEFAULT 'manual', -- 'manual', 'auto'
    auto_subscribed_at TIMESTAMPTZ, -- When auto-subscribed
    
    -- Metadata
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    CONSTRAINT uniq_user_notification_preferences UNIQUE (user_id, notification_type_id)
);

CREATE INDEX idx_user_notification_preferences_user ON user_notification_preferences(user_id);
CREATE INDEX idx_user_notification_preferences_type ON user_notification_preferences(notification_type_id);
CREATE INDEX idx_user_notification_preferences_enabled ON user_notification_preferences(user_id, enabled) WHERE enabled = true;
```

### Schema: `notifications`

```sql
CREATE TABLE notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    notification_type_id UUID NOT NULL REFERENCES notification_types(id) ON DELETE CASCADE,
    
    -- Content (generated at send time, stored after rendering)
    title VARCHAR(255) NOT NULL,
    body TEXT NOT NULL, -- Rendered template content (channel-specific)
    metadata JSONB DEFAULT '{}'::jsonb, -- Additional context for templates/actions
    
    -- Actionable items (if requires_action = true)
    action_items JSONB, -- [{ id: "item-1", type: "approval", data: {...} }]
    
    -- Delivery state
    status VARCHAR(20) NOT NULL DEFAULT 'pending', -- 'pending', 'batched', 'sent', 'failed', 'cancelled', 'expired', 'skipped', 'read'
    priority VARCHAR(20) DEFAULT 'normal', -- 'critical', 'high', 'normal', 'low'
    scheduled_for TIMESTAMPTZ, -- When to send (for batching - unified releaseAt)
    expires_at TIMESTAMPTZ, -- Skip sending if expired
    sent_at TIMESTAMPTZ,
    read_at TIMESTAMPTZ, -- When user marked as read
    
    -- Batching
    batch_id UUID REFERENCES notification_batches(id) ON DELETE SET NULL,
    channel VARCHAR(50), -- Channel this notification is for
    
    -- Deduplication
    event_key VARCHAR(255), -- Hash of event identifier (for deduplication)
    event_version INTEGER, -- For tracking event modifications
    idempotency_key VARCHAR(255), -- For idempotent notify() calls
    
    -- Delivery tracking
    delivery_attempts JSONB DEFAULT '[]'::jsonb, -- [{ channel: 'email', attempted_at: ..., status: 'sent'|'failed', error: ... }]
    
    -- Engagement tracking
    engagement JSONB, -- { opened_at: ..., opened_count: ..., clicked_at: ..., clicked_count: ..., clicked_links: [...] }
    
    -- Localization
    locale VARCHAR(10), -- e.g., 'en-US', 'es-ES', inherits from user
    
    -- Metadata
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_notifications_user ON notifications(user_id);
CREATE INDEX idx_notifications_type ON notifications(notification_type_id);
CREATE INDEX idx_notifications_status ON notifications(status, scheduled_for) WHERE status IN ('pending', 'batched');
CREATE INDEX idx_notifications_batch ON notifications(batch_id);
CREATE INDEX idx_notifications_scheduled ON notifications(scheduled_for) WHERE scheduled_for IS NOT NULL;
CREATE INDEX idx_notifications_expires ON notifications(expires_at) WHERE expires_at IS NOT NULL;
CREATE INDEX idx_notifications_read ON notifications(read_at) WHERE read_at IS NULL;
CREATE INDEX idx_notifications_priority ON notifications(priority);
CREATE UNIQUE INDEX idx_notifications_idempotency ON notifications(idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE UNIQUE INDEX idx_notifications_event_key ON notifications(user_id, notification_type_id, event_key) WHERE event_key IS NOT NULL;
CREATE INDEX idx_notifications_channel ON notifications(channel);
```

### Schema: `notification_batches`

```sql
CREATE TABLE notification_batches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    notification_type_id UUID NOT NULL REFERENCES notification_types(id) ON DELETE CASCADE,
    
    -- Batch configuration
    channel VARCHAR(50) NOT NULL, -- 'email' | 'slack' | etc.
    batch_interval JSONB NOT NULL, -- { type: 'minutes', value: 15 }
    
    -- Delivery state
    status VARCHAR(20) NOT NULL DEFAULT 'pending', -- 'pending', 'processing', 'sent', 'failed', 'cancelled', 'partially_sent'
    scheduled_for TIMESTAMPTZ NOT NULL, -- When to send this batch (unified releaseAt)
    sent_at TIMESTAMPTZ,
    
    -- Aggregated content (for digest-style batches)
    aggregated_content JSONB, -- { title: "...", items: [...] }
    
    -- Delivery tracking
    delivery_attempts JSONB DEFAULT '[]'::jsonb,
    
    -- Metadata
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_notification_batches_user ON notification_batches(user_id);
CREATE INDEX idx_notification_batches_scheduled ON notification_batches(scheduled_for, status) WHERE status = 'pending';
CREATE INDEX idx_notification_batches_type ON notification_batches(notification_type_id);
```

### Schema: `notification_actions`

```sql
CREATE TABLE notification_actions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    notification_id UUID NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
    
    -- Action details
    action_type VARCHAR(50) NOT NULL, -- 'approve', 'reject', 'dismiss', 'custom'
    action_data JSONB DEFAULT '{}'::jsonb, -- Additional action context
    
    -- Batch action support
    batch_action_id UUID REFERENCES notification_batch_actions(id) ON DELETE SET NULL,
    
    -- Status
    status VARCHAR(20) NOT NULL DEFAULT 'pending', -- 'pending', 'processing', 'completed', 'failed'
    processed_at TIMESTAMPTZ,
    error_message TEXT,
    
    -- Metadata
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_notification_actions_notification ON notification_actions(notification_id);
CREATE INDEX idx_notification_actions_user ON notification_actions(user_id);
CREATE INDEX idx_notification_actions_batch ON notification_actions(batch_action_id);
CREATE INDEX idx_notification_actions_status ON notification_actions(status) WHERE status = 'pending';
```

### Schema: `notification_batch_actions`

```sql
CREATE TABLE notification_batch_actions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    
    -- Batch action details
    action_type VARCHAR(50) NOT NULL, -- 'approve_all', 'reject_all', 'custom'
    notification_ids UUID[] NOT NULL, -- Array of notification IDs
    action_data JSONB DEFAULT '{}'::jsonb,
    
    -- Status
    status VARCHAR(20) NOT NULL DEFAULT 'pending', -- 'pending', 'processing', 'completed', 'failed'
    processed_at TIMESTAMPTZ,
    error_message TEXT,
    
    -- Metadata
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_notification_batch_actions_user ON notification_batch_actions(user_id);
CREATE INDEX idx_notification_batch_actions_status ON notification_batch_actions(status) WHERE status = 'pending';
```

### Schema: `user_channel_addresses`

```sql
CREATE TABLE user_channel_addresses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    channel VARCHAR(50) NOT NULL, -- 'slack', 'sms', 'mobile_push', 'gchat'
    address VARCHAR(255) NOT NULL, -- Slack user ID, phone number, device token, etc.
    
    -- Verification and status
    is_verified BOOLEAN DEFAULT false,
    verified_at TIMESTAMPTZ,
    bounce_count INTEGER DEFAULT 0, -- Hard bounces for email
    complaint_count INTEGER DEFAULT 0, -- Spam complaints
    is_disabled BOOLEAN DEFAULT false, -- Disabled due to bounces/complaints
    
    -- Channel-specific metadata
    metadata JSONB, -- e.g., { deviceType: 'ios', appVersion: '1.0.0' } for push
    
    -- Metadata
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    CONSTRAINT uniq_user_channel_addresses UNIQUE (tenant_id, user_id, channel)
);

CREATE INDEX idx_user_channel_addresses_user ON user_channel_addresses(user_id);
CREATE INDEX idx_user_channel_addresses_channel ON user_channel_addresses(channel, is_disabled) WHERE is_disabled = false;
CREATE INDEX idx_user_channel_addresses_verified ON user_channel_addresses(is_verified) WHERE is_verified = true;
```

### Schema: `notification_audit_log`

```sql
CREATE TABLE notification_audit_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    
    -- Event details
    event_type VARCHAR(50) NOT NULL, -- 'notification_created', 'notification_sent', 'notification_failed', 'preference_updated', etc.
    entity_type VARCHAR(50) NOT NULL, -- 'notification', 'preference', 'channel_address', etc.
    entity_id UUID, -- ID of the entity
    
    -- User context
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    
    -- Change tracking
    changes JSONB, -- { before: {...}, after: {...} } for updates
    metadata JSONB, -- Additional context
    
    -- Metadata
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_notification_audit_log_tenant ON notification_audit_log(tenant_id);
CREATE INDEX idx_notification_audit_log_entity ON notification_audit_log(entity_type, entity_id);
CREATE INDEX idx_notification_audit_log_user ON notification_audit_log(user_id);
CREATE INDEX idx_notification_audit_log_created ON notification_audit_log(created_at);
CREATE INDEX idx_notification_audit_log_event ON notification_audit_log(event_type);
```

### Schema: `notification_bounce_complaints`

```sql
CREATE TABLE notification_bounce_complaints (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    channel_address_id UUID REFERENCES user_channel_addresses(id) ON DELETE SET NULL,
    
    -- Event details
    email_address VARCHAR(255), -- Email that bounced/complained
    event_type VARCHAR(50) NOT NULL, -- 'hard_bounce', 'soft_bounce', 'complaint', 'unsubscribe'
    provider VARCHAR(50) NOT NULL, -- 'resend', 'sendgrid', etc.
    provider_event_id VARCHAR(255) NOT NULL, -- Provider's event ID for idempotency
    reason TEXT, -- Bounce/complaint reason
    metadata JSONB, -- Provider-specific data
    
    -- Processing
    processed BOOLEAN DEFAULT false,
    processed_at TIMESTAMPTZ,
    
    -- Metadata
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    CONSTRAINT uniq_notification_bounce_complaints_provider UNIQUE (provider, provider_event_id)
);

CREATE INDEX idx_notification_bounce_complaints_user ON notification_bounce_complaints(user_id);
CREATE INDEX idx_notification_bounce_complaints_email ON notification_bounce_complaints(email_address);
CREATE INDEX idx_notification_bounce_complaints_processed ON notification_bounce_complaints(processed) WHERE processed = false;
CREATE INDEX idx_notification_bounce_complaints_event ON notification_bounce_complaints(event_type);
```

---

## TypeScript Interfaces

### Core Interfaces

```typescript
// packages/notifications/src/types/core.ts

/**
 * Notification type definition
 */
export interface NotificationType {
  id: string;
  tenantId: string;
  name: string;
  description?: string;
  category?: 'alerts' | 'approvals' | 'digests' | 'system';
  defaultChannels: NotificationChannel[];
  defaultFrequency: 'immediate' | 'batched';
  defaultBatchInterval?: BatchInterval;
  requiredPermission?: string;
  autoSubscribeEnabled: boolean;
  subscriptionConditions?: SubscriptionConditions;
  requiresAction: boolean;
  defaultExpiresAfterHours?: number;
  defaultPriority: NotificationPriority;
  templateConfig?: TemplateConfig;
  deduplicationConfig?: DeduplicationConfig;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Notification channels
 */
export type NotificationChannel = 'email' | 'slack' | 'gchat' | 'sms' | 'mobile_push';

/**
 * Batch interval configuration
 */
export type BatchInterval =
  | { type: 'immediate' }
  | { type: 'minutes'; value: number }
  | { type: 'hours'; value: number }
  | { type: 'end_of_day' }
  | { type: 'custom'; scheduledFor: Date };

/**
 * Notification priority
 */
export type NotificationPriority = 'critical' | 'high' | 'normal' | 'low';

/**
 * Subscription conditions
 */
export interface SubscriptionConditions {
  hasCustomers?: boolean;
  hasManager?: boolean;
  // Extensible for custom conditions
  [key: string]: unknown;
}

/**
 * Template configuration
 */
export interface TemplateConfig {
  channels: Record<NotificationChannel, string>; // Channel → template path/ID
  dataLoaderEnabled?: boolean;
  variableMapping?: Record<string, string>; // Metadata keys → template variable names
}

/**
 * Deduplication configuration
 */
export interface DeduplicationConfig {
  strategy: 'overwrite' | 'create_new' | 'ignore';
  eventKeyFields: string[]; // Metadata field names to hash
  updateWindowMinutes: number;
}

/**
 * User notification preferences
 */
export interface UserNotificationPreferences {
  id: string;
  tenantId: string;
  userId: string;
  notificationTypeId: string;
  enabled: boolean;
  channels: NotificationChannel[];
  frequency: 'immediate' | 'batched';
  batchInterval?: BatchInterval;
  quietHours?: QuietHours;
  timezone?: string;
  subscriptionSource: 'manual' | 'auto';
  autoSubscribedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Quiet hours configuration
 */
export interface QuietHours {
  start: string; // HH:mm format
  end: string; // HH:mm format
  timezone: string; // IANA timezone
}

/**
 * Notification record
 */
export interface Notification {
  id: string;
  tenantId: string;
  userId: string;
  notificationTypeId: string;
  title: string;
  body: string;
  metadata: Record<string, unknown>;
  actionItems?: ActionItem[];
  status: NotificationStatus;
  priority: NotificationPriority;
  scheduledFor?: Date;
  expiresAt?: Date;
  sentAt?: Date;
  readAt?: Date;
  batchId?: string;
  channel?: NotificationChannel;
  eventKey?: string;
  eventVersion?: number;
  idempotencyKey?: string;
  deliveryAttempts: DeliveryAttempt[];
  engagement?: EngagementData;
  locale?: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Notification status
 */
export type NotificationStatus =
  | 'pending'
  | 'batched'
  | 'sent'
  | 'failed'
  | 'cancelled'
  | 'expired'
  | 'skipped'
  | 'read';

/**
 * Action item
 */
export interface ActionItem {
  id: string;
  type: string;
  data: Record<string, unknown>;
}

/**
 * Delivery attempt
 */
export interface DeliveryAttempt {
  channel: NotificationChannel;
  attemptedAt: Date;
  status: 'sent' | 'failed';
  error?: string;
}

/**
 * Engagement data
 */
export interface EngagementData {
  openedAt?: Date;
  openedCount: number;
  clickedAt?: Date;
  clickedCount: number;
  clickedLinks: string[];
}

/**
 * Notification batch
 */
export interface NotificationBatch {
  id: string;
  tenantId: string;
  userId: string;
  notificationTypeId: string;
  channel: NotificationChannel;
  batchInterval: BatchInterval;
  status: BatchStatus;
  scheduledFor: Date;
  sentAt?: Date;
  aggregatedContent?: AggregatedContent;
  deliveryAttempts: DeliveryAttempt[];
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Batch status
 */
export type BatchStatus = 'pending' | 'processing' | 'sent' | 'failed' | 'cancelled' | 'partially_sent';

/**
 * Aggregated content for batch
 */
export interface AggregatedContent {
  title: string;
  summary?: string;
  items: AggregatedItem[];
  actions?: ActionItem[];
}

/**
 * Aggregated item
 */
export interface AggregatedItem {
  notificationId: string;
  title: string;
  summary: string;
  metadata: Record<string, unknown>;
}

/**
 * Channel address
 */
export interface ChannelAddress {
  id: string;
  tenantId: string;
  userId: string;
  channel: NotificationChannel;
  address: string;
  isVerified: boolean;
  isDisabled: boolean;
  verifiedAt?: Date;
  bounceCount: number;
  complaintCount: number;
  metadata?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}
```

### Pluggable Interface Types

```typescript
// packages/notifications/src/types/interfaces.ts

/**
 * Template provider interface
 */
export interface TemplateProvider {
  getTemplate(
    typeId: string,
    channel: NotificationChannel,
    locale?: string
  ): Promise<Template | null>;
  
  renderTemplate(
    template: Template,
    data: Record<string, unknown>,
    options?: RenderOptions
  ): Promise<TemplateRenderResult>;
  
  getFallbackTemplate(channel: NotificationChannel): Promise<Template | null>;
  
  templateExists(typeId: string, channel: NotificationChannel): Promise<boolean>;
}

/**
 * Template definition
 */
export interface Template {
  id: string;
  typeId: string;
  channel: NotificationChannel;
  locale?: string;
  content: string | React.ComponentType; // Template content
  version: number;
  variables: string[]; // Required variables
}

/**
 * Template render result
 */
export interface TemplateRenderResult {
  hasContent: boolean;
  content?: RenderedContent;
  reason?: 'no_data_access' | 'empty_content' | 'template_error' | 'missing_data';
  error?: string;
}

/**
 * Rendered content
 */
export interface RenderedContent {
  html?: string; // For email
  text?: string; // Plain text version
  blocks?: unknown[]; // For Slack block kit
  subject?: string; // Email subject
  title?: string; // Push notification title
}

/**
 * Render options
 */
export interface RenderOptions {
  locale?: string;
  dataLoader?: (key: string) => Promise<unknown>;
  dataAccessChecker?: (dataContext: NotificationDataContext) => Promise<boolean>;
  userId?: string;
  tenantId?: string;
}

/**
 * Notification data context for access checking
 */
export interface NotificationDataContext {
  notificationType: string;
  data: Record<string, unknown>;
}

/**
 * User resolver interface
 */
export interface UserResolver {
  getUser(userId: string, tenantId: string): Promise<NotificationUser | null>;
  getUserChannelAddress(userId: string, channel: NotificationChannel): Promise<ChannelAddress | null>;
  getUserPreferences(userId: string, typeId: string): Promise<UserNotificationPreferences | null>;
  getSubscribers(tenantId: string, typeId: string): Promise<string[]>;
  getUserTimezone(userId: string): Promise<string | null>;
  getUserLocale(userId: string): Promise<string | null>;
  userExists(userId: string, tenantId: string): Promise<boolean>;
  tenantActive(tenantId: string): Promise<boolean>;
  getUserPermissions(userId: string): Promise<string[]>;
  userHasPermission(userId: string, permission: string): Promise<boolean>;
  userMatchesConditions(userId: string, conditions: SubscriptionConditions): Promise<boolean>;
  createDataAccessChecker(userId: string, tenantId: string): (context: NotificationDataContext) => Promise<boolean>;
}

/**
 * Notification user (abstracted from specific user model)
 */
export interface NotificationUser {
  id: string;
  tenantId: string;
  email?: string;
  name?: string;
  firstName?: string;
  lastName?: string;
  timezone?: string;
  locale?: string;
  isActive: boolean;
}
```

### Channel Adapter Interface

```typescript
// packages/notifications/src/types/channels.ts

/**
 * Base channel adapter interface
 */
export interface BaseChannel {
  /**
   * Send notification via this channel
   * @param notification - Notification record
   * @param renderedContent - Rendered content from template provider
   * @param userResolver - User resolver for address lookup
   * @returns Send result
   */
  send(
    notification: Notification,
    renderedContent: RenderedContent,
    userResolver: UserResolver
  ): Promise<ChannelSendResult>;
  
  /**
   * Validate channel address format
   */
  validateAddress(address: string): boolean;
  
  /**
   * Get channel name
   */
  getChannelName(): NotificationChannel;
}

/**
 * Channel send result
 */
export interface ChannelSendResult {
  success: boolean;
  messageId?: string; // Provider's message ID
  error?: string;
}
```

---

## Zod Schemas

### Request/Response Schemas

```typescript
// packages/notifications/src/schemas/requests.ts

import { z } from 'zod';

/**
 * Send notification request
 */
export const sendNotificationRequestSchema = z.object({
  tenantId: z.string().uuid(),
  notificationType: z.string().min(1),
  data: z.record(z.unknown()), // Full data payload
  idempotencyKey: z.string().optional(),
  eventKey: z.string().optional(),
  priority: z.enum(['critical', 'high', 'normal', 'low']).optional(),
  expiresAt: z.coerce.date().optional(),
  userIds: z.array(z.string().uuid()).optional(), // Specific users, otherwise fans out
  locale: z.string().optional(),
});

export type SendNotificationRequest = z.infer<typeof sendNotificationRequestSchema>;

/**
 * Create notification type request
 */
export const createNotificationTypeRequestSchema = z.object({
  tenantId: z.string().uuid(),
  name: z.string().min(1).max(100),
  description: z.string().optional(),
  category: z.enum(['alerts', 'approvals', 'digests', 'system']).optional(),
  defaultChannels: z.array(z.enum(['email', 'slack', 'gchat', 'sms', 'mobile_push'])),
  defaultFrequency: z.enum(['immediate', 'batched']).default('immediate'),
  defaultBatchInterval: z.object({
    type: z.enum(['minutes', 'hours', 'end_of_day', 'custom']),
    value: z.number().optional(),
    scheduledFor: z.coerce.date().optional(),
  }).optional(),
  requiredPermission: z.string().optional(),
  autoSubscribeEnabled: z.boolean().default(false),
  subscriptionConditions: z.object({
    hasCustomers: z.boolean().optional(),
    hasManager: z.boolean().optional(),
  }).optional(),
  requiresAction: z.boolean().default(false),
  defaultExpiresAfterHours: z.number().positive().optional(),
  defaultPriority: z.enum(['critical', 'high', 'normal', 'low']).default('normal'),
  templateConfig: z.object({
    channels: z.record(z.string()),
    dataLoaderEnabled: z.boolean().optional(),
    variableMapping: z.record(z.string()).optional(),
  }).optional(),
  deduplicationConfig: z.object({
    strategy: z.enum(['overwrite', 'create_new', 'ignore']),
    eventKeyFields: z.array(z.string()),
    updateWindowMinutes: z.number().positive(),
  }).optional(),
});

export type CreateNotificationTypeRequest = z.infer<typeof createNotificationTypeRequestSchema>;

/**
 * Update user preferences request
 */
export const updateUserPreferencesRequestSchema = z.object({
  notificationTypeId: z.string().uuid(),
  enabled: z.boolean().optional(),
  channels: z.array(z.enum(['email', 'slack', 'gchat', 'sms', 'mobile_push'])).optional(),
  frequency: z.enum(['immediate', 'batched']).optional(),
  batchInterval: z.object({
    type: z.enum(['minutes', 'hours', 'end_of_day', 'custom']),
    value: z.number().optional(),
    scheduledFor: z.coerce.date().optional(),
  }).optional(),
  quietHours: z.object({
    start: z.string().regex(/^([0-1][0-9]|2[0-3]):[0-5][0-9]$/), // HH:mm format
    end: z.string().regex(/^([0-1][0-9]|2[0-3]):[0-5][0-9]$/),
    timezone: z.string(), // IANA timezone
  }).optional(),
  timezone: z.string().optional(),
});

export type UpdateUserPreferencesRequest = z.infer<typeof updateUserPreferencesRequestSchema>;

/**
 * Subscribe request
 */
export const subscribeRequestSchema = z.object({
  notificationTypeId: z.string().uuid(),
  channels: z.array(z.enum(['email', 'slack', 'gchat', 'sms', 'mobile_push'])).optional(),
  frequency: z.enum(['immediate', 'batched']).optional(),
  batchInterval: z.object({
    type: z.enum(['minutes', 'hours', 'end_of_day', 'custom']),
    value: z.number().optional(),
    scheduledFor: z.coerce.date().optional(),
  }).optional(),
});

export type SubscribeRequest = z.infer<typeof subscribeRequestSchema>;

/**
 * Action request
 */
export const actionRequestSchema = z.object({
  actionType: z.string().min(1),
  actionData: z.record(z.unknown()).optional(),
});

export type ActionRequest = z.infer<typeof actionRequestSchema>;

/**
 * Batch action request
 */
export const batchActionRequestSchema = z.object({
  actionType: z.string().min(1),
  notificationIds: z.array(z.string().uuid()).min(1),
  actionData: z.record(z.unknown()).optional(),
});

export type BatchActionRequest = z.infer<typeof batchActionRequestSchema>;

/**
 * Refresh subscriptions request
 */
export const refreshSubscriptionsRequestSchema = z.object({
  userId: z.string().uuid().optional(), // Optional, defaults to current user
  notificationTypeIds: z.array(z.string().uuid()).optional(), // Optional, refresh all types
});

export type RefreshSubscriptionsRequest = z.infer<typeof refreshSubscriptionsRequestSchema>;

/**
 * Create channel address request
 */
export const createChannelAddressRequestSchema = z.object({
  channel: z.enum(['slack', 'sms', 'mobile_push', 'gchat']),
  address: z.string().min(1).max(255),
  metadata: z.record(z.unknown()).optional(),
});

export type CreateChannelAddressRequest = z.infer<typeof createChannelAddressRequestSchema>;
```

### Response Schemas

```typescript
// packages/notifications/src/schemas/responses.ts

import { z } from 'zod';

/**
 * Standard API response wrapper
 */
export const apiResponseSchema = <T extends z.ZodTypeAny>(dataSchema: T) =>
  z.object({
    success: z.boolean(),
    data: dataSchema,
    error: z.string().optional(),
  });

/**
 * Notification response
 */
export const notificationResponseSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  userId: z.string().uuid(),
  notificationTypeId: z.string().uuid(),
  title: z.string(),
  body: z.string(),
  status: z.enum(['pending', 'batched', 'sent', 'failed', 'cancelled', 'expired', 'skipped', 'read']),
  priority: z.enum(['critical', 'high', 'normal', 'low']),
  scheduledFor: z.coerce.date().nullable(),
  sentAt: z.coerce.date().nullable(),
  readAt: z.coerce.date().nullable(),
  channel: z.enum(['email', 'slack', 'gchat', 'sms', 'mobile_push']).nullable(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

export type NotificationResponse = z.infer<typeof notificationResponseSchema>;

/**
 * Notification type response
 */
export const notificationTypeResponseSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  category: z.enum(['alerts', 'approvals', 'digests', 'system']).nullable(),
  defaultChannels: z.array(z.enum(['email', 'slack', 'gchat', 'sms', 'mobile_push'])),
  defaultFrequency: z.enum(['immediate', 'batched']),
  requiresAction: z.boolean(),
  isActive: z.boolean(),
  subscribed: z.boolean(), // Whether current user is subscribed
});

export type NotificationTypeResponse = z.infer<typeof notificationTypeResponseSchema>;

/**
 * User preferences response
 */
export const userPreferencesResponseSchema = z.object({
  id: z.string().uuid(),
  notificationTypeId: z.string().uuid(),
  enabled: z.boolean(),
  channels: z.array(z.enum(['email', 'slack', 'gchat', 'sms', 'mobile_push'])),
  frequency: z.enum(['immediate', 'batched']),
  batchInterval: z.object({
    type: z.enum(['minutes', 'hours', 'end_of_day', 'custom']),
    value: z.number().optional(),
    scheduledFor: z.coerce.date().optional(),
  }).nullable(),
  quietHours: z.object({
    start: z.string(),
    end: z.string(),
    timezone: z.string(),
  }).nullable(),
  subscriptionSource: z.enum(['manual', 'auto']),
});

export type UserPreferencesResponse = z.infer<typeof userPreferencesResponseSchema>;
```

---

## Service Architecture

### Service Breakdown

**Total Services: 7 Core Services**

1. **NotificationService** - Main service for creating/sending notifications
2. **NotificationTypeService** - Manages notification type definitions
3. **NotificationPreferencesService** - Manages user preferences
4. **SubscriptionService** - Handles subscriptions and auto-subscription
5. **ChannelAddressService** - Manages user channel addresses
6. **NotificationActionService** - Processes notification actions
7. **NotificationBatchService** - Manages batch creation and processing

### Service Details

#### 1. NotificationService

**Responsibilities:**
- Create notifications (fan-out)
- Send immediate notifications
- Query notifications
- Mark notifications as read
- Handle notification lifecycle

**Methods:**
```typescript
@injectable()
export class NotificationService {
  /**
   * Send notification (fan-out to subscribers)
   */
  async send(requestHeader: RequestHeader, request: SendNotificationRequest): Promise<void>;
  
  /**
   * List user's notifications
   */
  async list(requestHeader: RequestHeader, options?: ListOptions): Promise<NotificationListResponse>;
  
  /**
   * Get notification by ID
   */
  async getById(requestHeader: RequestHeader, notificationId: string): Promise<NotificationResponse | null>;
  
  /**
   * Mark notification as read
   */
  async markAsRead(requestHeader: RequestHeader, notificationId: string): Promise<void>;
  
  /**
   * Mark all notifications as read
   */
  async markAllAsRead(requestHeader: RequestHeader): Promise<void>;
  
  /**
   * Delete notification
   */
  async delete(requestHeader: RequestHeader, notificationId: string): Promise<void>;
}
```

#### 2. NotificationTypeService

**Responsibilities:**
- Create/update notification types
- List notification types
- Get notification type details
- Validate notification type configuration

**Methods:**
```typescript
@injectable()
export class NotificationTypeService {
  /**
   * Create notification type
   */
  async create(requestHeader: RequestHeader, request: CreateNotificationTypeRequest): Promise<NotificationTypeResponse>;
  
  /**
   * Update notification type
   */
  async update(requestHeader: RequestHeader, typeId: string, request: Partial<CreateNotificationTypeRequest>): Promise<NotificationTypeResponse>;
  
  /**
   * List notification types (with subscription status)
   */
  async list(requestHeader: RequestHeader): Promise<NotificationTypeResponse[]>;
  
  /**
   * Get notification type by ID
   */
  async getById(requestHeader: RequestHeader, typeId: string): Promise<NotificationTypeResponse | null>;
  
  /**
   * Delete notification type (soft delete)
   */
  async delete(requestHeader: RequestHeader, typeId: string): Promise<void>;
}
```

#### 3. NotificationPreferencesService

**Responsibilities:**
- Get user preferences
- Update user preferences
- Get preferences for notification type
- Validate preference settings

**Methods:**
```typescript
@injectable()
export class NotificationPreferencesService {
  /**
   * Get user's preferences for all notification types
   */
  async getAll(requestHeader: RequestHeader): Promise<UserPreferencesResponse[]>;
  
  /**
   * Get user's preferences for specific notification type
   */
  async getByType(requestHeader: RequestHeader, typeId: string): Promise<UserPreferencesResponse | null>;
  
  /**
   * Update user preferences
   */
  async update(requestHeader: RequestHeader, typeId: string, request: UpdateUserPreferencesRequest): Promise<UserPreferencesResponse>;
  
  /**
   * Delete user preferences (unsubscribe)
   */
  async delete(requestHeader: RequestHeader, typeId: string): Promise<void>;
}
```

#### 4. SubscriptionService

**Responsibilities:**
- Subscribe user to notification type
- Unsubscribe user from notification type
- Auto-subscribe users to new types
- Refresh subscriptions based on permissions

**Methods:**
```typescript
@injectable()
export class SubscriptionService {
  /**
   * Subscribe user to notification type
   */
  async subscribe(requestHeader: RequestHeader, request: SubscribeRequest): Promise<UserPreferencesResponse>;
  
  /**
   * Unsubscribe user from notification type
   */
  async unsubscribe(requestHeader: RequestHeader, typeId: string): Promise<void>;
  
  /**
   * Auto-subscribe users to new notification type
   */
  async autoSubscribeToNewType(tenantId: string, typeId: string): Promise<{ subscribed: number }>;
  
  /**
   * Refresh user's subscriptions based on current permissions
   */
  async refreshUserSubscriptions(requestHeader: RequestHeader, request?: RefreshSubscriptionsRequest): Promise<RefreshResult>;
  
  /**
   * Refresh all users' subscriptions (admin)
   */
  async refreshAllUsers(tenantId: string, typeIds?: string[]): Promise<RefreshResult>;
  
  /**
   * Refresh subscriptions for specific notification type (admin)
   */
  async refreshForType(tenantId: string, typeId: string): Promise<RefreshResult>;
}
```

#### 5. ChannelAddressService

**Responsibilities:**
- Create/update channel addresses
- Verify channel addresses
- Handle bounce/complaint updates
- List user's channel addresses

**Methods:**
```typescript
@injectable()
export class ChannelAddressService {
  /**
   * Create or update channel address
   */
  async upsert(requestHeader: RequestHeader, request: CreateChannelAddressRequest): Promise<ChannelAddress>;
  
  /**
   * Get user's channel addresses
   */
  async getAll(requestHeader: RequestHeader): Promise<ChannelAddress[]>;
  
  /**
   * Get channel address for specific channel
   */
  async getByChannel(requestHeader: RequestHeader, channel: NotificationChannel): Promise<ChannelAddress | null>;
  
  /**
   * Verify channel address
   */
  async verify(requestHeader: RequestHeader, channel: NotificationChannel): Promise<void>;
  
  /**
   * Delete channel address
   */
  async delete(requestHeader: RequestHeader, channel: NotificationChannel): Promise<void>;
}
```

#### 6. NotificationActionService

**Responsibilities:**
- Process individual actions
- Process batch actions
- Get action history
- Retry failed actions

**Methods:**
```typescript
@injectable()
export class NotificationActionService {
  /**
   * Process action on notification
   */
  async processAction(requestHeader: RequestHeader, notificationId: string, request: ActionRequest): Promise<ActionResponse>;
  
  /**
   * Process batch action
   */
  async processBatchAction(requestHeader: RequestHeader, request: BatchActionRequest): Promise<BatchActionResponse>;
  
  /**
   * Get action history for notification
   */
  async getActionHistory(requestHeader: RequestHeader, notificationId: string): Promise<ActionHistoryResponse[]>;
}
```

#### 7. NotificationBatchService

**Responsibilities:**
- Create batches
- Process scheduled batches
- Aggregate notifications
- Handle batch failures

**Methods:**
```typescript
@injectable()
export class NotificationBatchService {
  /**
   * Create or update batch
   */
  async createOrUpdateBatch(params: CreateBatchParams): Promise<NotificationBatch>;
  
  /**
   * Process scheduled batches (called by cron)
   */
  async processScheduledBatches(): Promise<ProcessBatchResult[]>;
  
  /**
   * Get batch details
   */
  async getBatchById(batchId: string): Promise<NotificationBatch | null>;
}
```

---

## Template & Event Specification

### Template Specification

**Location:** `packages/notifications/templates/`

**Structure:**
```
packages/notifications/templates/
├── {notification-type}/
│   ├── email/
│   │   ├── en-US.tsx          # English email template
│   │   ├── es-ES.tsx          # Spanish email template
│   │   └── default.tsx        # Default locale fallback
│   ├── slack/
│   │   └── default.json       # Slack block kit template
│   ├── sms/
│   │   └── default.txt         # SMS text template
│   └── mobile_push/
│       └── default.json        # Mobile push template
```

**Template Registration:**

Templates are registered in `notification_types.template_config`:

```json
{
  "channels": {
    "email": "escalation-alert/email/en-US",
    "slack": "escalation-alert/slack/default",
    "sms": "escalation-alert/sms/default"
  },
  "dataLoaderEnabled": false,
  "variableMapping": {
    "customerId": "customerId",
    "customerName": "customerName",
    "emailId": "emailId",
    "severity": "severity"
  }
}
```

**Template Example (Email):**

```typescript
// packages/notifications/templates/escalation-alert/email/en-US.tsx
import { Html, Head, Body, Container, Heading, Text, Button } from '@react-email/components';

export interface EscalationAlertProps {
  customerName: string;
  emailSubject: string;
  severity: 'low' | 'medium' | 'high';
  actionUrl: string;
}

export const EscalationAlertEmail = ({
  customerName,
  emailSubject,
  severity,
  actionUrl,
}: EscalationAlertProps) => {
  return (
    <Html>
      <Head />
      <Body>
        <Container>
          <Heading>Escalation Alert: {customerName}</Heading>
          <Text>Severity: {severity}</Text>
          <Text>Subject: {emailSubject}</Text>
          <Button href={actionUrl}>View Details</Button>
        </Container>
      </Body>
    </Html>
  );
};
```

**Template Example (Slack):**

```json
// packages/notifications/templates/escalation-alert/slack/default.json
{
  "blocks": [
    {
      "type": "header",
      "text": {
        "type": "plain_text",
        "text": "Escalation Alert: {{customerName}}"
      }
    },
    {
      "type": "section",
      "text": {
        "type": "mrkdwn",
        "text": "Severity: *{{severity}}*\nSubject: {{emailSubject}}"
      }
    },
    {
      "type": "actions",
      "elements": [
        {
          "type": "button",
          "text": {
            "type": "plain_text",
            "text": "View Details"
          },
          "url": "{{actionUrl}}"
        }
      ]
    }
  ]
}
```

### Event Specification

**Event Registry:**

Events are specified in project configuration (not in notification module):

```typescript
// apps/api/src/notifications/events.ts (project-specific)

export const notificationEvents = {
  /**
   * Escalation alert event
   */
  escalationAlert: {
    type: 'escalation_alert',
    requiredPermission: 'notifications:escalation:receive',
    templateConfig: {
      channels: {
        email: 'escalation-alert/email/en-US',
        slack: 'escalation-alert/slack/default',
      },
      variableMapping: {
        customerId: 'customerId',
        customerName: 'customerName',
        emailId: 'emailId',
        severity: 'severity',
      },
    },
    defaultChannels: ['email', 'slack'],
    defaultFrequency: 'immediate',
    requiresAction: true,
    autoSubscribeEnabled: true,
  },
  
  /**
   * Approval request event
   */
  approvalRequest: {
    type: 'approval_request',
    requiredPermission: 'notifications:approval:receive',
    templateConfig: {
      channels: {
        email: 'approval-request/email/en-US',
      },
      variableMapping: {
        requestId: 'requestId',
        amount: 'amount',
        requester: 'requester',
      },
    },
    defaultChannels: ['email'],
    defaultFrequency: 'batched',
    defaultBatchInterval: { type: 'minutes', value: 15 },
    requiresAction: true,
    autoSubscribeEnabled: true,
    deduplicationConfig: {
      strategy: 'overwrite',
      eventKeyFields: ['requestId'],
      updateWindowMinutes: 60,
    },
  },
  
  // ... more events
};
```

**Event Registration:**

Events are registered when notification types are created:

```typescript
// In project initialization
for (const [eventName, eventConfig] of Object.entries(notificationEvents)) {
  await notificationTypeService.create({
    tenantId,
    ...eventConfig,
  });
  
  // Auto-subscribe eligible users
  if (eventConfig.autoSubscribeEnabled) {
    await subscriptionService.autoSubscribeToNewType(tenantId, typeId);
  }
}
```

---

## Multi-Project Reuse

### Package Structure

```
packages/notifications/
├── src/
│   ├── types/
│   │   ├── core.ts              # Core types (Notification, NotificationType, etc.)
│   │   ├── interfaces.ts         # Pluggable interfaces (TemplateProvider, UserResolver)
│   │   └── channels.ts           # Channel adapter interfaces
│   ├── schemas/
│   │   ├── requests.ts           # Request Zod schemas
│   │   ├── responses.ts          # Response Zod schemas
│   │   └── database.ts           # Database Zod schemas (for validation)
│   ├── services/
│   │   ├── notification-service.ts
│   │   ├── notification-type-service.ts
│   │   ├── preferences-service.ts
│   │   ├── subscription-service.ts
│   │   ├── channel-address-service.ts
│   │   ├── action-service.ts
│   │   └── batch-service.ts
│   ├── repositories/
│   │   ├── notification-repository.ts
│   │   ├── notification-type-repository.ts
│   │   ├── preferences-repository.ts
│   │   ├── batch-repository.ts
│   │   ├── action-repository.ts
│   │   └── channel-address-repository.ts
│   ├── channels/
│   │   ├── base-channel.ts       # Abstract base class
│   │   ├── email-channel.ts      # Email adapter
│   │   ├── slack-channel.ts      # Slack adapter
│   │   └── ...                   # Other channel adapters
│   ├── templates/
│   │   ├── template-registry.ts  # Template loader
│   │   └── providers/
│   │       ├── filesystem-template-provider.ts
│   │       ├── database-template-provider.ts
│   │       └── remote-template-provider.ts
│   ├── batching/
│   │   ├── batch-manager.ts
│   │   ├── batch-processor.ts
│   │   └── batch-aggregator.ts
│   ├── actions/
│   │   ├── action-processor.ts
│   │   ├── batch-action-processor.ts
│   │   └── handlers/
│   │       ├── approval-handler.ts
│   │       └── custom-handler.ts
│   ├── inngest/
│   │   ├── functions.ts          # Function registrations
│   │   ├── fan-out-notification.ts
│   │   ├── send-immediate.ts
│   │   ├── process-batch.ts
│   │   └── process-action.ts
│   ├── utils/
│   │   ├── batch-interval.ts     # Batch interval calculation
│   │   ├── deduplication.ts      # Event deduplication logic
│   │   └── engagement.ts          # Engagement tracking utilities
│   └── index.ts                  # Public exports
├── templates/                    # Default templates (optional)
│   └── ...
├── package.json
└── tsconfig.json
```

### Project Integration

**Step 1: Install Package**

```bash
pnpm add @crm/notifications
```

**Step 2: Register Interfaces**

```typescript
// apps/api/src/notifications/setup.ts

import { container } from 'tsyringe';
import { TemplateProvider, UserResolver } from '@crm/notifications';
import { FilesystemTemplateProvider } from '@crm/notifications/providers';
import { DatabaseUserResolver } from './resolvers/database-user-resolver'; // Project-specific

export function setupNotifications() {
  // Register template provider
  container.register<TemplateProvider>('TemplateProvider', {
    useClass: FilesystemTemplateProvider,
    useValue: new FilesystemTemplateProvider('./templates'),
  });
  
  // Register user resolver (project-specific)
  container.register<UserResolver>('UserResolver', {
    useClass: DatabaseUserResolver,
  });
  
  // Register channel adapters
  container.register('EmailChannel', { useClass: EmailChannel });
  container.register('SlackChannel', { useClass: SlackChannel });
  // ... other channels
}
```

**Step 3: Define Events**

```typescript
// apps/api/src/notifications/events.ts (project-specific)

export const notificationEvents = {
  escalationAlert: {
    type: 'escalation_alert',
    requiredPermission: 'notifications:escalation:receive',
    // ... event config
  },
  // ... more events
};
```

**Step 4: Register Events**

```typescript
// apps/api/src/notifications/bootstrap.ts

export async function bootstrapNotifications(tenantId: string) {
  const notificationTypeService = container.resolve(NotificationTypeService);
  
  for (const eventConfig of Object.values(notificationEvents)) {
    // Create notification type
    const type = await notificationTypeService.create({
      tenantId,
      ...eventConfig,
    });
    
    // Auto-subscribe eligible users
    if (eventConfig.autoSubscribeEnabled) {
      const subscriptionService = container.resolve(SubscriptionService);
      await subscriptionService.autoSubscribeToNewType(tenantId, type.id);
    }
  }
}
```

**Step 5: Use in Business Logic**

```typescript
// apps/api/src/emails/service.ts

import { NotificationService } from '@crm/notifications';

@injectable()
export class EmailService {
  constructor(
    @inject(NotificationService) private notificationService: NotificationService
  ) {}
  
  async handleEscalation(customerId: string, emailId: string) {
    // Business logic...
    
    // Send notification
    await this.notificationService.send({
      tenantId,
      notificationType: 'escalation_alert',
      data: {
        customerId,
        customerName: 'Acme Corp',
        emailId,
        severity: 'high',
      },
    });
  }
}
```

### Template Customization

**Option 1: Override Templates**

```typescript
// Project-specific template provider
class CustomTemplateProvider extends FilesystemTemplateProvider {
  constructor() {
    super('./custom-templates'); // Project-specific template directory
  }
}

container.register<TemplateProvider>('TemplateProvider', {
  useClass: CustomTemplateProvider,
});
```

**Option 2: Database Templates**

```typescript
// Use database template provider
container.register<TemplateProvider>('TemplateProvider', {
  useClass: DatabaseTemplateProvider,
  useValue: new DatabaseTemplateProvider(db),
});
```

**Option 3: Remote Templates**

```typescript
// Use remote template provider
container.register<TemplateProvider>('TemplateProvider', {
  useClass: RemoteTemplateProvider,
  useValue: new RemoteTemplateProvider('https://templates.example.com', apiKey),
});
```

### User Resolver Customization

**Project-Specific Implementation:**

```typescript
// apps/api/src/notifications/resolvers/database-user-resolver.ts

import { UserResolver, NotificationUser } from '@crm/notifications';
import { db } from '@crm/database';

export class DatabaseUserResolver implements UserResolver {
  async getUser(userId: string, tenantId: string): Promise<NotificationUser | null> {
    const user = await db.query.users.findFirst({
      where: and(
        eq(users.id, userId),
        eq(users.tenantId, tenantId),
        eq(users.rowStatus, 0)
      )
    });
    
    if (!user) return null;
    
    return {
      id: user.id,
      tenantId: user.tenantId,
      email: user.email,
      name: `${user.firstName} ${user.lastName}`,
      firstName: user.firstName,
      lastName: user.lastName,
      timezone: user.timezone,
      locale: user.locale,
      isActive: user.rowStatus === 0,
    };
  }
  
  async getUserPermissions(userId: string): Promise<string[]> {
    // Project-specific permission lookup
    const user = await db.query.users.findFirst({
      where: eq(users.id, userId),
      include: { role: { include: { permissions: true } } }
    });
    
    return user?.role?.permissions?.map(p => p.name) || [];
  }
  
  createDataAccessChecker(userId: string, tenantId: string) {
    return async (context: NotificationDataContext): Promise<boolean> => {
      // Project-specific data access checks
      if (context.data.customerId) {
        return this.hasCustomerAccess(userId, context.data.customerId);
      }
      // ... more checks
      return true;
    };
  }
  
  // ... implement all interface methods
}
```

### Event Registration Pattern

**Centralized Event Registry:**

```typescript
// apps/api/src/notifications/events/index.ts

export const notificationEvents = {
  // Email analysis events
  escalationAlert: require('./email-analysis/escalation-alert').default,
  dailyDigest: require('./email-analysis/daily-digest').default,
  
  // Approval events
  approvalRequest: require('./approvals/approval-request').default,
  approvalStatusChanged: require('./approvals/approval-status-changed').default,
  
  // System events
  systemUpdate: require('./system/system-update').default,
};

// Auto-register on startup
export async function registerAllEvents(tenantId: string) {
  const notificationTypeService = container.resolve(NotificationTypeService);
  const subscriptionService = container.resolve(SubscriptionService);
  
  for (const [eventName, eventConfig] of Object.entries(notificationEvents)) {
    const type = await notificationTypeService.create({
      tenantId,
      ...eventConfig,
    });
    
    if (eventConfig.autoSubscribeEnabled) {
      await subscriptionService.autoSubscribeToNewType(tenantId, type.id);
    }
  }
}
```

**Per-Module Event Definitions:**

```typescript
// apps/api/src/emails/notifications.ts

export const emailNotificationEvents = {
  escalationAlert: {
    type: 'escalation_alert',
    requiredPermission: 'notifications:escalation:receive',
    // ... config
  },
};

// Register when email module initializes
export async function registerEmailNotifications(tenantId: string) {
  // Register events...
}
```

---

## Package Exports

### Public API

```typescript
// packages/notifications/src/index.ts

// Types
export * from './types/core';
export * from './types/interfaces';
export * from './types/channels';

// Schemas
export * from './schemas/requests';
export * from './schemas/responses';

// Services
export { NotificationService } from './services/notification-service';
export { NotificationTypeService } from './services/notification-type-service';
export { NotificationPreferencesService } from './services/preferences-service';
export { SubscriptionService } from './services/subscription-service';
export { ChannelAddressService } from './services/channel-address-service';
export { NotificationActionService } from './services/action-service';
export { NotificationBatchService } from './services/batch-service';

// Channel Adapters
export { BaseChannel } from './channels/base-channel';
export { EmailChannel } from './channels/email-channel';
export { SlackChannel } from './channels/slack-channel';
// ... other channels

// Template Providers
export { TemplateProvider } from './types/interfaces';
export { FilesystemTemplateProvider } from './templates/providers/filesystem-template-provider';
export { DatabaseTemplateProvider } from './templates/providers/database-template-provider';
export { RemoteTemplateProvider } from './templates/providers/remote-template-provider';

// Utilities
export { calculateScheduledTime } from './utils/batch-interval';
export { calculateEventKey } from './utils/deduplication';
```

---

## Setting Up in a New Application

### Initial Setup Steps

**Step 1: Install Package**

```bash
cd apps/new-app
pnpm add @crm/notifications
```

**Step 2: Create Database Tables**

Run SQL migrations to create all notification tables:

```bash
# Run all notification table creation scripts
psql $DATABASE_URL -f packages/notifications/sql/notification_types.sql
psql $DATABASE_URL -f packages/notifications/sql/user_notification_preferences.sql
psql $DATABASE_URL -f packages/notifications/sql/notifications.sql
psql $DATABASE_URL -f packages/notifications/sql/notification_batches.sql
psql $DATABASE_URL -f packages/notifications/sql/notification_actions.sql
psql $DATABASE_URL -f packages/notifications/sql/notification_batch_actions.sql
psql $DATABASE_URL -f packages/notifications/sql/user_channel_addresses.sql
psql $DATABASE_URL -f packages/notifications/sql/notification_audit_log.sql
psql $DATABASE_URL -f packages/notifications/sql/notification_bounce_complaints.sql
```

**Step 3: Implement User Resolver**

Create project-specific user resolver:

```typescript
// apps/new-app/src/notifications/user-resolver.ts

import { UserResolver, NotificationUser, ChannelAddress, UserNotificationPreferences, SubscriptionConditions, NotificationDataContext } from '@crm/notifications';
import { db } from '../database'; // Your database instance
import { users, userCustomers, userManagers } from '../schema'; // Your user schema
import { eq, and, sql } from 'drizzle-orm';

export class NewAppUserResolver implements UserResolver {
  async getUser(userId: string, tenantId: string): Promise<NotificationUser | null> {
    const user = await db.query.users.findFirst({
      where: and(
        eq(users.id, userId),
        eq(users.tenantId, tenantId),
        eq(users.isActive, true)
      )
    });
    
    if (!user) return null;
    
    return {
      id: user.id,
      tenantId: user.tenantId,
      email: user.email,
      name: `${user.firstName} ${user.lastName}`,
      firstName: user.firstName,
      lastName: user.lastName,
      timezone: user.timezone || 'UTC',
      locale: user.locale || 'en-US',
      isActive: user.isActive,
    };
  }
  
  async getUserChannelAddress(userId: string, channel: string): Promise<ChannelAddress | null> {
    if (channel === 'email') {
      // Email from users table
      const user = await db.query.users.findFirst({
        where: eq(users.id, userId),
        columns: { email: true }
      });
      
      return user ? {
        id: `email-${userId}`,
        tenantId: '', // Will be set by caller
        userId,
        channel: 'email' as const,
        address: user.email,
        isVerified: true,
        isDisabled: false,
        bounceCount: 0,
        complaintCount: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      } : null;
    }
    
    // Other channels from user_channel_addresses table
    const address = await db.query.userChannelAddresses.findFirst({
      where: and(
        eq(userChannelAddresses.userId, userId),
        eq(userChannelAddresses.channel, channel)
      )
    });
    
    return address ? {
      id: address.id,
      tenantId: address.tenantId,
      userId: address.userId,
      channel: address.channel as any,
      address: address.address,
      isVerified: address.isVerified,
      isDisabled: address.isDisabled,
      verifiedAt: address.verifiedAt,
      bounceCount: address.bounceCount,
      complaintCount: address.complaintCount,
      metadata: address.metadata,
      createdAt: address.createdAt,
      updatedAt: address.updatedAt,
    } : null;
  }
  
  async getUserPreferences(userId: string, typeId: string): Promise<UserNotificationPreferences | null> {
    const pref = await db.query.userNotificationPreferences.findFirst({
      where: and(
        eq(userNotificationPreferences.userId, userId),
        eq(userNotificationPreferences.notificationTypeId, typeId)
      )
    });
    
    return pref ? this.mapToPreferences(pref) : null;
  }
  
  async getSubscribers(tenantId: string, typeId: string): Promise<string[]> {
    // Get notification type to check permission
    const type = await db.query.notificationTypes.findFirst({
      where: eq(notificationTypes.id, typeId)
    });
    
    if (!type || !type.requiredPermission) {
      return []; // No permission requirement, no subscribers
    }
    
    // Find all users with required permission
    const usersWithPermission = await db.execute(sql`
      SELECT DISTINCT u.id
      FROM users u
      INNER JOIN user_roles ur ON u.role_id = ur.role_id
      INNER JOIN role_permissions rp ON ur.role_id = rp.role_id
      INNER JOIN permissions p ON rp.permission_id = p.id
      WHERE u.tenant_id = ${tenantId}
        AND u.is_active = true
        AND p.name = ${type.requiredPermission}
    `);
    
    // Filter by subscription preferences
    const subscribedUsers = await db.execute(sql`
      SELECT DISTINCT unp.user_id
      FROM user_notification_preferences unp
      WHERE unp.notification_type_id = ${typeId}
        AND unp.enabled = true
        AND unp.user_id = ANY(${usersWithPermission.map(r => r.id)})
      
      UNION
      
      SELECT DISTINCT u.id
      FROM users u
      WHERE u.tenant_id = ${tenantId}
        AND u.is_active = true
        AND u.id = ANY(${usersWithPermission.map(r => r.id)})
        AND NOT EXISTS (
          SELECT 1 FROM user_notification_preferences unp
          WHERE unp.user_id = u.id
            AND unp.notification_type_id = ${typeId}
            AND unp.enabled = false
        )
    `);
    
    return subscribedUsers.map(row => row.user_id || row.id);
  }
  
  async getUserTimezone(userId: string): Promise<string | null> {
    const user = await db.query.users.findFirst({
      where: eq(users.id, userId),
      columns: { timezone: true }
    });
    
    return user?.timezone || null;
  }
  
  async getUserLocale(userId: string): Promise<string | null> {
    const user = await db.query.users.findFirst({
      where: eq(users.id, userId),
      columns: { locale: true }
    });
    
    return user?.locale || null;
  }
  
  async userExists(userId: string, tenantId: string): Promise<boolean> {
    const user = await db.query.users.findFirst({
      where: and(
        eq(users.id, userId),
        eq(users.tenantId, tenantId),
        eq(users.isActive, true)
      ),
      columns: { id: true }
    });
    
    return !!user;
  }
  
  async tenantActive(tenantId: string): Promise<boolean> {
    const tenant = await db.query.tenants.findFirst({
      where: eq(tenants.id, tenantId),
      columns: { isActive: true }
    });
    
    return tenant?.isActive ?? true;
  }
  
  async getUserPermissions(userId: string): Promise<string[]> {
    const user = await db.query.users.findFirst({
      where: eq(users.id, userId),
      include: {
        role: {
          include: {
            permissions: true
          }
        }
      }
    });
    
    return user?.role?.permissions?.map(p => p.name) || [];
  }
  
  async userHasPermission(userId: string, permission: string): Promise<boolean> {
    const permissions = await this.getUserPermissions(userId);
    return permissions.includes(permission);
  }
  
  async userMatchesConditions(userId: string, conditions: SubscriptionConditions): Promise<boolean> {
    if (conditions.hasCustomers) {
      const count = await db.query.userCustomers.count({
        where: eq(userCustomers.userId, userId)
      });
      if (count === 0) return false;
    }
    
    if (conditions.hasManager) {
      const count = await db.query.userManagers.count({
        where: eq(userManagers.userId, userId)
      });
      if (count === 0) return false;
    }
    
    return true;
  }
  
  createDataAccessChecker(userId: string, tenantId: string) {
    return async (context: NotificationDataContext): Promise<boolean> => {
      // Check permission first
      const type = await db.query.notificationTypes.findFirst({
        where: eq(notificationTypes.name, context.notificationType)
      });
      
      if (type?.requiredPermission) {
        const hasPermission = await this.userHasPermission(userId, type.requiredPermission);
        if (!hasPermission) return false;
      }
      
      // Check data access based on notification type and data context
      if (context.data.customerId) {
        const hasAccess = await this.hasCustomerAccess(userId, context.data.customerId as string);
        if (!hasAccess) return false;
      }
      
      // Add more data access checks as needed for your app
      
      return true;
    };
  }
  
  private async hasCustomerAccess(userId: string, customerId: string): Promise<boolean> {
    // Your app-specific customer access check
    const result = await db.execute(sql`
      SELECT 1 FROM user_accessible_customers
      WHERE user_id = ${userId} AND customer_id = ${customerId}
      LIMIT 1
    `);
    return result.length > 0;
  }
  
  private mapToPreferences(pref: any): UserNotificationPreferences {
    return {
      id: pref.id,
      tenantId: pref.tenantId,
      userId: pref.userId,
      notificationTypeId: pref.notificationTypeId,
      enabled: pref.enabled,
      channels: pref.channels,
      frequency: pref.frequency,
      batchInterval: pref.batchInterval,
      quietHours: pref.quietHours,
      timezone: pref.timezone,
      subscriptionSource: pref.subscriptionSource,
      autoSubscribedAt: pref.autoSubscribedAt,
      createdAt: pref.createdAt,
      updatedAt: pref.updatedAt,
    };
  }
}
```

**Step 4: Register Template Provider**

```typescript
// apps/new-app/src/notifications/setup.ts

import { container } from 'tsyringe';
import { TemplateProvider, UserResolver } from '@crm/notifications';
import { FilesystemTemplateProvider } from '@crm/notifications/providers';
import { NewAppUserResolver } from './user-resolver';

export function setupNotifications() {
  // Register template provider
  container.register<TemplateProvider>('TemplateProvider', {
    useValue: new FilesystemTemplateProvider('./templates/notifications'),
  });
  
  // Register user resolver
  container.register<UserResolver>('UserResolver', {
    useClass: NewAppUserResolver,
  });
  
  // Register channel adapters
  container.register('EmailChannel', { useClass: EmailChannel });
  container.register('SlackChannel', { useClass: SlackChannel });
  // ... other channels
}
```

**Step 5: Define Notification Events**

```typescript
// apps/new-app/src/notifications/events.ts

export const notificationEvents = {
  /**
   * Example: Task assigned notification
   */
  taskAssigned: {
    name: 'task_assigned',
    description: 'Notification when a task is assigned to you',
    category: 'alerts' as const,
    requiredPermission: 'notifications:task:receive',
    autoSubscribeEnabled: true,
    defaultChannels: ['email', 'slack'],
    defaultFrequency: 'immediate' as const,
    requiresAction: true,
    defaultPriority: 'normal' as const,
    templateConfig: {
      channels: {
        email: 'task-assigned/email/en-US',
        slack: 'task-assigned/slack/default',
      },
      variableMapping: {
        taskId: 'taskId',
        taskTitle: 'taskTitle',
        assignerName: 'assignerName',
        dueDate: 'dueDate',
      },
    },
  },
  
  /**
   * Example: Weekly summary notification
   */
  weeklySummary: {
    name: 'weekly_summary',
    description: 'Weekly summary of your tasks and activities',
    category: 'digests' as const,
    requiredPermission: 'notifications:summary:receive',
    autoSubscribeEnabled: true,
    defaultChannels: ['email'],
    defaultFrequency: 'batched' as const,
    defaultBatchInterval: { type: 'end_of_day' as const },
    requiresAction: false,
    defaultPriority: 'low' as const,
    templateConfig: {
      channels: {
        email: 'weekly-summary/email/en-US',
      },
      variableMapping: {
        weekStart: 'weekStart',
        weekEnd: 'weekEnd',
        tasksCompleted: 'tasksCompleted',
        tasksPending: 'tasksPending',
      },
    },
  },
  
  // Add more events as needed
};
```

**Step 6: Register Events on Startup**

```typescript
// apps/new-app/src/notifications/bootstrap.ts

import { container } from 'tsyringe';
import { NotificationTypeService, SubscriptionService } from '@crm/notifications';
import { notificationEvents } from './events';

export async function bootstrapNotifications(tenantId: string) {
  const notificationTypeService = container.resolve(NotificationTypeService);
  const subscriptionService = container.resolve(SubscriptionService);
  
  for (const [eventName, eventConfig] of Object.entries(notificationEvents)) {
    try {
      // Check if notification type already exists
      const existing = await notificationTypeService.getByName(tenantId, eventConfig.name);
      
      if (existing) {
        console.log(`Notification type ${eventConfig.name} already exists, skipping...`);
        continue;
      }
      
      // Create notification type
      const type = await notificationTypeService.create({
        tenantId,
        ...eventConfig,
      });
      
      console.log(`Created notification type: ${eventConfig.name}`);
      
      // Auto-subscribe eligible users
      if (eventConfig.autoSubscribeEnabled) {
        const result = await subscriptionService.autoSubscribeToNewType(tenantId, type.id);
        console.log(`Auto-subscribed ${result.subscribed} users to ${eventConfig.name}`);
      }
    } catch (error) {
      console.error(`Failed to register notification event ${eventName}:`, error);
      // Continue with other events
    }
  }
}

// Call on app startup
export async function initializeNotifications() {
  // Get all tenants (or specific tenant)
  const tenants = await getAllTenants(); // Your function to get tenants
  
  for (const tenant of tenants) {
    await bootstrapNotifications(tenant.id);
  }
}
```

**Step 7: Create Templates**

```typescript
// apps/new-app/templates/notifications/task-assigned/email/en-US.tsx

import { Html, Head, Body, Container, Heading, Text, Button } from '@react-email/components';

export interface TaskAssignedProps {
  taskTitle: string;
  assignerName: string;
  dueDate: string;
  actionUrl: string;
}

export const TaskAssignedEmail = ({
  taskTitle,
  assignerName,
  dueDate,
  actionUrl,
}: TaskAssignedProps) => {
  return (
    <Html>
      <Head />
      <Body>
        <Container>
          <Heading>New Task Assigned</Heading>
          <Text>You have been assigned a new task: <strong>{taskTitle}</strong></Text>
          <Text>Assigned by: {assignerName}</Text>
          <Text>Due date: {dueDate}</Text>
          <Button href={actionUrl}>View Task</Button>
        </Container>
      </Body>
    </Html>
  );
};
```

```json
// apps/new-app/templates/notifications/task-assigned/slack/default.json
{
  "blocks": [
    {
      "type": "header",
      "text": {
        "type": "plain_text",
        "text": "New Task Assigned: {{taskTitle}}"
      }
    },
    {
      "type": "section",
      "text": {
        "type": "mrkdwn",
        "text": "Assigned by: *{{assignerName}}*\nDue date: {{dueDate}}"
      }
    },
    {
      "type": "actions",
      "elements": [
        {
          "type": "button",
          "text": {
            "type": "plain_text",
            "text": "View Task"
          },
          "url": "{{actionUrl}}"
        }
      ]
    }
  ]
}
```

**Step 8: Use in Business Logic**

```typescript
// apps/new-app/src/tasks/service.ts

import { NotificationService } from '@crm/notifications';
import { container } from 'tsyringe';

@injectable()
export class TaskService {
  constructor(
    @inject(NotificationService) private notificationService: NotificationService
  ) {}
  
  async assignTask(taskId: string, assigneeId: string, assignerId: string) {
    // Business logic to assign task
    const task = await this.taskRepo.assign(taskId, assigneeId);
    
    // Send notification
    await this.notificationService.send({
      tenantId: task.tenantId,
      notificationType: 'task_assigned',
      data: {
        taskId: task.id,
        taskTitle: task.title,
        assignerName: await this.getUserName(assignerId),
        dueDate: task.dueDate?.toISOString(),
        actionUrl: `/tasks/${task.id}`,
      },
      userIds: [assigneeId], // Send to specific user
    });
    
    return task;
  }
}
```

**Step 9: Set Up Inngest Functions**

```typescript
// apps/new-app/src/notifications/inngest.ts

import { inngest } from '../inngest/client';
import { 
  fanOutNotification,
  sendImmediateNotification,
  processBatch,
  processAction,
  processBounceComplaint,
  expireNotifications
} from '@crm/notifications/inngest';

// Register all Inngest functions
export const notificationFunctions = [
  fanOutNotification,
  sendImmediateNotification,
  processBatch,
  processAction,
  processBounceComplaint,
  expireNotifications,
];

// Register with Inngest
inngest.serve({
  functions: notificationFunctions,
});
```

**Step 10: Add API Routes**

```typescript
// apps/new-app/src/notifications/routes.ts

import { Hono } from 'hono';
import { container } from 'tsyringe';
import {
  NotificationService,
  NotificationTypeService,
  NotificationPreferencesService,
  SubscriptionService,
  ChannelAddressService,
  NotificationActionService,
} from '@crm/notifications';
import {
  sendNotificationRequestSchema,
  subscribeRequestSchema,
  actionRequestSchema,
  // ... other schemas
} from '@crm/notifications/schemas';
import { handleApiRequest } from '../utils/api-handler';

const app = new Hono();

// Send notification
app.post('/send', async (c) => {
  return handleApiRequest(
    c,
    sendNotificationRequestSchema,
    async (requestHeader, request) => {
      const service = container.resolve(NotificationService);
      await service.send(requestHeader, request);
      return { success: true };
    }
  );
});

// List notifications
app.get('/', async (c) => {
  return handleApiRequest(
    c,
    null, // No body validation for GET
    async (requestHeader) => {
      const service = container.resolve(NotificationService);
      const options = {
        limit: parseInt(c.req.query('limit') || '50'),
        offset: parseInt(c.req.query('offset') || '0'),
      };
      return service.list(requestHeader, options);
    }
  );
});

// Subscribe
app.post('/subscribe', async (c) => {
  return handleApiRequest(
    c,
    subscribeRequestSchema,
    async (requestHeader, request) => {
      const service = container.resolve(SubscriptionService);
      return service.subscribe(requestHeader, request);
    }
  );
});

// ... more routes

export default app;
```

**Step 11: Initialize on App Startup**

```typescript
// apps/new-app/src/index.ts

import { setupNotifications } from './notifications/setup';
import { initializeNotifications } from './notifications/bootstrap';

async function main() {
  // Setup dependency injection
  setupNotifications();
  
  // Register notification events
  await initializeNotifications();
  
  // Start server
  // ...
}

main();
```

### Checklist for New App

- [ ] Install `@crm/notifications` package
- [ ] Run database migrations (create all tables)
- [ ] Implement `UserResolver` interface (project-specific)
- [ ] Register `TemplateProvider` (filesystem/database/remote)
- [ ] Register `UserResolver` in DI container
- [ ] Register channel adapters (Email, Slack, etc.)
- [ ] Define notification events (project-specific)
- [ ] Create templates for events
- [ ] Register events on startup (bootstrap)
- [ ] Set up Inngest functions
- [ ] Add API routes
- [ ] Initialize on app startup
- [ ] Test sending a notification

### Minimal Example

For a quick start, here's the minimal setup:

```typescript
// Minimal setup
import { setupNotifications, bootstrapNotifications } from './notifications';

// 1. Setup (once)
setupNotifications();

// 2. Bootstrap events (once per tenant)
await bootstrapNotifications(tenantId);

// 3. Use in business logic
const notificationService = container.resolve(NotificationService);
await notificationService.send({
  tenantId,
  notificationType: 'task_assigned',
  data: { taskId: '...', taskTitle: '...' },
});
```

---

## Summary

### Database Tables: 8 Tables
1. `notification_types`
2. `user_notification_preferences`
3. `notifications`
4. `notification_batches`
5. `notification_actions`
6. `notification_batch_actions`
7. `user_channel_addresses`
8. `notification_audit_log`
9. `notification_bounce_complaints`

### Services: 7 Core Services
1. NotificationService
2. NotificationTypeService
3. NotificationPreferencesService
4. SubscriptionService
5. ChannelAddressService
6. NotificationActionService
7. NotificationBatchService

### Templates & Events:
- **Templates:** Stored in `packages/notifications/templates/` or via TemplateProvider
- **Events:** Defined in project-specific configuration files
- **Registration:** Events registered via NotificationTypeService.create()
- **Auto-subscription:** Triggered when new notification type created

### Multi-Project Reuse:
- **Package:** `packages/notifications/` - Reusable package
- **Interfaces:** TemplateProvider, UserResolver - Pluggable
- **Project Integration:** Register interfaces, define events, use services
- **Customization:** Override template provider, implement user resolver per project
