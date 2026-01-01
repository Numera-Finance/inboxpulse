-- =============================================================================
-- Seed Notification Types
-- =============================================================================
-- Creates the two fixed notification types used by the CRM
-- Run this after notification_types.sql and for each tenant
-- =============================================================================

-- Note: You need to replace {TENANT_ID} with the actual tenant ID
-- Example: Run with: psql $DATABASE_URL -v tenant_id="'your-tenant-uuid'" -f seed_notification_types.sql

-- Task Assignment Notification
INSERT INTO notification_types (
    tenant_id,
    name,
    description,
    category,
    default_channels,
    default_frequency,
    is_active
) VALUES (
    :tenant_id::uuid,
    'task.assigned',
    'Notification when a task/escalation is assigned to you',
    'tasks',
    '["email"]'::jsonb,
    'immediate',
    true
) ON CONFLICT (tenant_id, name) DO NOTHING;

-- Escalation Summary Notification
INSERT INTO notification_types (
    tenant_id,
    name,
    description,
    category,
    default_channels,
    default_frequency,
    default_batch_interval,
    is_active
) VALUES (
    :tenant_id::uuid,
    'escalation.summary',
    'Periodic summary of open escalations for your team',
    'escalations',
    '["email"]'::jsonb,
    'batched',
    '{"type": "daily", "time": "08:00"}'::jsonb,
    true
) ON CONFLICT (tenant_id, name) DO NOTHING;
