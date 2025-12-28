# @crm/notifications

A pluggable, scalable notification system supporting multiple channels, batching, templating, and actionable notifications.

## Features

- **Multiple Channels**: Email, Slack, Google Chat, SMS, Mobile Push
- **Batching**: Immediate, minutes, hours, or end-of-day delivery
- **Templating**: Pluggable template providers (filesystem, database, remote)
- **User Preferences**: Per-user channel and frequency preferences
- **Actionable Notifications**: Approve/reject actions with batch support
- **Fan-out Pattern**: Automatic distribution to all subscribers
- **Deduplication**: Configurable event deduplication strategies
- **Multi-tenancy**: Full tenant isolation
- **Audit Logging**: Complete audit trail

## Installation

```bash
pnpm add @crm/notifications
```

## Quick Start

### 1. Create Database Schemas

```typescript
import { createNotificationSchemas } from '@crm/notifications/schemas';
import { tenants, users } from './your-schemas';

const notificationSchemas = createNotificationSchemas(tenants, users);
```

### 2. Register Dependencies

```typescript
import { container } from 'tsyringe';
import { FilesystemTemplateProvider } from '@crm/notifications/providers';
import { NotificationService } from '@crm/notifications/services';
import { YourUserResolver } from './your-user-resolver';

// Register template provider
container.register('TemplateProvider', {
  useValue: new FilesystemTemplateProvider({ basePath: './templates' })
});

// Register user resolver
container.register('UserResolver', {
  useValue: new YourUserResolver(db)
});

// Register services
container.register('NotificationService', NotificationService);
```

### 3. Send Notification

```typescript
const notificationService = container.resolve(NotificationService);

await notificationService.sendNotification({
  tenantId: '...',
  notificationType: 'escalation_alert',
  data: { customerId: '...', message: '...' },
  idempotencyKey: 'unique-key',
}, header);
```

## Architecture

See `/docs/NOTIFICATIONS_MODULE_ARCHITECTURE.md` and `/docs/NOTIFICATIONS_MODULE_IMPLEMENTATION.md` for detailed architecture and implementation guides.

## Database Setup

Run SQL files from `/sql` folder in order:

1. `notification_types.sql`
2. `user_notification_preferences.sql`
3. `notification_batches.sql`
4. `notifications.sql`
5. `notification_actions.sql`
6. `notification_batch_actions.sql`
7. `user_channel_addresses.sql`
8. `notification_audit_log.sql`
9. `notification_bounce_complaints.sql`

## License

Private
