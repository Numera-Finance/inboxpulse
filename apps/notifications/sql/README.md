# Notification Database Schema

This directory contains SQL schema files for notification tables.

## Execution Order

Execute files in the following order to set up notification tables:

1. **notification_types.sql** - Create notification_types table
2. **user_notification_preferences.sql** - Create user_notification_preferences table
3. **notification_batches.sql** - Create notification_batches table
4. **notifications.sql** - Create notifications table
5. **notification_actions.sql** - Create notification_actions table
6. **notification_batch_actions.sql** - Create notification_batch_actions table
7. **user_channel_addresses.sql** - Create user_channel_addresses table
8. **notification_audit_log.sql** - Create notification_audit_log table
9. **notification_bounce_complaints.sql** - Create notification_bounce_complaints table

## Prerequisites

These tables depend on the following tables from the main database:
- `tenants` table (from API app)
- `users` table (from API app)

Make sure these tables exist before running notification migrations.

## Command Line Execution

```bash
# Execute all files in order
psql $DATABASE_URL -f apps/notifications/sql/notification_types.sql
psql $DATABASE_URL -f apps/notifications/sql/user_notification_preferences.sql
psql $DATABASE_URL -f apps/notifications/sql/notification_batches.sql
psql $DATABASE_URL -f apps/notifications/sql/notifications.sql
psql $DATABASE_URL -f apps/notifications/sql/notification_actions.sql
psql $DATABASE_URL -f apps/notifications/sql/notification_batch_actions.sql
psql $DATABASE_URL -f apps/notifications/sql/user_channel_addresses.sql
psql $DATABASE_URL -f apps/notifications/sql/notification_audit_log.sql
psql $DATABASE_URL -f apps/notifications/sql/notification_bounce_complaints.sql
```

Or in PostgreSQL interactive mode (from project root):

```sql
\i apps/notifications/sql/notification_types.sql
\i apps/notifications/sql/user_notification_preferences.sql
\i apps/notifications/sql/notification_batches.sql
\i apps/notifications/sql/notifications.sql
\i apps/notifications/sql/notification_actions.sql
\i apps/notifications/sql/notification_batch_actions.sql
\i apps/notifications/sql/user_channel_addresses.sql
\i apps/notifications/sql/notification_audit_log.sql
\i apps/notifications/sql/notification_bounce_complaints.sql
```

## Notes

- Each file includes `DROP TABLE IF EXISTS` statements for idempotency
- All notification tables reference `tenants` and `users` tables
- Foreign keys use `ON DELETE CASCADE` for tenant/user deletions
- Indexes are created for common query patterns
