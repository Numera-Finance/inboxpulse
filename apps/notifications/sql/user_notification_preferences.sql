-- =============================================================================
-- User Notification Preferences Table
-- =============================================================================
-- User-specific preferences for each notification template
-- Templates are defined in code (not in database), referenced by template_name
-- DEPENDENCIES: Run after tenants.sql and users.sql
-- =============================================================================

DROP TABLE IF EXISTS user_notification_preferences CASCADE;

CREATE TABLE user_notification_preferences (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    template_name VARCHAR(100) NOT NULL,

    -- Preference settings
    enabled BOOLEAN NOT NULL DEFAULT true,
    channels JSONB NOT NULL DEFAULT '[]'::jsonb,
    frequency VARCHAR(20) NOT NULL DEFAULT 'immediate', -- 'immediate' | 'batched'
    batch_interval JSONB, -- { type: 'daily', time: '08:00' } or { type: 'hours', value: 4 }
    payload JSONB, -- Template-specific settings

    -- Batch scheduling
    last_sent_at TIMESTAMPTZ,
    next_send_at TIMESTAMPTZ,

    -- Metadata
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Unique constraint: one preference per user per template
CREATE UNIQUE INDEX uniq_user_notification_preferences_template
    ON user_notification_preferences(user_id, template_name);

-- Query indexes
CREATE INDEX idx_user_notification_preferences_user
    ON user_notification_preferences(user_id);

CREATE INDEX idx_user_notification_preferences_template_name
    ON user_notification_preferences(template_name);

-- Batch scheduling: find users due for batch notifications
CREATE INDEX idx_user_notification_preferences_batch_due
    ON user_notification_preferences(template_name, next_send_at)
    WHERE enabled = true AND frequency = 'batched';
