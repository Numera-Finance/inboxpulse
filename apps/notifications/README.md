# Notifications Service

Standalone notification service for the CRM system.

## Overview

This is a microservice that handles all notification-related functionality:
- Sending notifications via multiple channels (email, Slack, GChat, SMS, mobile push)
- Batching notifications (immediate, minutes, hours, end-of-day)
- User preferences management
- Actionable notifications
- Template rendering

## Running

```bash
# Development
pnpm dev

# Production
pnpm build
pnpm start
```

## Environment Variables

Required:
- `DATABASE_URL` - PostgreSQL connection string

Optional:
- `PORT` - Server port (default: 4004)
- `LOG_LEVEL` - Logging level (default: info)
- `WEB_URL` - Frontend URL for CORS

## API Endpoints

All endpoints require authentication headers:
- `x-tenant-id` - Tenant ID
- `x-user-id` - User ID
- `x-permissions` - Comma-separated permissions

### Health Check
- `GET /health` - Health check endpoint

### Notifications
- `POST /api/notifications/send` - Send notification (fan-out)
- `GET /api/notifications/notifications` - Get user notifications
- `POST /api/notifications/notifications/:id/read` - Mark as read
- `POST /api/notifications/notifications/:id/action` - Perform action
- `POST /api/notifications/notifications/batch-action` - Batch action

### Types
- `GET /api/notifications/types` - List notification types
- `POST /api/notifications/types` - Create notification type

### Preferences
- `PUT /api/notifications/preferences/:typeId` - Update preferences
- `POST /api/notifications/subscribe` - Subscribe to type

## Architecture

- Uses `@crm/notifications` package for core functionality
- Pluggable template providers (filesystem, database, remote)
- Pluggable user resolvers
- Channel adapters for each notification channel
- Inngest for async processing

## Database

Shares the same database as the main API app. Notification tables are created via SQL migrations in `apps/notifications/sql/` folder.

See `apps/notifications/sql/README.md` for execution order and details.
