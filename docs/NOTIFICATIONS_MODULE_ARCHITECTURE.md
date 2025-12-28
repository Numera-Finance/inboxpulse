# Notifications Module Architecture Design

## Overview

A scalable, maintainable, extensible, and secure notification system that supports multiple channels (email, Slack, Google Chat, SMS, mobile push), batching strategies, user preferences, rich templating, and actionable notifications.

---

## Table of Contents

1. [Architecture Principles](#architecture-principles)
2. [Core Concepts](#core-concepts)
3. [Pluggable Interfaces](#pluggable-interfaces)
4. [Data Model](#data-model)
5. [System Architecture](#system-architecture)
6. [Notification Flow](#notification-flow)
7. [Batching Strategy](#batching-strategy)
8. [Templating System](#templating-system)
9. [Action System](#action-system)
10. [Fan-Out Pattern](#fan-out-pattern)
11. [Engagement Tracking](#engagement-tracking)
12. [Subscription Management & UI Integration](#subscription-management--ui-integration)
13. [Edge Cases & Error Handling](#edge-cases--error-handling)
14. [Security & Privacy](#security--privacy)
15. [Scalability Considerations](#scalability-considerations)
16. [Integration Points](#integration-points)
17. [Design Decisions](#design-decisions)
18. [Implementation Phases](#implementation-phases)

---

## Architecture Principles

### 1. **Provider-Agnostic Core**
- Core notification logic is independent of delivery channels
- Each channel (email, Slack, etc.) is a pluggable adapter following a common interface
- New channels can be added without modifying core logic
- Channel-specific logic isolated in adapter layer

### 1a. **Pluggable Abstractions**
- **Template Provider Interface** - Abstracts template storage (filesystem, database, remote service)
- **User Resolver Interface** - Abstracts user/tenant data access (decouples from specific user model)
- **Channel Address Resolver Interface** - Abstracts channel address lookup
- Allows package to be reused across different projects with different data models

### 2. **Event-Driven Architecture**
- Notifications triggered via events (using Inngest, consistent with existing patterns)
- Decoupled from business logic that generates notifications
- Supports retries, observability, and fan-out naturally
- Async processing prevents blocking business operations

### 3. **User-Centric Preferences**
- Each user controls their notification preferences
- Per-notification-type granularity (user can enable escalation alerts but disable daily digests)
- Per-channel preferences (e.g., email but not Slack for same notification type)
- Preferences inherit defaults but can be overridden
- Quiet hours support (timezone-aware)

### 4. **Batching Intelligence**
- Configurable batching intervals: immediate, minutes, hours, end-of-day
- Per-user, per-notification-type batching configuration
- Reduces notification fatigue while maintaining timely delivery
- Batch aggregation creates digest-style notifications

### 5. **Actionable Notifications**
- Notifications can contain actionable items (approve/reject, custom actions)
- Batch actions allow users to approve/reject multiple items in one transaction
- Actions processed atomically (all succeed or all fail)
- Action URLs include signed tokens for security

### 6. **Template-Driven Content**
- React-email for rich email templates (HTML emails)
- Channel-specific template adapters (Slack blocks, SMS text, etc.)
- Versioned templates for A/B testing and gradual rollouts
- Template variables injected at render time

---

## Core Concepts

### Notification Types
A notification type represents a category of notifications (e.g., `escalation_alert`, `approval_request`, `daily_digest`).

**Key Attributes:**
- Unique name per tenant (e.g., "escalation_alert")
- Description for user-facing UI
- Default channels (if user hasn't configured preferences)
- Default frequency (immediate vs batched)
- Default batch interval (if batched)
- Whether it supports actions (requiresAction flag)

**Examples:**
- `escalation_alert` - Immediate, email + Slack, requires action
- `approval_request` - Batched (15 min), email only, requires action
- `daily_digest` - End-of-day, email only, no actions
- `system_update` - Immediate, all channels, no actions

### Notification Channels
Delivery mechanisms for notifications.

**Supported Channels:**
- **Email** - HTML emails via SMTP/transactional email service
- **Slack** - Messages via Slack webhooks/API
- **Google Chat** - Messages via Google Chat webhooks/API
- **SMS** - Text messages via Twilio or similar
- **Mobile Push** - Push notifications via FCM (Android) / APNS (iOS)

**Channel Configuration:**
- Enabled/disabled per tenant
- Credentials stored in `integrations` table (encrypted, same pattern as Gmail)
- Rate limits configurable per channel
- Channel-specific delivery tracking

### Batch Intervals
How notifications are batched together before delivery.

**Types:**
1. **Immediate** - Send as soon as notification is created (`scheduled_for = NOW()`)
2. **Scheduled** - Send at a specific time (`scheduled_for = releaseAt timestamp`)
   - **Minutes** - Release at current time + N minutes (e.g., 15 minutes)
   - **Hours** - Release at current time + N hours (e.g., 2 hours)
   - **End of Day** - Release at end of day in user's timezone (calculated as UTC timestamp)
   - **Custom Time** - Release at any specific UTC timestamp

**Unified Batch Interval Calculation:**
- All batching modes use the same `scheduled_for` (releaseAt) mechanism
- Timezone-aware calculation converts user's local time to UTC
- Stored as `scheduled_for` timestamp in UTC
- Single cron job processes all batches where `scheduled_for <= NOW()`
- No special logic needed for end-of-day - it's just a calculated `scheduled_for` timestamp

### User Preferences
Per-user, per-notification-type preferences.

**Preference Structure:**
- Enabled/disabled flag
- Selected channels (array of channel names)
- Frequency (immediate vs batched)
- Batch interval (if batched)
- Quiet hours (optional, timezone-aware)

**Preference Resolution:**
1. Check user-specific preference (if exists)
2. Fall back to notification type defaults
3. Fall back to tenant defaults (if configured)
4. System defaults (immediate, email only)

**Preference Inheritance:**
- User preferences override type defaults
- Team/role-level preferences (future enhancement)
- Tenant-level defaults (future enhancement)

---

## Data Model

### Entity Relationship Diagram

```
tenants
  ├── notification_types (1:N)
  │     ├── notifications (1:N)
  │     ├── user_notification_preferences (1:N)
  │     └── notification_batches (1:N)
  │
  └── users (1:N)
        ├── notifications (1:N)
        ├── user_notification_preferences (1:N)
        ├── notification_batches (1:N)
        ├── notification_actions (1:N)
        └── notification_batch_actions (1:N)

notifications
  ├── notification_batches (N:1, optional)
  └── notification_actions (1:N)

notification_batch_actions
  └── notification_actions (1:N)

users
  └── user_channel_addresses (1:N)
```

### Table: `notification_types`
Defines available notification types in the system.

**Key Fields:**
- `id` - UUID primary key
- `tenant_id` - Foreign key to tenants (multi-tenancy)
- `name` - Unique name per tenant (e.g., "escalation_alert")
- `description` - User-facing description
- `category` - VARCHAR(50) (e.g., 'alerts', 'approvals', 'digests', 'system')
- `default_channels` - JSONB array of channel names
- `default_frequency` - 'immediate' or 'batched'
- `default_batch_interval` - JSONB (null for immediate)
- `requires_action` - Boolean flag
- `is_active` - Soft delete flag
- `auto_subscribe_enabled` - BOOLEAN DEFAULT false (auto-subscribe eligible users)
- `required_permission` - VARCHAR(100) (permission string required to receive this notification)
  - If user has this permission → auto-subscribe when type is created
  - If user doesn't have permission → cannot subscribe (even manually)
- `subscription_conditions` - JSONB (optional additional conditions)
  - `hasCustomers?: boolean` - User must have customer assignments
  - `hasManager?: boolean` - User must have a manager
  - Other custom conditions
- `template_config` - JSONB (externalized template configuration)
  - `channels` - Object mapping channel names to template paths/IDs
  - `data_loader_enabled` - Boolean (allow templates to query APIs)
  - `variable_mapping` - Object (metadata keys → template variable names)
- `deduplication_config` - JSONB (how to handle duplicate events)
  - `strategy` - 'overwrite' | 'create_new' | 'ignore'
  - `event_key_fields` - Array of metadata field names to hash for event_key
  - `update_window_minutes` - Integer (time window to consider for updates)
- `default_expires_after_hours` - Integer (default expiry time, null for no expiry)
- `default_priority` - VARCHAR(20) DEFAULT 'normal' ('critical', 'high', 'normal', 'low')
- `created_at` - TIMESTAMPTZ NOT NULL DEFAULT NOW()
- `updated_at` - TIMESTAMPTZ NOT NULL DEFAULT NOW()

**Indexes:**
- Unique constraint on `(tenant_id, name)`
- Index on `tenant_id` for tenant queries
- Index on `(tenant_id, is_active)` for active type queries

### Table: `user_notification_preferences`
User-specific preferences for each notification type.

**Key Fields:**
- `id` - UUID primary key
- `tenant_id` - Foreign key to tenants
- `user_id` - Foreign key to users
- `notification_type_id` - Foreign key to notification_types
- `enabled` - Boolean (user can disable specific types)
- `channels` - JSONB array of channel names
- `frequency` - 'immediate' or 'batched'
- `batch_interval` - JSONB (null for immediate)
- `quiet_hours` - JSONB (optional, timezone-aware)
- `timezone` - VARCHAR(50) (IANA timezone, e.g., 'America/New_York', inherits from users table if null)
- `subscription_source` - VARCHAR(50) ('manual', 'auto', 'role', 'permission') - How user was subscribed
- `auto_subscribed_at` - TIMESTAMPTZ (when auto-subscribed, nullable)
- `created_at` - TIMESTAMPTZ NOT NULL DEFAULT NOW()
- `updated_at` - TIMESTAMPTZ NOT NULL DEFAULT NOW()

**Indexes:**
- Unique constraint on `(user_id, notification_type_id)`
- Index on `user_id` for user preference queries
- Index on `notification_type_id` for type queries
- Partial index on `(user_id, enabled)` where enabled=true

### Table: `notifications`
Individual notification records (before batching/delivery).

**Key Fields:**
- `id` - UUID primary key
- `tenant_id` - Foreign key to tenants
- `user_id` - Foreign key to users (recipient)
- `notification_type_id` - Foreign key to notification_types
- `title` - Notification title
- `body` - Rendered template content (channel-specific)
- `metadata` - JSONB (additional context for templates/actions)
- `action_items` - JSONB (array of actionable items, if applicable)
- `status` - Enum: 'pending', 'batched', 'sent', 'failed', 'cancelled', 'skipped', 'expired', 'read'
- `priority` - VARCHAR(20) DEFAULT 'normal' ('critical', 'high', 'normal', 'low')
- `scheduled_for` - Timestamp (when to send, for batching - unified releaseAt)
- `expires_at` - Timestamp (skip sending if expired, nullable)
- `sent_at` - Timestamp (when actually sent)
- `read_at` - Timestamp (when user marked as read, nullable)
- `batch_id` - Foreign key to notification_batches (nullable)
- `channel` - VARCHAR(50) (channel this notification is for, e.g., 'email', 'slack')
- `delivery_attempts` - JSONB array (tracking per channel)
- `event_key` - String (optional, for deduplication - hash of event identifier)
- `event_version` - Integer (optional, for tracking event modifications)
- `idempotency_key` - String (optional, for idempotent notify() calls)
- `engagement` - JSONB (open/click tracking data)
- `locale` - VARCHAR(10) (e.g., 'en-US', 'es-ES', inherits from user)
- `created_at` - TIMESTAMPTZ NOT NULL DEFAULT NOW()
- `updated_at` - TIMESTAMPTZ NOT NULL DEFAULT NOW()

**Indexes:**
- Index on `user_id` for user notification queries
- Index on `notification_type_id` for type queries
- Index on `(status, scheduled_for)` where status in ('pending', 'batched')
- Index on `batch_id` for batch queries
- Index on `scheduled_for` where scheduled_for IS NOT NULL
- Index on `expires_at` where expires_at IS NOT NULL
- Index on `read_at` where read_at IS NULL (for unread queries)
- Index on `priority` for priority-based queries
- Unique index on `(user_id, notification_type_id, event_key)` where event_key IS NOT NULL (for deduplication)
- Unique index on `idempotency_key` where idempotency_key IS NOT NULL
- Index on `event_key` for event-based queries
- Index on `channel` for channel-based queries

### Table: `notification_batches`
Groups notifications for batch delivery.

**Key Fields:**
- `id` - UUID primary key
- `tenant_id` - Foreign key to tenants
- `user_id` - Foreign key to users (recipient)
- `notification_type_id` - Foreign key to notification_types
- `channel` - Channel name (e.g., 'email', 'slack')
- `batch_interval` - JSONB (interval configuration)
- `status` - Enum: 'pending', 'processing', 'sent', 'failed'
- `scheduled_for` - Timestamp (when to send batch)
- `sent_at` - Timestamp (when actually sent)
- `aggregated_content` - JSONB (digest-style aggregated content)
- `delivery_attempts` - JSONB array (tracking)

**Indexes:**
- Index on `user_id` for user batch queries
- Index on `(scheduled_for, status)` where status='pending' (for cron queries)
- Index on `notification_type_id` for type queries

### Table: `notification_actions`
Tracks actions taken on notifications.

**Key Fields:**
- `id` - UUID primary key
- `tenant_id` - Foreign key to tenants
- `user_id` - Foreign key to users (who took action)
- `notification_id` - Foreign key to notifications
- `action_type` - String (e.g., 'approve', 'reject', 'dismiss')
- `action_data` - JSONB (additional action context)
- `batch_action_id` - Foreign key to notification_batch_actions (nullable)
- `status` - Enum: 'pending', 'processing', 'completed', 'failed'
- `processed_at` - Timestamp
- `error_message` - Text (if failed)

**Indexes:**
- Index on `notification_id` for notification action queries
- Index on `user_id` for user action queries
- Index on `batch_action_id` for batch action queries
- Index on `status` where status='pending' (for processing)

### Table: `notification_batch_actions`
Groups multiple actions for batch processing (transactional).

**Key Fields:**
- `id` - UUID primary key
- `tenant_id` - Foreign key to tenants
- `user_id` - Foreign key to users (who took action)
- `action_type` - String (e.g., 'approve_all', 'reject_all')
- `notification_ids` - UUID array (notifications affected)
- `action_data` - JSONB (additional action context)
- `status` - Enum: 'pending', 'processing', 'completed', 'failed'
- `processed_at` - Timestamp
- `error_message` - Text (if failed)
- `created_at` - TIMESTAMPTZ NOT NULL DEFAULT NOW()
- `updated_at` - TIMESTAMPTZ NOT NULL DEFAULT NOW()

**Indexes:**
- Index on `user_id` for user batch action queries
- Index on `status` where status='pending' (for processing)

### Table: `user_channel_addresses`
Stores user-specific channel addresses (Slack ID, phone number, device tokens, etc.).

**Key Fields:**
- `id` - UUID primary key
- `tenant_id` - Foreign key to tenants
- `user_id` - Foreign key to users
- `channel` - VARCHAR(50) NOT NULL ('slack', 'sms', 'mobile_push', 'gchat')
- `address` - VARCHAR(255) NOT NULL (Slack user ID, phone number, device token, etc.)
- `is_verified` - BOOLEAN DEFAULT false
- `verified_at` - TIMESTAMPTZ (when address was verified)
- `bounce_count` - INTEGER DEFAULT 0 (hard bounces for email)
- `complaint_count` - INTEGER DEFAULT 0 (spam complaints)
- `is_disabled` - BOOLEAN DEFAULT false (disabled due to bounces/complaints)
- `metadata` - JSONB (channel-specific metadata, e.g., device type for push)
- `created_at` - TIMESTAMPTZ NOT NULL DEFAULT NOW()
- `updated_at` - TIMESTAMPTZ NOT NULL DEFAULT NOW()

**Indexes:**
- Unique constraint on `(tenant_id, user_id, channel)`
- Index on `user_id` for user address queries
- Index on `(channel, is_disabled)` for delivery queries
- Index on `is_verified` where is_verified=true

**Note:** Email addresses are stored in `users.email` table, not here. This table is for channels requiring additional addresses (Slack, SMS, push).

### Table: `notification_audit_log`
Audit trail for notification lifecycle events and configuration changes.

**Key Fields:**
- `id` - UUID primary key
- `tenant_id` - Foreign key to tenants
- `event_type` - VARCHAR(50) NOT NULL ('notification_created', 'notification_sent', 'notification_failed', 'preference_updated', 'channel_address_updated', etc.)
- `entity_type` - VARCHAR(50) NOT NULL ('notification', 'preference', 'channel_address', etc.)
- `entity_id` - UUID (ID of the entity)
- `user_id` - UUID (user who triggered the event, nullable)
- `changes` - JSONB (before/after values for updates)
- `metadata` - JSONB (additional context)
- `created_at` - TIMESTAMPTZ NOT NULL DEFAULT NOW()

**Indexes:**
- Index on `tenant_id` for tenant queries
- Index on `entity_type, entity_id` for entity queries
- Index on `user_id` for user queries
- Index on `created_at` for time-based queries
- Index on `event_type` for event type queries

### Table: `notification_bounce_complaints`
Tracks email bounces and spam complaints from providers.

**Key Fields:**
- `id` - UUID primary key
- `tenant_id` - Foreign key to tenants
- `user_id` - Foreign key to users
- `channel_address_id` - Foreign key to user_channel_addresses (nullable)
- `email_address` - VARCHAR(255) (email that bounced/complained)
- `event_type` - VARCHAR(50) NOT NULL ('hard_bounce', 'soft_bounce', 'complaint', 'unsubscribe')
- `provider` - VARCHAR(50) (e.g., 'resend', 'sendgrid')
- `provider_event_id` - VARCHAR(255) (provider's event ID for idempotency)
- `reason` - TEXT (bounce/complaint reason)
- `metadata` - JSONB (provider-specific data)
- `processed` - BOOLEAN DEFAULT false
- `processed_at` - TIMESTAMPTZ
- `created_at` - TIMESTAMPTZ NOT NULL DEFAULT NOW()

**Indexes:**
- Unique constraint on `(provider, provider_event_id)` for idempotency
- Index on `user_id` for user queries
- Index on `email_address` for email queries
- Index on `processed` where processed=false (for processing)
- Index on `event_type` for event type queries

---

## Pluggable Interfaces

### Template Provider Interface

**Purpose:** Abstract template storage and loading from filesystem, database, or remote service.

**Interface:**
```typescript
interface TemplateProvider {
  /**
   * Get template for notification type and channel
   * @param typeId - Notification type ID or name
   * @param channel - Channel name (e.g., 'email', 'slack')
   * @param locale - Optional locale (e.g., 'en-US', 'es-ES')
   * @returns Template object or null if not found
   */
  getTemplate(
    typeId: string,
    channel: string,
    locale?: string
  ): Promise<Template | null>;

  /**
   * Render template with data
   * @param template - Template object
   * @param data - Template variables/metadata
   * @param options - Rendering options (locale, data access checker, etc.)
   * @returns Render result with content and status
   */
  renderTemplate(
    template: Template,
    data: Record<string, unknown>,
    options?: RenderOptions
  ): Promise<TemplateRenderResult>;

  /**
   * Get fallback template for channel
   * Used when primary template is missing
   */
  getFallbackTemplate(channel: string): Promise<Template | null>;

  /**
   * Validate template exists
   */
  templateExists(typeId: string, channel: string): Promise<boolean>;
}

interface TemplateRenderResult {
  /**
   * Whether content was successfully generated
   * false if user doesn't have data access or content is empty
   */
  hasContent: boolean;
  
  /**
   * Rendered content (only if hasContent = true)
   */
  content?: RenderedContent;
  
  /**
   * Reason why content wasn't generated (if hasContent = false)
   */
  reason?: 'no_data_access' | 'empty_content' | 'template_error' | 'missing_data';
  
  /**
   * Error details (if template_error)
   */
  error?: string;
}

interface Template {
  id: string;
  typeId: string;
  channel: string;
  locale?: string;
  content: string | React.ComponentType; // Template content
  version: number;
  variables: string[]; // Required variables
}

interface RenderedContent {
  html?: string; // For email
  text?: string; // Plain text version
  blocks?: unknown[]; // For Slack block kit
  subject?: string; // Email subject
  title?: string; // Push notification title
}

interface RenderOptions {
  locale?: string;
  dataLoader?: (key: string) => Promise<unknown>; // Optional API query function
  dataAccessChecker?: (dataContext: NotificationDataContext) => Promise<boolean>; // Check data access at render time
  userId?: string; // User ID for data access checks
  tenantId?: string; // Tenant ID for data access checks
}
```

**Implementations:**

**1. Filesystem Template Provider:**
```typescript
class FilesystemTemplateProvider implements TemplateProvider {
  constructor(private basePath: string) {}

  async getTemplate(typeId: string, channel: string, locale?: string) {
    // Load from filesystem: ${basePath}/${typeId}/${channel}/${locale || 'default'}.tsx
    const path = this.resolvePath(typeId, channel, locale);
    return this.loadFromFilesystem(path);
  }
  
  // ... implementation
}
```

**2. Database Template Provider:**
```typescript
class DatabaseTemplateProvider implements TemplateProvider {
  constructor(private db: Database) {}

  async getTemplate(typeId: string, channel: string, locale?: string) {
    // Query templates table
    return this.db.query.templates.findFirst({
      where: and(
        eq(templates.typeId, typeId),
        eq(templates.channel, channel),
        locale ? eq(templates.locale, locale) : sql`locale IS NULL`
      ),
      orderBy: desc(templates.version)
    });
  }
  
  // ... implementation
}
```

**3. Remote Template Provider:**
```typescript
class RemoteTemplateProvider implements TemplateProvider {
  constructor(private apiUrl: string, private apiKey: string) {}

  async getTemplate(typeId: string, channel: string, locale?: string) {
    // Fetch from remote API
    const response = await fetch(
      `${this.apiUrl}/templates/${typeId}/${channel}?locale=${locale}`,
      { headers: { Authorization: `Bearer ${this.apiKey}` } }
    );
    return response.json();
  }
  
  // ... implementation
}
```

**Configuration:**
- Template provider registered in DI container
- Configurable per tenant or globally
- Default: FilesystemTemplateProvider

### User Resolver Interface

**Purpose:** Abstract user/tenant data access, decoupling from specific user model.

**Interface:**
```typescript
interface UserResolver {
  /**
   * Get user by ID
   * @param userId - User ID
   * @param tenantId - Tenant ID (for multi-tenancy)
   * @returns User object or null if not found
   */
  getUser(userId: string, tenantId: string): Promise<NotificationUser | null>;

  /**
   * Get user's channel address (email, Slack ID, phone, etc.)
   * @param userId - User ID
   * @param channel - Channel name
   * @returns Channel address or null if not configured
   */
  getUserChannelAddress(
    userId: string,
    channel: string
  ): Promise<ChannelAddress | null>;

  /**
   * Get user's notification preferences for a type
   * @param userId - User ID
   * @param typeId - Notification type ID
   * @returns Preferences or null if using defaults
   */
  getUserPreferences(
    userId: string,
    typeId: string
  ): Promise<UserNotificationPreferences | null>;

  /**
   * Get all users subscribed to a notification type
   * @param tenantId - Tenant ID
   * @param typeId - Notification type ID
   * @returns Array of user IDs
   */
  getSubscribers(tenantId: string, typeId: string): Promise<string[]>;

  /**
   * Get user's timezone
   * @param userId - User ID
   * @returns IANA timezone string (e.g., 'America/New_York')
   */
  getUserTimezone(userId: string): Promise<string | null>;

  /**
   * Get user's locale
   * @param userId - User ID
   * @returns Locale string (e.g., 'en-US')
   */
  getUserLocale(userId: string): Promise<string | null>;

  /**
   * Check if user exists and is active
   */
  userExists(userId: string, tenantId: string): Promise<boolean>;

  /**
   * Check if tenant is active
   */
  tenantActive(tenantId: string): Promise<boolean>;
}

interface NotificationUser {
  id: string;
  tenantId: string;
  email?: string; // Primary email (for email channel)
  name?: string; // Display name
  firstName?: string;
  lastName?: string;
  timezone?: string; // IANA timezone
  locale?: string; // Locale code
  isActive: boolean; // User is active (not deleted/suspended)
}

interface ChannelAddress {
  channel: string;
  address: string; // Email, Slack ID, phone number, device token
  isVerified: boolean;
  isDisabled: boolean; // Disabled due to bounces/complaints
  metadata?: Record<string, unknown>; // Channel-specific metadata
}

interface UserNotificationPreferences {
  enabled: boolean;
  channels: string[];
  frequency: 'immediate' | 'batched';
  batchInterval?: BatchInterval;
  quietHours?: QuietHours;
  timezone?: string; // Override user timezone
}
```

**Implementations:**

**1. Database User Resolver (CRM-specific):**
```typescript
class DatabaseUserResolver implements UserResolver {
  constructor(private db: Database) {}

  async getUser(userId: string, tenantId: string) {
    const user = await this.db.query.users.findFirst({
      where: and(
        eq(users.id, userId),
        eq(users.tenantId, tenantId),
        eq(users.rowStatus, 0) // Active
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
      timezone: user.timezone, // If stored on users table
      locale: user.locale, // If stored on users table
      isActive: user.rowStatus === 0,
    };
  }

  async getUserChannelAddress(userId: string, channel: string) {
    if (channel === 'email') {
      // Email from users table
      const user = await this.db.query.users.findFirst({
        where: eq(users.id, userId),
        columns: { email: true }
      });
      return user ? {
        channel: 'email',
        address: user.email,
        isVerified: true,
        isDisabled: false,
      } : null;
    }
    
    // Other channels from user_channel_addresses table
    const address = await this.db.query.userChannelAddresses.findFirst({
      where: and(
        eq(userChannelAddresses.userId, userId),
        eq(userChannelAddresses.channel, channel)
      )
    });
    
    return address ? {
      channel: address.channel,
      address: address.address,
      isVerified: address.isVerified,
      isDisabled: address.isDisabled,
      metadata: address.metadata,
    } : null;
  }

  async getSubscribers(tenantId: string, typeId: string) {
    // Query users with preferences enabled or using defaults
    const subscribers = await this.db.execute(sql`
      SELECT DISTINCT u.id
      FROM users u
      LEFT JOIN user_notification_preferences unp 
        ON u.id = unp.user_id AND unp.notification_type_id = ${typeId}
      WHERE u.tenant_id = ${tenantId}
        AND u.row_status = 0
        AND (unp.enabled = true OR (unp.enabled IS NULL AND 
          (SELECT default_enabled FROM notification_types WHERE id = ${typeId}) = true))
    `);
    
    return subscribers.map(row => row.id);
  }
  
  // ... other methods
}
```

**2. API User Resolver (Microservices):**
```typescript
class ApiUserResolver implements UserResolver {
  constructor(private apiClient: ApiClient) {}

  async getUser(userId: string, tenantId: string) {
    const response = await this.apiClient.get(`/users/${userId}`, {
      headers: { 'X-Tenant-Id': tenantId }
    });
    return this.mapToNotificationUser(response.data);
  }

  async getUserChannelAddress(userId: string, channel: string) {
    const response = await this.apiClient.get(
      `/users/${userId}/channels/${channel}`
    );
    return response.data ? this.mapToChannelAddress(response.data) : null;
  }
  
  // ... other methods
}
```

**3. GraphQL User Resolver:**
```typescript
class GraphQLUserResolver implements UserResolver {
  constructor(private client: GraphQLClient) {}

  async getUser(userId: string, tenantId: string) {
    const query = gql`
      query GetUser($id: ID!, $tenantId: ID!) {
        user(id: $id, tenantId: $tenantId) {
          id
          email
          name
          timezone
          locale
          isActive
        }
      }
    `;
    
    const result = await this.client.request(query, { id: userId, tenantId });
    return this.mapToNotificationUser(result.user);
  }
  
  // ... other methods
}
```

**Configuration:**
- User resolver registered in DI container
- Can be different per tenant (multi-tenant with different user models)
- Default: DatabaseUserResolver (for CRM)

### Channel Address Resolver Interface (Optional)

**Purpose:** Separate channel address resolution if needed.

**Interface:**
```typescript
interface ChannelAddressResolver {
  getAddress(userId: string, channel: string): Promise<ChannelAddress | null>;
  getAllAddresses(userId: string): Promise<ChannelAddress[]>;
  validateAddress(channel: string, address: string): Promise<boolean>;
}
```

**Note:** Can be part of UserResolver or separate interface depending on needs.

### Integration with Existing Design

**Service Layer Updates:**
- `NotificationService` uses `UserResolver` instead of direct DB queries
- `TemplateService` uses `TemplateProvider` instead of filesystem paths
- Channel adapters use `UserResolver` for address lookup

**Example:**
```typescript
@injectable()
export class NotificationService {
  constructor(
    @inject('UserResolver') private userResolver: UserResolver,
    @inject('TemplateProvider') private templateProvider: TemplateProvider,
    @inject(NotificationRepository) private notificationRepo: NotificationRepository
  ) {}

  async sendNotification(input: SendNotificationInput) {
    // Use UserResolver instead of direct DB query
    const subscribers = await this.userResolver.getSubscribers(
      input.tenantId,
      input.typeId
    );
    
    for (const userId of subscribers) {
      // Use UserResolver for user data
      const user = await this.userResolver.getUser(userId, input.tenantId);
      if (!user || !user.isActive) continue;
      
      // Use TemplateProvider for templates
      const template = await this.templateProvider.getTemplate(
        input.typeId,
        'email',
        user.locale
      );
      
      // ... rest of logic
    }
  }
}
```

**Dependency Injection Setup:**
```typescript
// In application setup
container.register<TemplateProvider>('TemplateProvider', {
  useClass: FilesystemTemplateProvider, // or DatabaseTemplateProvider, RemoteTemplateProvider
  useValue: new FilesystemTemplateProvider('./templates')
});

container.register<UserResolver>('UserResolver', {
  useClass: DatabaseUserResolver, // or ApiUserResolver, GraphQLUserResolver
});
```

---

## System Architecture

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Business Logic Layer                     │
│  (Email Analysis, Approvals, Escalations, etc.)            │
└────────────────────┬────────────────────────────────────────┘
                     │
                     │ Triggers notification
                     ▼
┌─────────────────────────────────────────────────────────────┐
│              Notification Service (API)                      │
│  • Fan-out to subscribers                                    │
│  • Preference resolution                                     │
│  • Batch scheduling                                          │
└────────────────────┬────────────────────────────────────────┘
                     │
                     │ Emits events
                     ▼
┌─────────────────────────────────────────────────────────────┐
│                    Inngest (Event Queue)                    │
│  • Fan-out processing                                        │
│  • Immediate delivery                                        │
│  • Batch processing (cron)                                   │
│  • Action processing                                         │
└────────────────────┬────────────────────────────────────────┘
                     │
                     │ Processes events
                     ▼
┌─────────────────────────────────────────────────────────────┐
│              Channel Adapters (Pluggable)                   │
│  • Email Adapter (react-email)                              │
│  • Slack Adapter                                            │
│  • Google Chat Adapter                                      │
│  • SMS Adapter                                              │
│  • Mobile Push Adapter                                      │
└────────────────────┬────────────────────────────────────────┘
                     │
                     │ Delivers via
                     ▼
┌─────────────────────────────────────────────────────────────┐
│              External Services                              │
│  • SMTP / Transactional Email                               │
│  • Slack API                                                │
│  • Google Chat API                                          │
│  • Twilio (SMS)                                             │
│  • FCM / APNS (Mobile Push)                                │
└─────────────────────────────────────────────────────────────┘
```

### Module Structure

**Location:** `packages/notifications/` (pluggable package for reuse across applications)

**Note:** The notification module is designed as a reusable package that can be integrated into any application (`apps/api`, `apps/web`, etc.). The package contains all core logic, and applications integrate it via dependency injection.

**Components:**
1. **Core Services**
   - `NotificationService` - Main service for creating/sending notifications
   - `NotificationPreferencesService` - Manages user preferences
   - `NotificationTypeService` - Manages notification type definitions
   - `ChannelAddressService` - Manages user channel addresses

2. **Pluggable Interfaces** (`interfaces/`)
   - `TemplateProvider` - Abstract template storage/loading
   - `UserResolver` - Abstract user/tenant data access
   - `ChannelAddressResolver` - Abstract channel address lookup (optional)

3. **Repositories**
   - `NotificationRepository` - CRUD for notifications table
   - `NotificationPreferencesRepository` - CRUD for preferences
   - `NotificationBatchRepository` - CRUD for batches
   - `NotificationActionRepository` - CRUD for actions
   - `ChannelAddressRepository` - CRUD for channel addresses
   - `NotificationAuditLogRepository` - Audit log entries
   - `BounceComplaintRepository` - Bounce/complaint tracking

4. **Channel Adapters** (`channels/`)
   - `BaseChannel` - Abstract base class defining channel interface
   - `EmailChannel` - Email delivery via react-email
   - `SlackChannel` - Slack webhook/API delivery
   - `GoogleChatChannel` - Google Chat webhook/API delivery
   - `SMSChannel` - SMS delivery (Twilio)
   - `MobilePushChannel` - Mobile push (FCM/APNS)

5. **Templating** (`templates/`)
   - Template provider interface (pluggable)
   - Template registry (uses template provider)
   - Template implementations:
     - FilesystemTemplateProvider (default)
     - DatabaseTemplateProvider
     - RemoteTemplateProvider
   - React-email templates (email channel)
   - Slack block kit templates (Slack channel)
   - Plain text templates (SMS channel)
   - Template preview service

6. **Batching** (`batching/`)
   - `BatchManager` - Creates and schedules batches
   - `BatchProcessor` - Processes scheduled batches (cron)
   - `BatchAggregator` - Aggregates notifications into digest format

7. **Actions** (`actions/`)
   - `ActionProcessor` - Processes individual actions
   - `BatchActionProcessor` - Processes batch actions (transactional)
   - Action handlers (type-specific logic)

8. **Inngest Functions** (`inngest/`)
   - `fanOutNotification` - Fan-out to all subscribers
   - `sendImmediateNotification` - Send immediate notifications
   - `processBatch` - Process scheduled batches (cron)
   - `processAction` - Process notification actions
   - `processBounceComplaint` - Process bounce/complaint webhooks
   - `expireNotifications` - Mark expired notifications (cron)

9. **API Routes** (`routes.ts`, `preferences-routes.ts`)
   - REST endpoints for notifications and preferences
   - Action endpoints (individual and batch)
   - Template preview endpoint
   - Webhook endpoints (bounce/complaint callbacks)
   - Channel address management endpoints
   - Subscription management endpoints (UI-driven)
   - Refresh endpoints (role/permission-based auto-subscription)

10. **Subscription Management** (`subscriptions/`)
   - `SubscriptionService` - Manages user subscriptions
   - `SubscriptionRuleEngine` - Role/permission-based subscription rules
   - `AutoSubscriptionService` - Auto-subscribe users to new types
   - Subscription refresh logic

---

## Notification Flow

### Flow 1: Notification Creation (Fan-Out)

**Trigger:** Business logic needs to send notification (e.g., escalation detected)

**Steps:**
1. Business logic calls `NotificationService.send()` with:
   - Notification type name
   - Full data payload (all template variables)
   - Optional: `idempotencyKey` (prevents duplicate fan-outs on retries)
   - Optional: `eventKey` (for deduplication)
   - Optional: `priority` ('critical', 'high', 'normal', 'low')
   - Optional: `expiresAt` (timestamp when notification expires)
   - Optional: `userIds` (specific users, otherwise fans out to all subscribers)
   - Optional: `locale` (inherits from user if not provided)
2. Service validates notification type exists
3. Service determines target users:
   - If `userIds` provided → use those users
   - Otherwise → use `UserResolver.getSubscribers(tenantId, typeId)` to get all subscribers
4. Service emits Inngest event: `notification/send` with fan-out data
5. Inngest function `fanOutNotification` processes event:
   - **Edge Case: Tenant Suspended** - Use `UserResolver.tenantActive()` to check, skip if suspended
   - For each target user:
     - **Edge Case: User Deleted** - Use `UserResolver.userExists()` to verify, skip if deleted
     - Use `UserResolver.getUserPreferences(userId, typeId)` to load preferences (or use defaults)
     - Skip if user disabled this notification type
     - **Permission Check** - Verify user has `required_permission` (skip if no permission)
     - **Handle idempotency** (if `idempotencyKey` provided):
       - Check for existing notification with same `idempotency_key`
       - If exists → skip fan-out (prevent duplicate notifications)
     - **Handle event deduplication** (if `eventKey` provided):
       - Calculate `event_key` hash from metadata (per type config)
       - Check for existing pending notification with same `event_key`
       - Apply deduplication strategy:
         - **overwrite** → Update existing notification metadata, reset `scheduled_for`
         - **create_new** → Create new notification
         - **ignore** → Skip if duplicate exists
     - **Handle priority:**
       - **critical** → Bypass all batching, send immediately, aggressive retries
       - **high** → Send within 5 minutes (override user preferences)
       - **normal** → Follow user preferences
       - **low** → Always batch (even if user prefers immediate)
     - **Create notification record** - Store notification with metadata (data access checked later at send time)
     - Determine delivery strategy (immediate vs batched)
     - Calculate `scheduled_for` timestamp (unified for all modes)
     - **Edge Case: Clock Skew** - Validate `scheduled_for` not in past, adjust if needed
     - If immediate → emit `notification/send.immediate` events per channel
     - If batched → create/update batch record, set `scheduled_for`
     
**Note:** Data access is NOT checked at notification creation time because:
- Notifications are batched and sent later
- Data access may change between creation and send
- Content generation happens at send time (when batch is processed)
- Template rendering will check data access and return `hasContent: false` if no access

**Key Design Decisions:**
- Fan-out happens asynchronously (non-blocking)
- Preferences loaded per-user (supports caching)
- Batch creation is idempotent (same batch reused if multiple notifications)
- Event deduplication configurable per notification type
- Full data payload provided by caller (templates can optionally query APIs)
- **Content generation at send time** - Templates rendered when batch is processed (not at creation)
- **Data access checked during template rendering** - Template provider checks access via `dataAccessChecker`
- **Template provider returns render result** - `hasContent` flag indicates if content was generated
- **Channel adapter sends content** - Caller (channel adapter) is responsible for sending, not template provider
- **Skip if no content** - If `hasContent = false`, mark notification as 'skipped', don't send
- **Data access validated before notification creation** - No notification created if user can't access data
- **Permission checked before notification creation** - No notification created if user doesn't have permission
- **Silent skip** - Users don't see notifications they can't access (no error, no notification record)

### Flow 2: Immediate Delivery

**Trigger:** Inngest event `notification/send.immediate`

**Steps:**
1. Inngest function `sendImmediateNotification` receives event
2. Load notification record from database
3. Get channel adapter for specified channel
4. **Render template:**
   - Load template configuration from `notification_types.template_config`
   - Use `TemplateProvider.getTemplate(typeId, channel, locale)` to get template
   - **Edge Case: Template Missing** - Use `TemplateProvider.getFallbackTemplate(channel)` if missing
   - **Edge Case: Template Rendering Failure** - Try-catch, use fallback template
   - Use `TemplateProvider.renderTemplate(template, metadata, options)` to render
   - **If data loader enabled:** Provide `dataLoader` function in render options
   - **If template queries APIs:** Fetch additional data via `dataLoader`
5. Get user's channel address using `UserResolver.getUserChannelAddress(userId, channel)`
6. **Add tracking:**
   - Email: Embed tracking pixel, wrap links with tracking URLs
   - Slack/GChat: Add tracking parameters to buttons/links
   - Mobile: Add deep link tracking
7. Send via channel adapter
8. Update notification status to 'sent'
9. Record delivery attempt in `delivery_attempts` JSONB field

**Error Handling:**
- **Edge Case: User Deleted** - Verify user exists before sending
- **Edge Case: Tenant Suspended** - Verify tenant active before sending
- **Edge Case: Notification Expired** - Skip if expired
- **Edge Case: Channel Disabled** - Skip if channel disabled
- **Edge Case: Invalid Channel Address** - Validate before sending
- **Edge Case: Template Missing** - Use fallback template
- **Edge Case: Template Rendering Failure** - Try-catch, use fallback
- **Edge Case: Very Long Email** - Truncate if exceeds limits
- **Edge Case: Unicode in SMS** - Handle encoding correctly
- **Edge Case: Channel Credentials Expired** - Refresh token
- **Edge Case: Provider Outage** - Retry with exponential backoff, circuit breaker, dead letter queue
- Retry on transient failures (Inngest handles retries)
- Mark as 'failed' after max retries
- Log errors for debugging

### Flow 3: Batched Delivery (Unified)

**Trigger:** Single cron job (every 15 minutes or configurable)

**Steps:**
1. Inngest cron function `processBatch` runs periodically
2. Query `notification_batches` table for batches where:
   - `status = 'pending'`
   - `scheduled_for <= NOW()` (unified - includes immediate, minutes, hours, end-of-day)
3. For each batch:
   - **Edge Case: User Deleted** - Use `UserResolver.userExists()` to verify, cancel batch if deleted
   - **Edge Case: Tenant Suspended** - Use `UserResolver.tenantActive()` to verify, cancel batch if suspended
   - **Edge Case: User Opts Out** - Use `UserResolver.getUserPreferences()` to check preference still enabled, cancel if disabled
   - Load all notifications in batch
   - **Filter expired notifications:**
     - Skip notifications where `expires_at < NOW()`
     - Mark expired notifications as 'expired' status
   - **Generate content for each notification:**
     - For each notification, call `TemplateProvider.renderTemplate()` with:
       - Template, metadata, userId, tenantId, dataAccessChecker
     - Check `TemplateRenderResult.hasContent`
     - If `hasContent = false` → mark notification as 'skipped', exclude from batch
     - If `hasContent = true` → include in batch aggregation
   - **Edge Case: Empty Batch** - If all notifications expired or have no content, mark batch as 'cancelled'
   - **Edge Case: Batch Aggregation Failure** - Try-catch, use simple list if fails
   - Aggregate notifications with content into digest format (via `BatchAggregator`)
   - Get channel adapter for batch channel
   - **Edge Case: Channel Disabled** - Check channel not disabled, handle partial failure
   - Render aggregated template using `TemplateProvider.renderTemplate()` for batch template
   - **Check aggregated render result:**
     - If `hasContent = false` → cancel batch, mark all notifications as 'skipped'
     - If `hasContent = true` → continue with sending
   - Get user's channel address using `UserResolver.getUserChannelAddress(userId, channel)`
   - **Check channel address status:**
     - Skip if address is disabled (bounces/complaints)
     - Skip if address not verified (for channels requiring verification)
   - **Edge Case: Invalid Channel Address** - Validate address, skip if invalid
   - **Edge Case: Very Long Email** - Validate length, truncate if needed
   - Add tracking (same as immediate delivery)
   - **Edge Case: Channel Credentials Expired** - Refresh token before sending
   - **Send aggregated notification via channel adapter** (caller sends, not template provider)
   - **Edge Case: Provider Outage** - Handle retries, partial success
   - Update batch status to 'sent' (or 'partially_sent' if some channels failed, or 'cancelled' if no content)
   - Update notification statuses:
     - 'sent' for notifications with content that were sent
     - 'skipped' for notifications without content
     - 'failed' for notifications that failed to send

**Key Design:**
- **Unified processing** - Single cron handles all batch modes (no special logic for end-of-day)
- **End-of-day** is just a `scheduled_for` timestamp calculated to be end-of-day in user's timezone (converted to UTC)
- **Consistent behavior** - All batching modes use same processing logic
- **Expiry handling** - Expired notifications skipped and marked as expired

**Edge Case Handling:**
- **User Deleted** - Verify user exists, cancel batch if deleted
- **Tenant Suspended** - Verify tenant active, cancel batch if suspended
- **User Opts Out** - Check preference still enabled, cancel if disabled
- **Empty Batch** - Mark as cancelled if all notifications expired or have no content
- **No Content** - Generate content for each notification, skip if `hasContent = false`
- **Channel Disabled** - Handle partial success (some channels fail)
- **Batch Aggregation Failure** - Use simple list aggregation as fallback
- **Invalid Channel Address** - Validate before sending
- **Very Long Email** - Truncate if exceeds limits
- **Channel Credentials Expired** - Refresh token before sending
- **Provider Outage** - Retry with exponential backoff, handle partial success

**Key Design:**
- **Content generation at send time** - Templates rendered when batch is processed
- **Template provider generates content** - Returns `TemplateRenderResult` with `hasContent` flag
- **Channel adapter sends content** - Caller (channel adapter) is responsible for sending
- **Filter notifications without content** - Only aggregate notifications with `hasContent = true`

**Batch Aggregation:**
- Groups notifications by type
- Creates digest title (e.g., "3 Escalation Alerts")
- Lists individual items with summaries
- Includes action items if applicable

### Flow 4: Expiry Processing

**Trigger:** Cron job (every hour)

**Steps:**
1. Inngest cron function `expireNotifications` runs
2. Query `notifications` table for notifications where:
   - `status IN ('pending', 'batched')`
   - `expires_at < NOW()`
3. For each expired notification:
   - Update status to 'expired'
   - Remove from batch (if batched)
   - Log audit event

### Unified Batch Processing

**Trigger:** Single cron job (every 15 minutes or configurable interval)

**Steps:**
1. Inngest cron function `processBatch` runs periodically
2. Query `notification_batches` table for batches where:
   - `status = 'pending'`
   - `scheduled_for <= NOW()` (includes end-of-day, minutes, hours - all use same field)
3. For each batch:
   - Load all notifications in batch
   - Aggregate notifications into digest format
   - Get channel adapter for batch channel
   - Render aggregated template
   - Get user's channel address
   - Send aggregated notification
   - Update batch status to 'sent'
   - Update all notification statuses to 'sent'

**Key Design:**
- **No special logic for end-of-day** - It's just a `scheduled_for` timestamp calculated to be end-of-day in user's timezone (converted to UTC)
- **Single cron job** processes all batches (immediate, minutes, hours, end-of-day)
- **Timezone handling** - End-of-day calculation converts user's local end-of-day to UTC `scheduled_for` timestamp
- **Consistent mechanism** - All batching modes use same `scheduled_for` field and processing logic

---

## Batching Strategy

### Batch Interval Types

**1. Immediate**
- `scheduled_for = NOW()` (or current timestamp)
- No batching, send immediately
- Used for critical alerts (escalations, security)

**2. Scheduled (Unified Mechanism)**
All scheduled batches use the same `scheduled_for` (releaseAt) field:

- **Minutes:** `scheduled_for = NOW() + N minutes` (rounded to next interval boundary)
- **Hours:** `scheduled_for = NOW() + N hours` (rounded to next interval boundary)
- **End of Day:** `scheduled_for = end_of_day_in_user_timezone` (converted to UTC)
- **Custom Time:** `scheduled_for = provided_timestamp` (UTC)

**Key Design Principle:**
- **All batching modes use the same `scheduled_for` field** - No special logic needed
- **Single cron job** processes all batches where `scheduled_for <= NOW()`
- **End-of-day is just a calculated timestamp** - No separate processing logic

### Batch Creation Logic

**When Notification Created:**
1. Check user preference for batch interval
2. Calculate `scheduled_for` timestamp:
   - **Immediate:** `NOW()`
   - **Minutes:** `NOW() + N minutes` (rounded to interval)
   - **Hours:** `NOW() + N hours` (rounded to interval)
   - **End of Day:** Calculate end of day in user's timezone → convert to UTC
3. Find existing batch or create new:
   - Query for existing batch where:
     - `user_id` matches
     - `notification_type_id` matches
     - `channel` matches
     - `status = 'pending'`
     - `scheduled_for` matches (same batch window - configurable tolerance)
   - If found → add notification to existing batch
   - If not found → create new batch with calculated `scheduled_for`

**Scheduled Time Calculation (Unified):**
- All modes calculate a UTC `scheduled_for` timestamp
- End-of-day: `calculateEndOfDay(userTimezone) → convertToUTC()`
- Minutes/Hours: `NOW() + interval → roundToBoundary()`
- Single processing logic handles all modes

**Example:**
- User preference: 15-minute batches
- Notification created at 10:07 UTC
- `scheduled_for` calculated: 10:15 UTC (next 15-minute boundary)
- Next notification at 10:12 UTC → same batch (`scheduled_for = 10:15`)
- Next notification at 10:16 UTC → new batch (`scheduled_for = 10:30`)

**End-of-Day Example:**
- User in timezone: America/New_York (UTC-5)
- Notification created: 2024-01-15 14:00 UTC (9:00 AM EST)
- End of day in EST: 2024-01-15 23:59:59 EST
- `scheduled_for` calculated: 2024-01-16 04:59:59 UTC (converted from EST)
- Single cron job processes this at 04:59:59 UTC (no special logic needed)

### Batch Aggregation

**Aggregation Strategies:**
1. **Count** - "You have 5 new notifications"
2. **List** - List all notifications with summaries
3. **Digest** - Grouped by type with counts and summaries

**Aggregated Content Structure:**
- Title: "Daily Digest" or "3 Escalation Alerts"
- Summary: Brief overview
- Items: Array of notification summaries
- Actions: Aggregated action items (if applicable)

**Template Rendering:**
- Aggregated content passed to template
- Template renders digest format (HTML email, Slack blocks, etc.)
- Channel-specific formatting

---

## Templating System

### Data Payload Strategy

**Two Approaches Supported:**

**1. Full Data Payload (Recommended)**
- Caller provides complete data needed for template rendering
- Template receives all variables in `metadata` field
- No additional API calls during rendering
- Faster rendering, simpler templates
- Example: `{ customerId: '...', customerName: 'Acme Corp', amount: 1000, status: 'pending' }`

**2. Template Queries APIs (Optional)**
- Caller provides minimal data (IDs, keys)
- Template can optionally query APIs to fetch additional data
- Template receives `dataLoader` function in context
- Useful for complex templates needing fresh data
- Example: `{ customerId: '...' }` → template calls `dataLoader.getCustomer(customerId)`

**Design Decision:**
- **Default:** Full data payload (caller provides all data)
- **Optional:** Template can query APIs if `dataLoader` provided in template context
- **Configuration:** Per notification type, can enable/disable API queries
- **Performance:** API queries add latency - prefer full payload when possible

### Template Architecture

**Template Storage:**
- Templates stored in codebase (version controlled) OR database (configurable)
- Database stores template configuration (type, channel, version, template path/ID)
- Template registry loads templates dynamically
- **External Configuration:** Template mappings stored in `notification_types` table

**Template Configuration (Externalized):**
- `notification_types.template_config` JSONB field stores:
  - Template path/ID per channel
  - Template version
  - Data loader configuration (if API queries enabled)
  - Variable mapping (metadata keys → template variables)
- Allows copying codebase and configuring templates without code changes
- Templates can be stored in:
  - Codebase (default) - `apps/api/src/notifications/templates/`
  - Database (optional) - Template content stored in `templates` table
  - External service (future) - Template registry API

**Template Types:**
1. **React-Email Templates** (Email channel)
   - React components that render to HTML
   - Rich formatting, images, buttons
   - Responsive design

2. **Slack Block Kit Templates** (Slack channel)
   - JSON structure for Slack message formatting
   - Buttons, sections, dividers
   - Interactive elements

3. **Plain Text Templates** (SMS channel)
   - Simple text with variable substitution
   - Character limit aware
   - URL shortening for links

4. **Mobile Push Templates** (Mobile channel)
   - Title, body, image
   - Deep link URLs
   - Action buttons

### Template Variables

**Variable Injection:**
- Templates receive notification `metadata` as variables
- Variables typed per notification type
- Missing variables handled gracefully (fallback values)
- **Optional:** Template can query APIs via `dataLoader` if configured
- **Localization:** Variables formatted per user locale (dates, numbers, currency)

**Common Variables:**
- User name, customer name
- Notification-specific data (amount, status, etc.)
- Action URLs (signed tokens)
- Timestamps (formatted per locale)
- Locale-aware formatting (date, time, currency, numbers)

### Template Localization (i18n)

**Locale Support:**
- User locale stored in `users.locale` or `notifications.locale`
- Templates support multiple locales:
  - Template path: `templates/escalation-alert/en-US.tsx`, `templates/escalation-alert/es-ES.tsx`
  - Or locale variants in same template file
- Locale-aware formatting:
  - Dates: `formatDate(date, locale)` → "January 15, 2024" (en-US) vs "15 de enero de 2024" (es-ES)
  - Numbers: `formatNumber(1000, locale)` → "1,000.00" (en-US) vs "1.000,00" (es-ES)
  - Currency: `formatCurrency(1000, 'USD', locale)` → "$1,000.00" (en-US) vs "1.000,00 $US" (es-ES)

**Template Selection:**
- Load template via `TemplateProvider.getTemplate(typeId, channel, locale)`
- Template provider handles fallback logic (locale → default locale)
- Template registry uses template provider (not direct filesystem access)

### Template Preview API

**Endpoint:** `POST /api/notifications/templates/:templateId/preview`

**Request:**
```json
{
  "metadata": { "customerName": "Acme Corp", "amount": 1000 },
  "locale": "en-US",
  "channel": "email"
}
```

**Response:**
```json
{
  "html": "<html>...</html>",
  "text": "Plain text version...",
  "slack_blocks": [...],
  "preview_url": "https://..."
}
```

**Use Cases:**
- Preview templates during development
- Test sends before production
- Template validation

### Template Versioning

**Version Management:**
- Templates have version numbers
- Default to latest version
- Allow pinning to specific version (A/B testing)
- Version history tracked in database

**A/B Testing:**
- Multiple template versions active simultaneously
- Random assignment or user-based assignment
- Track open rates, click rates per version
- Gradual rollout (percentage-based)

---

## Action System

### Action Types

**1. Approval Actions**
- Approve/reject items
- Batch approve/reject multiple items
- Used for approval workflows

**2. Dismiss Actions**
- Dismiss notification (mark as read)
- No business logic, just status update

**3. Custom Actions**
- Notification type-specific actions
- Defined per notification type
- Handler registered per action type

### Action Flow

**1. User Clicks Action**
- Action URL includes signed token (JWT)
- Token contains: notification ID, action type, expiration
- Token validated on action endpoint

**2. Action Endpoint**
- Validates token (signature, expiration)
- Validates user owns notification
- Creates `notification_actions` record (status: 'pending')
- Emits Inngest event: `notification/action.process`

**3. Action Processing**
- Inngest function `processAction` receives event
- Loads action and notification records
- Gets action handler for notification type
- Handler processes action (business logic)
- Updates action status to 'completed' or 'failed'

### Batch Actions

**Use Case:** User wants to approve/reject multiple items at once

**Flow:**
1. User selects multiple notifications
2. Clicks "Approve All" or "Reject All"
3. Frontend calls batch action endpoint
4. Endpoint creates `notification_batch_actions` record
5. Creates individual `notification_actions` records linked to batch
6. Processes in transaction (all succeed or all fail)
7. Updates all notifications atomically

**Transaction Guarantees:**
- All actions processed atomically
- If one fails, all roll back
- Status tracked per action and batch

### Action Handlers

**Handler Interface:**
- Each notification type can define action handlers
- Handlers registered in action processor
- Handler receives action data and notification metadata
- Handler returns success/failure

**Example Handlers:**
- `ApprovalHandler` - Updates approval status in approvals table
- `EscalationHandler` - Marks escalation as acknowledged
- `CustomHandler` - Generic handler for custom actions

---

## Fan-Out Pattern

### Efficient Fan-Out Design

**Challenge:** When notification created, need to send to all subscribed users (potentially hundreds/thousands)

**Solution:** Async fan-out via Inngest

**Steps:**
1. Business logic calls `NotificationService.send()` with notification data
2. Service emits single Inngest event: `notification/send`
3. Inngest function `fanOutNotification` processes:
   - Loads notification type definition
   - Queries all users subscribed to type (or uses provided userIds)
   - For each user:
     - Loads preferences (cached)
     - **Handles event deduplication** (if event_key provided):
       - Calculate `event_key` hash from metadata fields (per type config)
       - Check for existing pending notification with same `event_key`
       - Apply deduplication strategy (overwrite/create_new/ignore)
     - Creates or updates notification record
     - Determines delivery strategy
     - Schedules delivery (immediate or batch)
4. Parallel processing (Inngest handles concurrency)

**Event Deduplication:**
- If `event_key` provided → hash metadata fields (per type config)
- Check for existing pending notification (`status IN ('pending', 'batched')`)
- Apply strategy:
  - **overwrite** - Update existing notification metadata, reset `scheduled_for`
  - **create_new** - Create new notification (allow duplicates)
  - **ignore** - Skip if duplicate exists
- Configurable per notification type

**Optimizations:**
- Bulk insert notifications (single query)
- Batch Inngest events (multiple users per event)
- Preference caching (Redis, 5-minute TTL)
- Parallel processing (Inngest handles)

### Subscription Management

**Who Receives Notifications:**
1. **Explicit Subscribers** - Users who enabled notification type
2. **Default Subscribers** - Users who haven't configured preferences (use defaults)
3. **Explicit Opt-Out** - Users who disabled notification type (excluded)

**Subscription Query:**
- Use `UserResolver.getSubscribers(tenantId, typeId)` to get user IDs
- User resolver handles preference logic (enabled, defaults, opt-outs)
- **Channel Address Check:**
  - Use `UserResolver.getUserChannelAddress(userId, channel)` for each channel
  - Skip channels where address is null, disabled, or not verified
  - Email uses `UserResolver.getUser().email` (always available)

---

## Security & Privacy

### Tenant Isolation

**Database Level:**
- All tables include `tenant_id` column
- All queries filtered by `tenant_id`
- Foreign keys enforce tenant boundaries

**API Level:**
- `RequestHeader` middleware extracts `tenantId` from session
- Service methods receive `RequestHeader` parameter
- Repository methods filter by `tenantId`

**User Access:**
- Users can only see their own notifications
- Actions validated against user ownership
- Admin users see all notifications in tenant (future)
- Read/unread status tracked per user (`read_at` timestamp)

### Channel Credentials

**Storage:**
- Credentials stored in `integrations` table (same pattern as Gmail)
- Encrypted using existing encryption service
- Per-tenant credentials

**Retrieval:**
- Retrieved via `IntegrationService` (same pattern as Gmail)
- Cached for performance (5-minute TTL)
- Rotated via integrations UI

### Action Security

**Signed Tokens:**
- Action URLs include JWT tokens
- Token contains: notification ID, action type, user ID, expiration
- Token signed with secret key
- Validated on action endpoint

**Validation:**
- Token signature verified
- Token expiration checked
- User ID matches notification owner
- Action type matches notification type capabilities

**CSRF Protection:**
- Action endpoints require authentication
- Same-origin policy for web actions
- Token-based validation for email/SMS links

### Rate Limiting

**Per-Channel Limits:**
- Configurable per channel (e.g., email: 100/min, SMS: 10/min)
- Tracked per tenant
- Exponential backoff on rate limit errors

**Per-User Limits:**
- Prevent abuse (e.g., max 100 notifications/user/hour)
- Configurable per tenant
- Logged for monitoring

### Data Privacy

**User Preferences:**
- Private per user (tenant-scoped)
- Not exposed to other users
- Admin can view (future, with audit log)

**Notification Content:**
- Contains business data (customer names, amounts, etc.)
- Encrypted at rest (if required by compliance)
- PII scrubbed in logs

**Retention:**
- Notifications retained per tenant policy
- Soft delete (deleted_at timestamp)
- Archive old notifications (future)
- Expired notifications marked as 'expired' (not sent)
- Audit log retained separately (longer retention for compliance)

---

## Scalability Considerations

### Database Optimization

**Indexing Strategy:**
- Indexes on foreign keys (`user_id`, `notification_type_id`)
- Composite indexes for common queries (`status + scheduled_for`)
- Partial indexes for filtered queries (`enabled = true`)
- Indexes on JSONB fields (GIN indexes for metadata queries)

**Partitioning (Future):**
- Partition `notifications` table by `tenant_id` (if needed)
- Partition by `created_at` (time-based partitioning)
- Archive old partitions

**Query Optimization:**
- Bulk inserts for fan-out (single query)
- Batch queries for scheduled batches
- Efficient preference lookups (cached)

### Caching Strategy

**User Preferences:**
- Cache in Redis (5-minute TTL)
- Key: `notification:preferences:{userId}:{typeId}`
- Invalidate on preference update
- Fallback to database on cache miss

**Notification Types:**
- Cache in memory (application-level)
- Loaded at startup
- Reloaded on type update (webhook or polling)

**Templates:**
- Cache compiled templates in memory
- Reloaded on template update
- Version-aware caching

### Processing Scalability

**Inngest Concurrency:**
- Configurable concurrency per function
- Parallel processing of batches
- Rate limiting per channel

**Channel Adapters:**
- Stateless (horizontally scalable)
- Connection pooling for external APIs
- Circuit breakers for external service failures

**Batch Processing:**
- Process batches in parallel (per tenant)
- Configurable batch size
- Dead letter queue for failed batches

### Fan-Out Optimization

**Bulk Operations:**
- Bulk insert notifications (single query)
- Batch Inngest events (multiple users per event)
- Parallel preference lookups

**Efficient Queries:**
- Single query for all subscribers (with preferences)
- Bulk preference resolution
- Cached preference lookups

---

## Engagement Tracking

### Open Tracking

**Email Opens:**
- 1x1 transparent tracking pixel embedded in email HTML
- URL: `/api/notifications/:notificationId/track/open?token=:signedToken`
- Token contains notification ID, user ID, expiration
- On pixel load:
  - Validate token
  - Update `notifications.engagement.opened_at` (if first open)
  - Increment `notifications.engagement.opened_count`
  - Record event in `notification_engagement_events` (optional)

**Slack/Google Chat Opens:**
- Message opened event tracked via webhook (if supported)
- Or tracked when user clicks action button

**Mobile Push Opens:**
- App open event tracked via deep link
- App reports open to API

### Click Tracking

**Email Clicks:**
- All links in email wrapped with tracking URL
- Original URL encoded in tracking URL
- Tracking URL: `/api/notifications/:notificationId/track/click?url=:encodedUrl&token=:signedToken`
- On click:
  - Validate token
  - Update `notifications.engagement.clicked_at` (if first click)
  - Increment `notifications.engagement.clicked_count`
  - Add URL to `notifications.engagement.clicked_links` array
  - Record event in `notification_engagement_events` (optional)
  - Redirect to original URL

**Slack/Google Chat Clicks:**
- Button clicks tracked via webhook
- Link clicks tracked via tracking URLs (same as email)

**Mobile Push Clicks:**
- Deep link clicks tracked via app
- App reports click to API

### Engagement Analytics

**Metrics Tracked:**
- Open rate: `opened_count / sent_count`
- Click rate: `clicked_count / sent_count`
- Click-through rate: `clicked_count / opened_count`
- Time to open: `opened_at - sent_at`
- Time to click: `clicked_at - sent_at`

**Use Cases:**
- A/B testing templates (compare open/click rates)
- Optimize delivery timing (when are notifications opened?)
- Identify effective channels (which channels get most engagement?)
- Template optimization (which templates drive actions?)

**Table: `notification_engagement_events` (Optional)**
For detailed event-level tracking:

**Key Fields:**
- `id` - UUID primary key
- `notification_id` - Foreign key to notifications
- `event_type` - 'open' | 'click'
- `event_data` - JSONB (URL clicked, user agent, etc.)
- `occurred_at` - Timestamp
- `metadata` - JSONB (additional context)

**Indexes:**
- Index on `notification_id` for notification queries
- Index on `occurred_at` for time-based queries

---

## Subscription Management & UI Integration

### UI-Driven Subscription Management

**Purpose:** Provide APIs for UI to manage user subscriptions to notification types.

**Endpoints:**

**1. List Available Notification Types**
```
GET /api/notifications/types
```
Returns all active notification types user can subscribe to, with:
- Type ID, name, description, category
- Current subscription status (subscribed/unsubscribed)
- Default channels and frequency
- Whether user can subscribe (based on roles/permissions)

**2. List User Subscriptions**
```
GET /api/notifications/subscriptions
```
Returns user's current subscriptions with preferences:
- Notification type details
- Enabled/disabled status
- Channel preferences
- Frequency and batching settings
- Quiet hours

**3. Subscribe to Notification Type**
```
POST /api/notifications/subscriptions
Body: {
  notificationTypeId: string,
  channels?: string[], // Optional, uses defaults if not provided
  frequency?: 'immediate' | 'batched',
  batchInterval?: BatchInterval
}
```
Creates or updates user preference for notification type.

**4. Unsubscribe from Notification Type**
```
DELETE /api/notifications/subscriptions/:typeId
```
Disables user's subscription (sets `enabled = false`).

**5. Update Subscription Preferences**
```
PATCH /api/notifications/subscriptions/:typeId
Body: {
  enabled?: boolean,
  channels?: string[],
  frequency?: 'immediate' | 'batched',
  batchInterval?: BatchInterval,
  quietHours?: QuietHours
}
```
Updates user's preferences for a notification type.

**6. Bulk Update Subscriptions**
```
PUT /api/notifications/subscriptions/bulk
Body: {
  subscriptions: Array<{
    notificationTypeId: string,
    enabled: boolean,
    channels?: string[],
    frequency?: 'immediate' | 'batched'
  }>
}
```
Updates multiple subscriptions at once (for UI bulk operations).

**7. Get Subscription Statistics**
```
GET /api/notifications/subscriptions/stats
```
Returns:
- Total subscribed types
- Types by category
- Channels breakdown
- Frequency breakdown

### Auto-Subscription System

**Purpose:** Automatically subscribe users to new notification types based on roles/permissions.

**How It Works:**

**1. When New Notification Type Created:**
- If `auto_subscribe_enabled = true` → trigger auto-subscription
- Query all users matching `subscription_rules`:
  - Users with specified roles
  - Users with required permissions
  - Users matching additional conditions
- Create `user_notification_preferences` records:
  - `enabled = true`
  - `subscription_source = 'auto'`
  - `auto_subscribed_at = NOW()`
  - Use notification type defaults for channels/frequency

**2. Permission-Based Subscription:**
```typescript
interface NotificationType {
  required_permission: string; // Single permission required (e.g., 'notifications:escalation:receive')
  subscription_conditions?: {
    hasCustomers?: boolean; // User must have customer assignments
    hasManager?: boolean; // User must have a manager
    // ... other conditions
  };
}
```

**3. Permission Evaluation:**
- Check if user has `required_permission` (from RBAC system)
- Evaluate optional conditions (custom logic)
- If permission matches AND conditions pass → subscribe user
- If permission doesn't match → user cannot subscribe (even manually)

**4. Auto-Subscription Flow:**
```typescript
async function autoSubscribeToNewType(typeId: string) {
  const type = await getNotificationType(typeId);
  
  if (!type.auto_subscribe_enabled || !type.required_permission) {
    return; // No auto-subscription configured or no permission requirement
  }
  
  // Find all users in tenant
  const allUsers = await getAllUsers(type.tenantId);
  
  for (const user of allUsers) {
    // Check if user has required permission
    const userPermissions = await userResolver.getUserPermissions(user.id);
    if (!userPermissions.includes(type.required_permission)) {
      continue; // User doesn't have permission
    }
    
    // Check optional conditions
    if (type.subscription_conditions) {
      const matchesConditions = await userResolver.userMatchesConditions(
        user.id,
        type.subscription_conditions
      );
      if (!matchesConditions) {
        continue; // User doesn't match conditions
      }
    }
    
    // Check if already subscribed (manual or previous auto-subscription)
    const existing = await getUserPreference(user.id, typeId);
    if (existing) continue; // Don't override manual subscriptions
    
    // Create auto-subscription
    await createUserPreference({
      userId: user.id,
      notificationTypeId: typeId,
      enabled: true,
      channels: type.default_channels,
      frequency: type.default_frequency,
      batchInterval: type.default_batch_interval,
      subscriptionSource: 'auto',
      autoSubscribedAt: new Date(),
    });
  }
}
```

### Refresh Endpoints

**Purpose:** Update user subscriptions based on current roles/permissions.

**1. Refresh User Subscriptions**
```
POST /api/notifications/subscriptions/refresh
Body: {
  userId?: string, // Optional, defaults to current user
  notificationTypeIds?: string[] // Optional, refresh specific types only
}
```

**Flow:**
1. Get user's current permissions
2. For each notification type with `auto_subscribe_enabled`:
   - Check if user has `required_permission`
   - Evaluate optional `subscription_conditions`
   - If user has permission AND matches conditions:
     - Subscribe if not already subscribed
     - Update `subscription_source` if changed from manual to auto
   - If user doesn't have permission OR doesn't match conditions:
     - If subscription source is 'auto' → unsubscribe
     - If subscription source is 'manual' → keep subscribed (user choice)
3. Return summary of changes

**2. Refresh All Users (Admin)**
```
POST /api/notifications/subscriptions/refresh/all
Body: {
  tenantId: string,
  notificationTypeIds?: string[] // Optional, refresh specific types only
}
```

**Flow:**
1. Get all users in tenant
2. For each user, refresh subscriptions (same logic as above)
3. Process in batches (e.g., 100 users at a time)
4. Return summary of changes

**3. Refresh for Notification Type (Admin)**
```
POST /api/notifications/subscriptions/refresh/type/:typeId
Body: {
  tenantId: string
}
```

**Flow:**
1. Get notification type and `required_permission`
2. Find all users in tenant
3. For each user:
   - Check if user has `required_permission`
   - Evaluate optional `subscription_conditions`
   - If matches → subscribe (if not already subscribed)
   - If doesn't match → unsubscribe (if auto-subscribed)
4. Return summary of changes

**Use Cases:**
- User's role changes → refresh subscriptions
- New notification type added → auto-subscribe eligible users
- Permission changes → refresh affected users
- Bulk role assignment → refresh all affected users
- Scheduled refresh → cron job to keep subscriptions in sync

### Subscription Refresh Logic

**Decision Matrix:**

| Current Status | Has Permission? | Matches Conditions? | Action |
|---------------|-----------------|---------------------|--------|
| Not subscribed | Yes | Yes | Subscribe (auto) |
| Not subscribed | Yes | No | No action (conditions not met) |
| Not subscribed | No | - | No action (no permission) |
| Subscribed (manual) | Yes | Yes | Keep subscribed (respect user choice) |
| Subscribed (manual) | Yes | No | Keep subscribed (respect user choice) |
| Subscribed (manual) | No | - | Keep subscribed (respect user choice, but user shouldn't receive notifications) |
| Subscribed (auto) | Yes | Yes | Keep subscribed, update timestamp |
| Subscribed (auto) | Yes | No | Unsubscribe (conditions no longer met) |
| Subscribed (auto) | No | - | Unsubscribe (no longer has permission) |

**Key Principles:**
- **Permission-based only** - No role-based subscriptions, only permissions
- **Permission required** - User must have `required_permission` to subscribe (even manually)
- **Auto-subscribe on creation** - When new notification type created, auto-subscribe users with matching permission
- **Manual subscriptions take precedence** - Never auto-unsubscribe manual subscriptions
- **Auto-subscriptions are dynamic** - Updated based on current permissions
- **User can unsubscribe** - User can unsubscribe from auto-subscribed types
- **Content generation at send time** - Templates rendered when batch is processed (not at creation)
- **Data access checked during rendering** - Template provider checks access via `dataAccessChecker` function
- **Template provider generates, channel adapter sends** - Clear separation of responsibilities
- **Skip if no content** - If `hasContent = false`, mark as 'skipped', don't send

### User Resolver Extension for Subscriptions

**Add to UserResolver Interface:**
```typescript
interface UserResolver {
  // ... existing methods ...
  
  /**
   * Get user's permissions
   */
  getUserPermissions(userId: string): Promise<string[]>; // Permission strings
  
  /**
   * Check if user has specific permission
   */
  userHasPermission(userId: string, permission: string): Promise<boolean>;
  
  /**
   * Check if user matches subscription conditions
   */
  userMatchesConditions(
    userId: string,
    conditions: SubscriptionConditions
  ): Promise<boolean>;
  
  /**
   * Create data access checker function for template rendering
   * Returns a function that templates can call to check data access
   */
  createDataAccessChecker(
    userId: string,
    tenantId: string
  ): (dataContext: NotificationDataContext) => Promise<boolean>;
}
```

**Note:** `userHasDataAccess()` is not called directly. Instead, `createDataAccessChecker()` returns a function that is passed to template provider during rendering. This allows templates to check data access at render time.

**NotificationDataContext:**
```typescript
interface NotificationDataContext {
  notificationType: string;
  data: Record<string, unknown>; // Notification metadata
  // Examples:
  // { customerId: '...', emailId: '...' } → check customer access
  // { requestId: '...' } → check approval request access
  // { escalationId: '...' } → check escalation access
}
```

**Example Implementation:**
```typescript
class DatabaseUserResolver implements UserResolver {
  async getUserPermissions(userId: string) {
    const user = await this.db.query.users.findFirst({
      where: eq(users.id, userId),
      include: { role: { include: { permissions: true } } }
    });
    
    return user?.role?.permissions?.map(p => p.name) || [];
  }
  
  async userHasPermission(userId: string, permission: string) {
    const permissions = await this.getUserPermissions(userId);
    return permissions.includes(permission);
  }
  
  async userMatchesConditions(userId: string, conditions: SubscriptionConditions) {
    if (conditions.hasCustomers) {
      const count = await this.db.query.userCustomers.count({
        where: eq(userCustomers.userId, userId)
      });
      if (count === 0) return false;
    }
    
    if (conditions.hasManager) {
      const count = await this.db.query.userManagers.count({
        where: eq(userManagers.userId, userId)
      });
      if (count === 0) return false;
    }
    
    return true;
  }
  
  createDataAccessChecker(userId: string, tenantId: string) {
    return async (context: NotificationDataContext): Promise<boolean> => {
      // Check permission first
      const type = await getNotificationType(context.notificationType);
      if (type.required_permission) {
        const hasPermission = await this.userHasPermission(userId, type.required_permission);
        if (!hasPermission) return false;
      }
      
      // Check data access based on notification type and data context
      if (context.data.customerId) {
        // Check if user has access to customer
        const hasAccess = await this.hasCustomerAccess(userId, context.data.customerId);
        if (!hasAccess) return false;
      }
      
      if (context.data.emailId) {
        // Check if user has access to email
        const hasAccess = await this.hasEmailAccess(userId, context.data.emailId);
        if (!hasAccess) return false;
      }
      
      if (context.data.requestId) {
        // Check if user has access to approval request
        const hasAccess = await this.hasApprovalRequestAccess(userId, context.data.requestId);
        if (!hasAccess) return false;
      }
      
      // Add more data access checks as needed
      
      return true;
    };
  }
  
  private async hasCustomerAccess(userId: string, customerId: string) {
    // Check user_accessible_customers table
    const result = await this.db.execute(sql`
      SELECT 1 FROM user_accessible_customers
      WHERE user_id = ${userId} AND customer_id = ${customerId}
      LIMIT 1
    `);
    return result.length > 0;
  }
  
  // ... other data access methods
}
```

**Template Provider Example:**
```typescript
class FilesystemTemplateProvider implements TemplateProvider {
  async renderTemplate(
    template: Template,
    data: Record<string, unknown>,
    options?: RenderOptions
  ): Promise<TemplateRenderResult> {
    try {
      // Check data access if checker provided
      if (options?.dataAccessChecker && options.userId && options.tenantId) {
        const hasAccess = await options.dataAccessChecker({
          notificationType: template.typeId,
          data,
        });
        
        if (!hasAccess) {
          return {
            hasContent: false,
            reason: 'no_data_access',
          };
        }
      }
      
      // Render template
      const content = await this.render(template.content, data, options);
      
      // Check if content is empty
      if (!content || (content.html && content.html.trim() === '')) {
        return {
          hasContent: false,
          reason: 'empty_content',
        };
      }
      
      return {
        hasContent: true,
        content,
      };
    } catch (error) {
      // Template rendering error
      return {
        hasContent: false,
        reason: 'template_error',
        error: error.message,
      };
    }
  }
}
```

**Channel Adapter Example:**
```typescript
class EmailChannel implements BaseChannel {
  async send(notification: Notification, userResolver: UserResolver) {
    // Get template provider
    const templateProvider = container.resolve<TemplateProvider>('TemplateProvider');
    
    // Get template
    const template = await templateProvider.getTemplate(
      notification.notificationTypeId,
      'email',
      notification.locale
    );
    
    if (!template) {
      // Use fallback template
      const fallback = await templateProvider.getFallbackTemplate('email');
      if (!fallback) {
        throw new Error('No template available');
      }
      template = fallback;
    }
    
    // Create data access checker
    const dataAccessChecker = userResolver.createDataAccessChecker(
      notification.userId,
      notification.tenantId
    );
    
    // Render template (content generation)
    const renderResult = await templateProvider.renderTemplate(
      template,
      notification.metadata,
      {
        locale: notification.locale,
        userId: notification.userId,
        tenantId: notification.tenantId,
        dataAccessChecker,
      }
    );
    
    // Check if content was generated
    if (!renderResult.hasContent) {
      // Skip sending, mark notification as skipped
      await notificationRepo.updateStatus(notification.id, 'skipped');
      return { sent: false, reason: renderResult.reason };
    }
    
    // Get user's email address
    const address = await userResolver.getUserChannelAddress(notification.userId, 'email');
    if (!address || address.isDisabled) {
      throw new Error('Email address not available or disabled');
    }
    
    // Send via SMTP/transactional email service (channel adapter responsibility)
    await this.sendEmail({
      to: address.address,
      subject: renderResult.content.subject,
      html: renderResult.content.html,
      text: renderResult.content.text,
    });
    
    return { sent: true };
  }
}
```

### Subscription Service Implementation

**Service Methods:**
```typescript
@injectable()
export class SubscriptionService {
  constructor(
    @inject('UserResolver') private userResolver: UserResolver,
    @inject(NotificationPreferencesRepository) private preferencesRepo: NotificationPreferencesRepository,
    @inject(NotificationTypeRepository) private typeRepo: NotificationTypeRepository
  ) {}

  /**
   * Subscribe user to notification type
   */
  async subscribe(
    requestHeader: RequestHeader,
    typeId: string,
    preferences?: Partial<UserNotificationPreferences>
  ) {
    // Validate type exists and is active
    const type = await this.typeRepo.findById(typeId);
    if (!type || !type.isActive) {
      throw new Error('Notification type not found or inactive');
    }
    
    // Check if user has required permission
    const hasPermission = await this.userResolver.userHasPermission(
      requestHeader.userId,
      type.required_permission
    );
    if (!hasPermission) {
      throw new Error('User does not have required permission to subscribe');
    }
    
    // Check optional conditions
    if (type.subscription_conditions) {
      const matchesConditions = await this.userResolver.userMatchesConditions(
        requestHeader.userId,
        type.subscription_conditions
      );
      if (!matchesConditions) {
        throw new Error('User does not meet subscription conditions');
      }
    }
    
    // Create or update preference
    return this.preferencesRepo.upsert({
      userId: requestHeader.userId,
      notificationTypeId: typeId,
      enabled: true,
      channels: preferences?.channels || type.default_channels,
      frequency: preferences?.frequency || type.default_frequency,
      batchInterval: preferences?.batchInterval || type.default_batch_interval,
      subscriptionSource: 'manual',
    });
  }

  /**
   * Refresh user's subscriptions based on roles/permissions
   */
  async refreshUserSubscriptions(
    userId: string,
    tenantId: string,
    typeIds?: string[]
  ) {
    const types = typeIds
      ? await this.typeRepo.findByIds(typeIds)
      : await this.typeRepo.findActiveByTenant(tenantId);
    
    const userPermissions = await this.userResolver.getUserPermissions(userId);
    
    const changes = {
      subscribed: [] as string[],
      unsubscribed: [] as string[],
      updated: [] as string[],
    };
    
    for (const type of types) {
      if (!type.auto_subscribe_enabled || !type.required_permission) {
        continue; // Skip types without auto-subscription or permission requirement
      }
      
      // Check permission
      const hasPermission = userPermissions.includes(type.required_permission);
      if (!hasPermission) {
        // User doesn't have permission
        const existing = await this.preferencesRepo.findByUserAndType(userId, type.id);
        if (existing && existing.subscriptionSource === 'auto') {
          // Unsubscribe if auto-subscribed
          await this.preferencesRepo.update(existing.id, { enabled: false });
          changes.unsubscribed.push(type.id);
        }
        continue;
      }
      
      // Check optional conditions
      let matchesConditions = true;
      if (type.subscription_conditions) {
        matchesConditions = await this.userResolver.userMatchesConditions(
          userId,
          type.subscription_conditions
        );
      }
      
      const matches = hasPermission && matchesConditions;
      
      const existing = await this.preferencesRepo.findByUserAndType(userId, type.id);
      
      if (matches) {
        if (!existing) {
          // Subscribe
          await this.preferencesRepo.create({
            userId,
            notificationTypeId: type.id,
            enabled: true,
            channels: type.default_channels,
            frequency: type.default_frequency,
            batchInterval: type.default_batch_interval,
            subscriptionSource: 'auto',
            autoSubscribedAt: new Date(),
          });
          changes.subscribed.push(type.id);
        } else if (existing.subscriptionSource === 'auto') {
          // Update timestamp
          await this.preferencesRepo.update(existing.id, {
            autoSubscribedAt: new Date(),
          });
          changes.updated.push(type.id);
        }
        // If manual subscription, don't change it
      } else {
        if (existing && existing.subscriptionSource === 'auto') {
          // Unsubscribe (no longer eligible)
          await this.preferencesRepo.update(existing.id, {
            enabled: false,
          });
          changes.unsubscribed.push(type.id);
        }
        // If manual subscription, keep it
      }
    }
    
    return changes;
  }

}
```

---

## Integration Points

### With Email Analysis Module

**Trigger:** Escalation detected in email analysis

**Integration:**
- Email analysis service calls `NotificationService.send()`
- Notification type: `escalation_alert`
- Data includes: customer ID, email ID, severity
- **Event key:** Hash of `customerId + emailId` (for deduplication)
- **Deduplication:** 'create_new' strategy (track all escalations)
- Fans out to users subscribed to escalation alerts

### With Approval Workflows

**Trigger:** Approval request created or updated

**Integration:**
- Approval service calls `NotificationService.send()`
- Notification type: `approval_request`
- Data includes: request ID, amount, requester, status
- **Event key:** Hash of `requestId` (for deduplication)
- **Deduplication:** 'overwrite' strategy (update existing notification if request modified)
- Targets: specific manager user IDs
- Includes action items (approve/reject)
- **If request modified before batch release:** Existing notification updated with new data

### With Daily Digests

**Trigger:** Scheduled cron (daily)

**Integration:**
- Scheduled Inngest function runs daily
- Aggregates all notifications from previous day
- Sends digest to users with `end_of_day` batching
- Notification type: `daily_digest`

### With User Management

**Integration:**
- User created → auto-subscribe to eligible notification types (based on roles/permissions)
- User deleted → cancel pending notifications, delete preferences
- User role changed → refresh subscriptions (call refresh endpoint)
- User permissions changed → refresh subscriptions (call refresh endpoint)
- User preferences → stored in `user_notification_preferences`
- UI integration → subscription management endpoints drive UI

### With Integrations Module

**Integration:**
- Channel credentials stored in `integrations` table
- Same encryption pattern as Gmail credentials
- Retrieved via `IntegrationService`
- Supports OAuth and API key authentication

---

## Design Decisions

### Decision 1: Channel Credentials Storage

**Options:**
- A) Separate `notification_channel_credentials` table
- B) Use existing `integrations` table

**Decision:** Option B - Use `integrations` table

**Rationale:**
- Consistency with existing Gmail/Outlook integration pattern
- Reuses encryption and credential management
- Single source of truth for all integrations
- Easier to manage (one UI for all integrations)

**Implementation:**
- Add `notification_channels` as new `integration_source` enum value
- Store Slack webhook URL, SMS API keys, etc. in `integrations` table
- Retrieve via `IntegrationService.getCredentials()`

### Decision 2: Template Storage

**Options:**
- A) Store templates in database
- B) Store templates in codebase (version controlled)

**Decision:** Option B - Store in codebase

**Rationale:**
- Version control for templates (Git history)
- Code review for template changes
- Easier to test templates
- Database stores metadata only (type, channel, version)

**Implementation:**
- Templates stored via `TemplateProvider` (filesystem, database, or remote)
- Default: FilesystemTemplateProvider reads from `packages/notifications/templates/`
- Database stores template registry (which template for which type+channel)
- Template loader uses `TemplateProvider` interface (not direct filesystem access)
- Projects can provide custom `TemplateProvider` implementation

### Responsibility Separation: Content Generation vs Sending

**Template Provider (Content Builder):**
- **Responsibility:** Generate content from template and data
- **Returns:** `TemplateRenderResult` with `hasContent` flag and rendered content
- **Does NOT:** Send content via channels
- **Does:** Check data access during rendering (via `dataAccessChecker`)
- **Does:** Return `hasContent: false` if user can't access data or content is empty

**Channel Adapter (Content Builder Caller):**
- **Responsibility:** Send rendered content via channel (email, Slack, etc.)
- **Receives:** `TemplateRenderResult` from template provider
- **Checks:** `hasContent` flag before sending
- **Does NOT:** Generate content (delegates to template provider)
- **Does:** Handle actual delivery (SMTP, Slack API, Twilio, etc.)
- **Does:** Skip sending if `hasContent = false`

**Flow:**
1. Channel adapter calls `TemplateProvider.renderTemplate()`
2. Template provider generates content, checks data access, returns `TemplateRenderResult`
3. Channel adapter checks `hasContent` flag
4. If `hasContent = true` → Channel adapter sends content via channel
5. If `hasContent = false` → Channel adapter skips sending, marks notification as 'skipped'

**Example:**
```typescript
// Channel Adapter (caller)
class EmailChannel {
  async send(notification: Notification) {
    // 1. Get template
    const template = await templateProvider.getTemplate(typeId, 'email');
    
    // 2. Create data access checker
    const dataAccessChecker = userResolver.createDataAccessChecker(userId, tenantId);
    
    // 3. Render template (content generation)
    const result = await templateProvider.renderTemplate(template, metadata, {
      dataAccessChecker,
      userId,
      tenantId,
    });
    
    // 4. Check if content was generated
    if (!result.hasContent) {
      // Skip sending, mark as skipped
      return { sent: false, reason: result.reason };
    }
    
    // 5. Send content via channel (channel adapter responsibility)
    await this.sendEmail(result.content);
    return { sent: true };
  }
}
```

### Decision 3: Batch Aggregation Strategy

**Options:**
- A) Pre-aggregate at batch creation time
- B) Aggregate at send time

**Decision:** Option B - Aggregate at send time

**Rationale:**
- More flexible (can change aggregation logic)
- Handles late-arriving notifications (added to batch before send)
- Simpler batch creation logic
- Slight performance trade-off acceptable

**Implementation:**
- `BatchAggregator` runs when processing batch
- Aggregates all notifications in batch
- Passes aggregated content to template

### Decision 4: Action URL Security

**Options:**
- A) Signed tokens (JWT) in URLs
- B) Database lookup with one-time tokens

**Decision:** Option A - Signed tokens (JWT)

**Rationale:**
- Stateless (no database lookup needed)
- Expiration built-in
- Can include action metadata in token
- Simpler implementation

**Implementation:**
- JWT contains: notification ID, user ID, action type, expiration
- Signed with secret key
- Validated on action endpoint

### Decision 5: Fan-Out Strategy

**Options:**
- A) Synchronous fan-out (blocking)
- B) Asynchronous fan-out (Inngest events)

**Decision:** Option B - Asynchronous via Inngest

**Rationale:**
- Non-blocking (business logic doesn't wait)
- Handles large fan-outs (thousands of users)
- Retries and observability built-in
- Consistent with existing patterns (email analysis)

**Implementation:**
- Single Inngest event emitted
- Inngest function processes fan-out
- Parallel processing handled by Inngest

### Decision 6: Preference Resolution

**Options:**
- A) User preferences only (no defaults)
- B) User preferences with type defaults
- C) User preferences with type defaults and tenant defaults

**Decision:** Option B - User preferences with type defaults

**Rationale:**
- Simpler than tenant defaults (less configuration)
- Type defaults provide sensible defaults
- Users can override per type
- Future: Can add tenant defaults if needed

**Implementation:**
- Use `UserResolver.getUserPreferences()` to check user preference first
- Fall back to notification type defaults
- System defaults as final fallback
- User resolver handles preference resolution logic

### Decision 7: Data Payload vs Template API Queries

**Options:**
- A) Caller provides full data payload (all template variables)
- B) Templates query APIs to fetch additional data
- C) Hybrid (default full payload, optional API queries)

**Decision:** Option C - Hybrid approach

**Rationale:**
- Full payload is faster and simpler (default)
- API queries useful for complex templates needing fresh data
- Configurable per notification type
- Templates can use `dataLoader` if provided in context

**Implementation:**
- Default: Caller provides complete data in `metadata`
- Optional: Template can query APIs via `dataLoader` function (if enabled in type config)
- Performance: API queries add latency - prefer full payload

### Decision 8: Externalized Configuration

**Options:**
- A) Hardcoded templates in codebase
- B) Templates configurable in database
- C) Hybrid (codebase templates, database configuration)

**Decision:** Option C - Hybrid approach

**Rationale:**
- Templates in codebase (version controlled, code review)
- Configuration in database (externalized, no code changes needed)
- Allows copying codebase and configuring templates externally
- Template registry maps type+channel → template path/ID

**Implementation:**
- Templates stored in codebase: `apps/api/src/notifications/templates/`
- Configuration in `notification_types.template_config` JSONB:
  - Channel → template path mapping
  - Template version
  - Data loader config
  - Variable mapping
- Template registry loads templates based on config

### Decision 9: Unified Batching Mechanism

**Options:**
- A) Special logic for end-of-day batching
- B) Unified `scheduled_for` (releaseAt) for all batching modes

**Decision:** Option B - Unified mechanism

**Rationale:**
- Simpler implementation (no special cases)
- End-of-day is just a calculated `scheduled_for` timestamp
- Single cron job processes all batches
- Consistent behavior across all batching modes

**Implementation:**
- All batching modes calculate UTC `scheduled_for` timestamp
- End-of-day: Calculate in user timezone → convert to UTC
- Single cron processes all batches where `scheduled_for <= NOW()`
- No special logic needed for end-of-day

### Decision 10: Event Modification Handling

**Options:**
- A) Always create new notification (allow duplicates)
- B) Always overwrite existing pending notification
- C) Configurable per notification type

**Decision:** Option C - Configurable strategy

**Rationale:**
- Different use cases need different behavior
- Approval requests: overwrite (latest status)
- Escalation alerts: create new (track all escalations)
- Configurable per notification type

**Implementation:**
- `notification_types.deduplication_config` JSONB:
  - `strategy`: 'overwrite' | 'create_new' | 'ignore'
  - `event_key_fields`: Array of metadata fields to hash
  - `update_window_minutes`: Time window for updates
- Calculate `event_key` hash from specified metadata fields
- Check for existing pending notification with same `event_key`
- Apply configured strategy

### Decision 11: Engagement Tracking

**Options:**
- A) No tracking
- B) Track opens and clicks
- C) Full engagement analytics

**Decision:** Option B - Track opens and clicks

**Rationale:**
- Essential for understanding notification effectiveness
- Enables A/B testing of templates
- Helps optimize delivery timing
- Foundation for future analytics

**Implementation:**
- `notifications.engagement` JSONB field:
  - `opened_at`: Timestamp (first open)
  - `opened_count`: Integer (total opens)
  - `clicked_at`: Timestamp (first click)
  - `clicked_count`: Integer (total clicks)
  - `clicked_links`: Array of clicked URLs
- Tracking pixels in emails (1x1 transparent image)
- Signed tracking URLs for clicks
- Separate table `notification_engagement_events` for detailed tracking (optional)

### Decision 12: User Channel Addresses

**Options:**
- A) Store in users table (single address per channel)
- B) Separate table for channel addresses

**Decision:** Option B - Separate `user_channel_addresses` table

**Rationale:**
- Users may have multiple addresses per channel (e.g., multiple devices for push)
- Supports verification status per address
- Tracks bounce/complaint counts per address
- Cleaner separation of concerns

**Implementation:**
- `user_channel_addresses` table stores:
  - Channel-specific addresses (Slack ID, phone, device token)
  - Verification status
  - Bounce/complaint tracking
  - Disabled flag (auto-disabled after bounces)

### Decision 13: Bounce/Complaint Handling

**Options:**
- A) No handling (manual review)
- B) Auto-disable after bounces
- C) Full webhook integration with auto-disable

**Decision:** Option C - Full webhook integration

**Rationale:**
- Prevents sending to invalid addresses
- Protects sender reputation
- Reduces costs (no wasted sends)
- Industry best practice

**Implementation:**
- Webhook endpoints for provider callbacks
- Idempotency via `provider_event_id`
- Auto-disable after threshold (3 hard bounces, 1 complaint)
- Cancel pending notifications for disabled addresses

### Decision 14: Priority Levels

**Options:**
- A) No priority (all treated equally)
- B) Priority affects batching only
- C) Priority affects batching and retries

**Decision:** Option C - Full priority support

**Rationale:**
- Critical notifications need immediate delivery
- High priority can override user preferences
- Low priority always batches (reduce spam)
- Enables better user experience

**Implementation:**
- Priority field on notifications: 'critical', 'high', 'normal', 'low'
- Critical: Bypass batching, aggressive retries
- High: Override user preferences (send within 5 min)
- Normal: Follow user preferences
- Low: Always batch

### Decision 15: Notification Expiry

**Options:**
- A) No expiry (send eventually)
- B) Expiry per notification type
- C) Expiry configurable per notification

**Decision:** Option C - Configurable expiry

**Rationale:**
- Stale notifications shouldn't be sent (e.g., approval request already handled)
- Prevents sending outdated information
- Reduces user confusion
- Configurable per type with per-notification override

**Implementation:**
- `expires_at` timestamp on notifications
- Default from notification type config
- Overridable per notification
- Cron job marks expired notifications
- Skipped during batch processing

### Decision 16: Idempotency for notify() Calls

**Options:**
- A) No idempotency (allow duplicates)
- B) Idempotency via event_key only
- C) Separate idempotency_key parameter

**Decision:** Option C - Separate idempotency_key

**Rationale:**
- Prevents duplicate fan-outs on retries
- Different from event_key (event deduplication)
- Caller controls idempotency scope
- Industry standard pattern

**Implementation:**
- Optional `idempotencyKey` parameter on `notify()`
- Unique constraint on `idempotency_key`
- If exists → skip entire fan-out (prevent duplicates)

### Decision 17: Read Status

**Options:**
- A) No read tracking
- B) Read status in notifications table
- C) Separate read tracking table

**Decision:** Option B - Read status in notifications table

**Rationale:**
- Essential for in-app notification center
- Simple implementation (single field)
- Efficient queries (index on read_at)
- Sufficient for current needs

**Implementation:**
- `read_at` timestamp on notifications
- NULL = unread, timestamp = read
- Index on `read_at IS NULL` for unread queries

### Decision 18: Localization/i18n

**Options:**
- A) English only
- B) Multi-language templates
- C) Full i18n with locale-aware formatting

**Decision:** Option C - Full i18n support

**Rationale:**
- Global user base requires multi-language support
- Locale-aware formatting (dates, numbers, currency)
- Better user experience
- Foundation for future expansion

**Implementation:**
- Locale stored on users and notifications
- Template variants per locale
- Locale-aware formatting utilities
- Fallback to default locale

### Decision 19: Audit Logging

**Options:**
- A) No audit log
- B) Log critical events only
- C) Comprehensive audit log

**Decision:** Option C - Comprehensive audit log

**Rationale:**
- Compliance requirements
- Debugging and troubleshooting
- User preference change tracking
- Security auditing

**Implementation:**
- `notification_audit_log` table
- Logs: created, sent, failed, preference changes, address updates
- Immutable (append-only)
- Long retention for compliance

### Decision 20: Edge Case Handling Strategy

**Options:**
- A) Fail-fast (stop on first error)
- B) Best-effort (continue on errors)
- C) Configurable per edge case

**Decision:** Option C - Configurable strategy

**Rationale:**
- Different edge cases need different handling
- User deletion → cancel (fail-fast)
- Channel disabled → partial success (best-effort)
- Template missing → fallback (best-effort)
- Provider outage → retry then fail (configurable)

**Implementation:**
- Edge case handlers with configurable strategies
- Fallback chains for recoverable errors
- Dead letter queue for unrecoverable errors
- Comprehensive error logging

### Decision 21: Content Generation Timing & Responsibility

**Options:**
- A) Generate content at notification creation time
- B) Generate content at send time (when batch is processed)
- C) Generate content at both times (cache at creation, regenerate at send)

**Decision:** Option B - Generate content at send time

**Rationale:**
- Notifications are batched and sent later
- Data access may change between creation and send
- User permissions may change
- Data may be deleted or access revoked
- Content must reflect current state at send time

**Responsibility Separation:**
- **Template Provider:** Generates content, returns `TemplateRenderResult` with `hasContent` flag
- **Channel Adapter:** Sends content, checks `hasContent` before sending
- Clear separation: Template provider doesn't send, channel adapter doesn't generate

**Implementation:**
- Template rendering happens when batch is processed (send time)
- Template provider receives `dataAccessChecker` function in render options
- Template provider checks data access during rendering
- Returns `hasContent: false` if user can't access data
- Channel adapter skips sending if `hasContent = false`

### Decision 21: Content Generation Timing & Responsibility

**Options:**
- A) Generate content at notification creation time
- B) Generate content at send time (when batch is processed)
- C) Generate content at both times (cache at creation, regenerate at send)

**Decision:** Option B - Generate content at send time

**Rationale:**
- Notifications are batched and sent later
- Data access may change between creation and send
- User permissions may change
- Data may be deleted or access revoked
- Content must reflect current state at send time

**Responsibility Separation:**
- **Template Provider (Content Builder):** Generates content, returns `TemplateRenderResult` with `hasContent` flag
- **Channel Adapter (Caller):** Sends content, checks `hasContent` before sending
- Clear separation: Template provider doesn't send, channel adapter doesn't generate

**Implementation:**
- Template rendering happens when batch is processed (send time)
- Template provider receives `dataAccessChecker` function in render options
- Template provider checks data access during rendering
- Returns `hasContent: false` if user can't access data
- Channel adapter skips sending if `hasContent = false`

### Decision 22: Pluggable Interfaces

**Options:**
- A) Tightly coupled to filesystem and CRM user model
- B) Abstract interfaces for templates and users
- C) Full plugin architecture

**Decision:** Option B - Abstract interfaces

**Rationale:**
- Package should be reusable across projects
- Different projects have different user models
- Templates may be stored in filesystem, database, or remote service
- Allows package to be framework-agnostic
- Easy to implement for specific project needs

**Implementation:**
- `TemplateProvider` interface for template storage
- `UserResolver` interface for user/tenant data access
- Default implementations provided (FilesystemTemplateProvider, DatabaseUserResolver)
- Projects can provide custom implementations
- Registered via dependency injection

---

## Implementation Phases

### Phase 1: Core Infrastructure (Weeks 1-2)

**Deliverables:**
- Database schema creation (all tables)
- Repository layer (notifications, preferences, batches, actions)
- Service layer (basic CRUD operations)
- API routes (create notification, list notifications, preferences CRUD)
- Basic email channel adapter (react-email)
- Simple email template (plain text or basic HTML)

**Success Criteria:**
- Can create notification via API
- Notification stored in database
- Can list user's notifications
- Can manage user preferences
- Can send simple email notification

### Phase 2: Batching & Scheduling (Week 3)

**Deliverables:**
- Batch manager (creates and schedules batches)
- Batch interval calculation (minutes, hours, end-of-day)
- Inngest cron function for batch processing
- Batch aggregation logic (simple list aggregation)
- Batch template (digest format)

**Success Criteria:**
- Notifications batched according to user preferences
- Batches scheduled correctly (timezone-aware)
- Cron processes batches on schedule
- Batched notifications aggregated and sent

### Phase 3: Fan-Out & Preferences (Week 4)

**Deliverables:**
- Fan-out service implementation
- User subscription query (who receives notifications)
- Preference resolution (user → type defaults → system defaults)
- Quiet hours support (timezone-aware)
- Inngest fan-out function
- Subscription management APIs (UI-driven)
- Auto-subscription system (role/permission-based)
- Refresh endpoints

**Success Criteria:**
- Single notification creation fans out to all subscribers
- Preferences correctly applied (channels, frequency, batching)
- Quiet hours respected (notifications delayed)
- Efficient fan-out (bulk operations)
- UI can list, subscribe, unsubscribe, update preferences
- New notification types auto-subscribe eligible users
- Refresh endpoints update subscriptions based on roles/permissions

### Phase 4: Actions (Week 5)

**Deliverables:**
- Action endpoints (individual and batch)
- Action processing (Inngest function)
- Signed token generation and validation
- Action handlers (approval handler, custom handler)
- Batch action support (transactional)

**Success Criteria:**
- Users can take actions on notifications (approve/reject)
- Actions processed correctly (business logic executed)
- Batch actions work (all succeed or all fail)
- Action URLs secure (signed tokens)

### Phase 5: Additional Channels (Weeks 6-7)

**Deliverables:**
- Slack channel adapter
- Google Chat channel adapter
- SMS channel adapter (Twilio)
- Mobile push channel adapter (FCM/APNS)
- Channel-specific templates

**Success Criteria:**
- All channels functional
- Templates render correctly per channel
- Channel credentials stored securely
- Rate limiting per channel

### Phase 6: Templates & Polish (Week 8)

**Deliverables:**
- Rich email templates (react-email)
- Slack block kit templates
- Template versioning support
- Template management API
- Documentation
- Testing (unit, integration)

**Success Criteria:**
- Rich templates for all channels
- Template versioning works
- Templates tested and documented
- System production-ready

---

## Edge Cases & Error Handling

### 1. User Deleted Mid-Fanout

**Scenario:** User is deleted while fan-out is in progress, leaving pending notifications.

**Handling:**
- **Cascade Delete:** `notifications` table has `ON DELETE CASCADE` on `user_id`
- **In-Progress Check:** Before sending, verify user still exists:
  ```sql
  SELECT 1 FROM users WHERE id = :user_id AND row_status = 0
  ```
- **Status Update:** If user deleted:
  - Mark notifications as 'cancelled' status
  - Remove from batches
  - Log audit event: 'notification_cancelled_user_deleted'
- **Fan-Out Protection:** Check user exists before creating notification record
- **Batch Processing:** Skip notifications for deleted users during batch processing

**Implementation:**
- Add user existence check in `fanOutNotification` function
- Add user existence check in `processBatch` function
- Database foreign key cascade handles cleanup

### 2. Tenant Suspended

**Scenario:** Tenant account is suspended/deactivated while notifications are pending.

**Handling:**
- **Tenant Status Check:** Before sending, verify tenant is active:
  ```sql
  SELECT is_active FROM tenants WHERE id = :tenant_id
  ```
- **Status Update:** If tenant suspended:
  - Mark all pending notifications as 'cancelled'
  - Cancel all pending batches
  - Log audit event: 'notification_cancelled_tenant_suspended'
- **Prevention:** Check tenant status in:
  - `fanOutNotification` function (before creating notifications)
  - `processBatch` function (before sending)
  - `sendImmediateNotification` function (before delivery)

**Implementation:**
- Add `tenants.is_active` boolean field (if not exists)
- Add tenant status check in all processing functions
- Cron job to cancel notifications for suspended tenants

### 3. Channel Disabled Mid-Batch

**Scenario:** Batch contains notifications for multiple channels, one channel gets disabled.

**Handling:**
- **Per-Channel Processing:** Process each channel separately in batch
- **Partial Success:** If one channel fails:
  - Mark that channel's notifications as 'failed'
  - Continue processing other channels
  - Update batch status to 'partially_sent' (new status)
- **Channel Status Check:** Before sending, verify channel is enabled:
  ```sql
  SELECT is_disabled FROM user_channel_addresses 
  WHERE user_id = :user_id AND channel = :channel
  ```
- **Batch Status:** Track per-channel status in `notification_batches.delivery_attempts`:
  ```json
  {
    "email": { "status": "sent", "sent_at": "..." },
    "slack": { "status": "failed", "error": "channel_disabled" }
  }
  ```

**Implementation:**
- Add 'partially_sent' status to batches
- Process channels sequentially (not fail-fast)
- Track per-channel status in delivery_attempts

### 4. Template Missing

**Scenario:** Notification type references a template that doesn't exist.

**Handling:**
- **Template Validation:** On notification type creation/update:
  - Validate template exists for all configured channels
  - Reject if template missing
- **Runtime Fallback:** If template missing at send time:
  - Use default template for channel (e.g., `default-email.tsx`)
  - Log error: 'template_missing_using_fallback'
  - Alert admin (optional)
- **Template Registry:** Template loader:
  - Try to load template from config
  - Fall back to default template
  - Fall back to plain text template
  - If all fail → mark notification as 'failed'

**Implementation:**
- Template registry with fallback chain
- Default templates for each channel
- Validation on notification type save
- Error logging and alerting

### 5. Invalid Channel Address

**Scenario:** User's phone number is invalid or Slack ID doesn't exist.

**Handling:**
- **Pre-Send Validation:** Validate address format before sending:
  - Phone: Regex validation, E.164 format
  - Slack ID: API call to verify user exists
  - Email: Format validation (already handled)
- **Send-Time Validation:** Provider validates on send:
  - Invalid address → bounce event
  - Handle via bounce/complaint flow
- **Address Status:** Mark address as invalid:
  - Set `is_disabled = true`
  - Set `is_verified = false`
  - Increment bounce count
- **Notification Status:** Mark notification as 'failed' with reason

**Implementation:**
- Address validation service
- Pre-send validation in channel adapters
- Bounce handling updates address status

### 6. Provider Outage

**Scenario:** All retries exhausted, provider (Resend, Twilio) is still down.

**Handling:**
- **Retry Strategy:** Exponential backoff with max retries:
  - Retry 1: Immediate
  - Retry 2: 1 minute
  - Retry 3: 5 minutes
  - Retry 4: 15 minutes
  - Retry 5: 1 hour
  - Max retries: 5 (configurable)
- **Dead Letter Queue:** After max retries:
  - Mark notification as 'failed'
  - Store in `notification_failures` table (optional)
  - Alert admin
  - Allow manual retry via admin UI
- **Circuit Breaker:** Track provider health:
  - If failure rate > threshold → open circuit
  - Skip sending to provider temporarily
  - Retry after cooldown period
- **Status Tracking:** Track in `delivery_attempts`:
  ```json
  [
    { "attempt": 1, "status": "failed", "error": "provider_timeout", "at": "..." },
    { "attempt": 2, "status": "failed", "error": "provider_timeout", "at": "..." }
  ]
  ```

**Implementation:**
- Inngest retry configuration (exponential backoff)
- Circuit breaker pattern for providers
- Dead letter queue table (optional)
- Admin retry endpoint

### 7. Duplicate Events

**Scenario:** Same event sent twice in quick succession (e.g., webhook retry).

**Handling:**
- **Idempotency Key:** Already handled via `idempotencyKey` parameter
- **Event Key Deduplication:** Already handled via `event_key` hash
- **Time Window:** Deduplication window configurable:
  - Default: 5 minutes
  - Configurable per notification type
- **Race Condition:** Database unique constraint prevents duplicates:
  - Unique index on `(user_id, notification_type_id, event_key)`
  - Unique index on `idempotency_key`
- **Webhook Idempotency:** Provider webhooks use `provider_event_id`:
  - Unique constraint prevents duplicate processing
  - Idempotent within 24-hour window

**Implementation:**
- Database unique constraints (already in design)
- Idempotency key validation
- Event key deduplication window

### 8. Clock Skew

**Scenario:** `scheduled_for` timestamp is in the past due to clock differences between servers.

**Handling:**
- **Validation:** Before scheduling, validate `scheduled_for`:
  - If `scheduled_for < NOW() - 5 minutes` → adjust to `NOW()`
  - Log warning: 'scheduled_for_adjusted_clock_skew'
- **Batch Processing:** Process batches where `scheduled_for <= NOW()`
  - Handles past timestamps naturally
  - No special handling needed
- **NTP Sync:** Ensure servers use NTP for clock synchronization
- **Tolerance:** Allow small negative values (e.g., -5 minutes) to account for processing delay

**Implementation:**
- Validation in batch creation
- Adjust past timestamps to NOW()
- Log clock skew warnings
- NTP synchronization (infrastructure)

### 9. Very Long Email

**Scenario:** Email body exceeds provider limits (e.g., 1024KB).

**Handling:**
- **Pre-Send Validation:** Check body length before sending:
  - Email: 1024KB limit (provider-dependent)
  - SMS: 1600 characters (Twilio)
  - Slack: 4000 characters per block
- **Truncation Strategy:**
  - **Email:** Truncate body, add "... (truncated)" footer
  - **SMS:** Split into multiple messages (if supported)
  - **Slack:** Split into multiple blocks
- **Template Design:** Templates should avoid very long content
- **Error Handling:** If exceeds hard limit:
  - Mark notification as 'failed'
  - Log error: 'body_too_long'
  - Alert admin

**Implementation:**
- Body length validation in channel adapters
- Truncation utilities
- Multi-part SMS splitting
- Error logging

### 10. Unicode in SMS

**Scenario:** SMS contains Unicode characters causing encoding issues.

**Handling:**
- **Character Encoding:** Use UTF-8 encoding
- **GSM-7 vs UCS-2:** Detect character set:
  - GSM-7: 160 characters per message
  - UCS-2 (Unicode): 70 characters per message
- **Character Count:** Count characters correctly:
  - Use proper Unicode-aware counting
  - Account for multi-byte characters
- **Provider Handling:** Most providers (Twilio) handle Unicode automatically
- **Fallback:** If encoding fails:
  - Replace unsupported characters with ASCII equivalents
  - Log warning: 'unicode_characters_replaced'

**Implementation:**
- Unicode-aware character counting
- Character set detection (GSM-7 vs UCS-2)
- Character replacement fallback
- Provider-specific encoding

### 11. Timezone Change

**Scenario:** User changes timezone, affecting pending end-of-day batches.

**Handling:**
- **Recalculation:** On timezone change:
  - Find all pending batches with `end_of_day` interval
  - Recalculate `scheduled_for` based on new timezone
  - Update batch records
- **Preference Update:** When `user_notification_preferences.timezone` changes:
  - Trigger recalculation of pending batches
  - Emit Inngest event: 'notification/preference.timezone_changed'
- **Batch Update:** Inngest function:
  - Query pending batches for user
  - Recalculate `scheduled_for` for end-of-day batches
  - Update batch records
- **Notification Update:** Update `scheduled_for` on individual notifications if needed

**Implementation:**
- Timezone change detection in preferences service
- Batch recalculation function
- Update pending batches on timezone change

### 12. Daylight Saving Time (DST)

**Scenario:** End-of-day calculation during DST transition (spring forward, fall back).

**Handling:**
- **Library Usage:** Use timezone-aware libraries (e.g., `date-fns-tz`, `luxon`):
  - Handles DST transitions automatically
  - Correctly calculates end-of-day during transitions
- **Spring Forward:** 2 AM → 3 AM (loses 1 hour)
  - End-of-day still calculated correctly (11:59 PM)
  - No duplicate batches
- **Fall Back:** 2 AM → 1 AM (gains 1 hour)
  - End-of-day still calculated correctly (11:59 PM)
  - No missing batches
- **Testing:** Test DST transitions:
  - Spring forward: March 10, 2024 (US)
  - Fall back: November 3, 2024 (US)
- **Recalculation:** If DST transition occurs between batch creation and send:
  - Batch `scheduled_for` already calculated correctly
  - No recalculation needed

**Implementation:**
- Use `date-fns-tz` or `luxon` for timezone calculations
- Test DST transitions
- No special handling needed (library handles it)

### Additional Edge Cases

### 13. Batch Contains Expired Notifications

**Scenario:** Batch scheduled, but some notifications expired before send.

**Handling:**
- **Pre-Send Filter:** In `processBatch` function:
  - Filter out expired notifications (`expires_at < NOW()`)
  - Mark expired notifications as 'expired'
  - Continue with non-expired notifications
- **Empty Batch:** If all notifications expired:
  - Mark batch as 'cancelled'
  - Log audit event
- **Partial Batch:** If some expired:
  - Continue with remaining notifications
  - Update batch status normally

### 14. User Opts Out Mid-Batch

**Scenario:** User disables notification type while batch is pending.

**Handling:**
- **Pre-Send Check:** Before sending batch:
  - Verify user preference still enabled
  - If disabled → cancel batch, mark notifications as 'cancelled'
- **Preference Change:** When preference disabled:
  - Cancel all pending notifications for that type
  - Cancel all pending batches
  - Log audit event

### 15. Channel Credentials Expired

**Scenario:** OAuth token expired, can't send via channel.

**Handling:**
- **Token Refresh:** Attempt token refresh before sending:
  - Use refresh token to get new access token
  - Retry send with new token
- **Refresh Failure:** If refresh fails:
  - Mark notification as 'failed'
  - Alert admin
  - Disable channel for tenant
- **Credential Status:** Track credential expiry:
  - Check `integrations.access_token_expires_at`
  - Refresh proactively (before expiry)

### 16. Template Rendering Failure

**Scenario:** Template rendering throws error (e.g., missing variable).

**Handling:**
- **Error Handling:** Try-catch around template rendering:
  - Log error with template and metadata
  - Use fallback template
  - Mark notification as 'failed' if fallback fails
- **Fallback Chain:**
  1. Try configured template
  2. Try default template for channel
  3. Try plain text template
  4. Mark as failed
- **Error Logging:** Log template errors:
  - Template ID, error message, metadata
  - Alert admin for template issues

### 17. Batch Aggregation Failure

**Scenario:** Batch aggregation fails (e.g., too many notifications).

**Handling:**
- **Error Handling:** Try-catch around aggregation:
  - Log error
  - Fall back to simple list aggregation
  - If still fails → send individual notifications
- **Size Limits:** Limit batch size:
  - Max notifications per batch (e.g., 100)
  - Split large batches into multiple batches
- **Timeout:** Set timeout on aggregation:
  - If exceeds timeout → use simple aggregation

### 18. Action Processing Failure

**Scenario:** Action handler throws error during processing.

**Handling:**
- **Error Handling:** Try-catch in action processor:
  - Log error with action and notification details
  - Mark action as 'failed'
  - Store error message
- **Retry:** Retry failed actions:
  - Exponential backoff
  - Max retries: 3
- **Manual Retry:** Allow admin to retry failed actions
- **Notification Status:** Don't update notification status if action fails

### 19. Data Access Validation & Content Generation

**Scenario:** User is subscribed but doesn't have access to the data referenced in notification (e.g., customer, email, approval request). Content generation happens at send time (not creation time) due to batching.

**Handling:**
- **Content Generation at Send Time:** Data access is checked during template rendering (not at notification creation):
  - Template rendering happens when batch is processed (send time)
  - Template provider receives `dataAccessChecker` function in render options
  - Template can check data access during rendering
  - If no data access → template returns `hasContent: false`
- **Template Render Result:** Template provider returns `TemplateRenderResult`:
  - `hasContent: boolean` - Whether content was successfully generated
  - `content?: RenderedContent` - Rendered content (only if hasContent = true)
  - `reason?: string` - Why content wasn't generated ('no_data_access', 'empty_content', etc.)
- **Skip Sending:** If `hasContent = false`:
  - Don't send notification
  - Mark notification as 'skipped' status
  - Log audit event with reason
  - Continue with other notifications in batch
- **Empty Batch:** If all notifications in batch have no content:
  - Cancel batch (mark as 'cancelled')
  - Mark all notifications as 'skipped'
- **Permission Check:** Also verify user has `required_permission`:
  - Check permission before template rendering
  - If no permission → return `hasContent: false, reason: 'no_permission'`

**Implementation:**
- Data access check happens during template rendering (send time)
- Template provider receives `dataAccessChecker` function via render options
- Template provider returns `TemplateRenderResult` with `hasContent` flag
- Channel adapter (caller) checks `hasContent` before sending
- If `hasContent = false` → skip sending, mark as 'skipped'
- Logged for audit/debugging purposes

**Why at Send Time:**
- Notifications are batched and sent later
- Data access may change between creation and send
- User permissions may change
- Data may be deleted or access revoked
- Content generation must happen at send time to reflect current state

### 20. Empty/Null Content Scenarios

**Scenario:** Notification would have no content because user doesn't have access to data or data is missing.

**Handling:**
- **Content Generation at Send Time:** Content is generated when batch is processed (send time):
  - Template rendering checks data access via `dataAccessChecker`
  - Template provider returns `hasContent: false` if no data access
  - Template provider returns `hasContent: false` if required data is missing
- **Skip Sending:** If `hasContent = false`:
  - Don't send notification
  - Mark notification as 'skipped' status
  - Log reason ('no_data_access', 'empty_content', 'missing_data')
- **Batch Handling:** If all notifications in batch have no content:
  - Cancel batch (mark as 'cancelled')
  - Mark all notifications as 'skipped'
- **Partial Batch:** If some notifications have content and some don't:
  - Aggregate only notifications with content
  - Send aggregated batch
  - Mark notifications without content as 'skipped'
- **Logging:** Log skipped notifications for debugging:
  - Reason: 'no_data_access', 'empty_content', 'missing_data', etc.
  - User ID, notification type, data context

**Implementation:**
- Content generation happens at send time (during batch processing)
- Template provider returns `TemplateRenderResult` with `hasContent` flag
- Channel adapter (caller) checks `hasContent` before sending
- Notifications without content are marked as 'skipped'
- Audit log tracks skipped notifications with reason

### Edge Cases Summary Table

| Edge Case | Detection Point | Handling Strategy | Status Update | Retry? |
|-----------|----------------|-------------------|---------------|--------|
| User deleted mid-fanout | Before notification creation, before send | Cancel notifications, remove from batches | 'cancelled' | No |
| Tenant suspended | Before notification creation, before send | Cancel all notifications, cancel batches | 'cancelled' | No |
| User has no data access | During template rendering (send time) | Template returns hasContent=false, skip sending | 'skipped' | No |
| User lost permission | During template rendering (send time) | Template returns hasContent=false, reason='no_permission' | 'skipped' | No |
| Channel disabled mid-batch | Before send per channel | Partial success, continue other channels | 'partially_sent' | No |
| Template missing | Template loading | Use fallback template | Continue | No |
| Invalid channel address | Pre-send validation, provider bounce | Mark address disabled, skip notification | 'failed' | No |
| Provider outage | Send attempt, retries exhausted | Dead letter queue, circuit breaker | 'failed' | Yes (5 retries) |
| Duplicate events | Idempotency key check, event key check | Skip duplicate, use existing | Continue | No |
| Clock skew | Batch creation | Adjust past timestamps to NOW() | Continue | No |
| Very long email | Pre-send validation | Truncate body, add footer | Continue | No |
| Unicode in SMS | Character encoding | Detect GSM-7 vs UCS-2, count correctly | Continue | No |
| Timezone change | Preference update | Recalculate end-of-day batches | Update `scheduled_for` | No |
| DST transition | Timezone calculation | Library handles automatically | Continue | No |
| Batch contains expired | Batch processing | Filter expired, mark as 'expired' | 'expired' | No |
| User opts out mid-batch | Batch processing | Cancel batch, cancel notifications | 'cancelled' | No |
| Channel credentials expired | Before send | Refresh token, retry send | Continue | Yes (1 retry) |
| Template rendering failure | Template rendering | Use fallback template | Continue | No |
| Batch aggregation failure | Aggregation step | Use simple list aggregation | Continue | No |
| Action processing failure | Action handler | Mark action failed, allow retry | 'failed' | Yes (3 retries) |

**Key Principles:**
- **Fail-safe:** Always verify user/tenant exists before processing
- **Best-effort:** Continue processing other items if one fails (batches)
- **Fallback chains:** Template → default → plain text → fail
- **Retry strategy:** Exponential backoff, configurable max retries
- **Dead letter queue:** Store unrecoverable failures for manual review
- **Circuit breaker:** Stop sending to unhealthy providers temporarily

---

## Feedback Addressed

### 🔴 Critical Gaps - RESOLVED

1. ✅ **User Channel Configuration Table** - Added `user_channel_addresses` table
   - Stores Slack IDs, phone numbers, device tokens
   - Verification status tracking
   - Bounce/complaint tracking per address
   - Auto-disable after threshold

2. ✅ **Bounce/Complaint Handling** - Full webhook integration
   - Webhook endpoints for provider callbacks
   - `notification_bounce_complaints` table
   - Auto-disable after 3 hard bounces or 1 complaint
   - Idempotent webhook processing

3. ✅ **Package Location** - Clarified as `packages/notifications/`
   - Pluggable package for reuse across applications
   - Applications integrate via dependency injection

4. ✅ **Idempotency for notify()** - Added `idempotencyKey` parameter
   - Prevents duplicate fan-outs on retries
   - Unique constraint on `idempotency_key`
   - Separate from event deduplication

### 🟡 Important Improvements - RESOLVED

5. ✅ **Priority/Urgency Levels** - Full priority support
   - `priority` field: 'critical', 'high', 'normal', 'low'
   - Critical bypasses batching, high overrides preferences
   - Configurable per notification type

6. ✅ **Notification Expiry** - Configurable expiry
   - `expires_at` timestamp on notifications
   - Default from notification type config
   - Cron job marks expired notifications
   - Skipped during batch processing

7. ✅ **Timezone Storage** - Clarified
   - Stored in `user_notification_preferences.timezone`
   - Falls back to `users.timezone` if not set
   - Used for quiet hours and end-of-day calculations

### 🟢 Minor Improvements - RESOLVED

8. ✅ **Audit Log Table** - Added `notification_audit_log`
   - Comprehensive lifecycle event tracking
   - Preference changes, address updates
   - Immutable append-only log

9. ✅ **Read Status** - Added `read_at` timestamp
   - Tracks notification read/unread status
   - Essential for in-app notification center
   - Efficient unread queries via index

10. ✅ **Template Preview API** - Added preview endpoint
    - `POST /api/notifications/templates/:templateId/preview`
    - Returns rendered HTML, text, Slack blocks
    - Supports test sends during development

11. ✅ **Webhook Retry Configuration** - Documented
    - Idempotency via `provider_event_id`
    - Unique constraint prevents duplicate processing
    - Retry handling via Inngest

12. ✅ **Schema Missing Fields** - Added all timestamps
    - `created_at`, `updated_at` on all tables
    - `channel` field on notifications (clarified)
    - All fields documented

13. ✅ **Localization/i18n** - Full i18n support
    - `locale` field on notifications
    - Template variants per locale
    - Locale-aware formatting (dates, numbers, currency)
    - Falls back to default locale

---

## Summary

This architecture provides:

✅ **Scalable** - Handles millions of notifications with batching and async processing  
✅ **Maintainable** - Clear separation of concerns, follows existing codebase patterns  
✅ **Extensible** - Easy to add new channels, notification types, and actions  
✅ **Secure** - Tenant isolation, authentication, rate limiting, signed tokens  
✅ **User-Centric** - Granular preferences, batching, quiet hours  
✅ **Actionable** - Support for batch actions with transactional processing  
✅ **Template-Driven** - Rich templates with react-email, channel-specific adapters  

The design follows existing codebase patterns:
- Repository → Service → Routes architecture
- Inngest for async processing (consistent with email analysis)
- Zod for validation (consistent with API conventions)
- Integration pattern for channel credentials (consistent with Gmail)
- RequestHeader for tenant/user context (consistent with all APIs)

The system is designed to integrate seamlessly with existing modules (email analysis, approvals, escalations) and can be extended with new notification types and channels as needed.

### Pluggability Features

**Template Provider:**
- ✅ Abstract interface for template storage
- ✅ Default: FilesystemTemplateProvider
- ✅ Alternative: DatabaseTemplateProvider, RemoteTemplateProvider
- ✅ Projects can provide custom implementations
- ✅ No filesystem coupling in core logic

**User Resolver:**
- ✅ Abstract interface for user/tenant data access
- ✅ Default: DatabaseUserResolver (CRM-specific)
- ✅ Alternative: ApiUserResolver, GraphQLUserResolver
- ✅ Projects can provide custom implementations
- ✅ No direct database coupling in core logic

**Benefits:**
- Package is framework-agnostic
- Reusable across different projects
- Easy to test (mock interfaces)
- Flexible deployment (filesystem, database, remote templates)
- Supports microservices architecture (API-based user resolver)

### Subscription Management Features

**UI Integration:**
- ✅ Complete API endpoints for subscription management
- ✅ List available notification types with subscription status
- ✅ Subscribe/unsubscribe endpoints
- ✅ Bulk update subscriptions
- ✅ Subscription statistics

**Auto-Subscription:**
- ✅ Permission-based auto-subscription only (no roles)
- ✅ Single `required_permission` per notification type
- ✅ Conditional auto-subscription (e.g., has customers, has manager)
- ✅ Auto-subscribe when new notification types created (users with matching permission)
- ✅ Track subscription source (manual vs auto)
- ✅ Permission required even for manual subscriptions

**Refresh System:**
- ✅ Refresh user subscriptions based on current permissions
- ✅ Refresh all users (admin endpoint)
- ✅ Refresh for specific notification type
- ✅ Respects manual subscriptions (never auto-unsubscribe)
- ✅ Updates auto-subscriptions dynamically

**Data Access Validation:**
- ✅ Content generation happens at send time (not creation time)
- ✅ Data access checked during template rendering via `dataAccessChecker`
- ✅ Template provider returns `hasContent` flag in `TemplateRenderResult`
- ✅ Skip sending if `hasContent = false` (mark as 'skipped')
- ✅ Channel adapter (caller) sends content, template provider only generates
- ✅ Batch processing filters out notifications without content

**Key Features:**
- Permission-based subscriptions only (no roles)
- Manual subscriptions take precedence over auto-subscriptions
- Content generation at send time (not creation time)
- Data access checked during template rendering
- Template provider generates content, channel adapter sends content
- Skip sending if `hasContent = false` (mark as 'skipped')
- Auto-subscriptions updated when roles/permissions change
- Users can override auto-subscriptions (subscribe/unsubscribe manually)
- Refresh endpoints keep subscriptions in sync with RBAC

---

## Key Design Answers

### 1. Data Payload vs Template API Queries

**Answer:** Hybrid approach - Full data payload by default, optional API queries

- **Default:** Caller provides complete data payload in `metadata` field (all template variables)
- **Optional:** Templates can query APIs via `dataLoader` function if enabled in notification type config
- **Configuration:** `notification_types.template_config.data_loader_enabled` boolean
- **Performance:** API queries add latency - prefer full payload when possible
- **Use Case:** Complex templates needing fresh data can use `dataLoader`, simple templates use full payload

### 2. Unified Batching Mechanism (End-of-Day)

**Answer:** All batching modes use the same `scheduled_for` (releaseAt) mechanism

- **No special logic for end-of-day** - It's just a calculated `scheduled_for` timestamp
- **Unified calculation:** End-of-day = calculate end of day in user's timezone → convert to UTC
- **Single cron job** processes all batches where `scheduled_for <= NOW()`
- **Consistent behavior:** Minutes, hours, end-of-day all use same processing logic
- **Benefits:** Simpler code, easier to maintain, consistent behavior

### 3. Externalized Configuration

**Answer:** Templates and channels configurable externally via database

- **Templates:** Stored in codebase (version controlled), but configuration in database
- **Configuration:** `notification_types.template_config` JSONB field stores:
  - Channel → template path/ID mapping
  - Template version
  - Data loader configuration
  - Variable mapping (metadata keys → template variables)
- **Benefits:** Copy codebase, configure templates without code changes
- **Template Registry:** Maps `(notification_type, channel)` → template path/ID
- **Future:** Can store template content in database or external service

### 4. Event Modification Before Batch Release

**Answer:** Configurable deduplication strategy per notification type

- **Event Key:** Hash of specified metadata fields (configurable per type)
- **Strategies:** Configurable in `notification_types.deduplication_config`:
  - **overwrite** - Update existing pending notification with new data, reset `scheduled_for`
  - **create_new** - Create new notification (allow duplicates)
  - **ignore** - Skip if duplicate exists
- **Update Window:** Configurable time window (e.g., 60 minutes) to consider for updates
- **Example:** Approval requests use 'overwrite' (latest status), escalations use 'create_new' (track all)

### 5. Engagement Tracking (Opens/Clicks)

**Answer:** Full engagement tracking with opens and clicks

- **Open Tracking:**
  - Email: 1x1 transparent tracking pixel
  - Updates `notifications.engagement.opened_at` and `opened_count`
  - Tracks first open and total opens
- **Click Tracking:**
  - All links wrapped with tracking URLs
  - Updates `notifications.engagement.clicked_at`, `clicked_count`, and `clicked_links`
  - Tracks first click, total clicks, and which URLs clicked
- **Analytics:**
  - Open rate, click rate, click-through rate
  - Time to open/click
  - Used for A/B testing and optimization
- **Storage:** `notifications.engagement` JSONB field + optional `notification_engagement_events` table for detailed events
