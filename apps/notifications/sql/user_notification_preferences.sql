-- =============================================================================
-- User Notification Preferences Table
-- =============================================================================
-- User-specific preferences for each notification type
-- DEPENDENCIES: Run after notification_types.sql and users.sql
-- =============================================================================

DROP TABLE IF EXISTS user_notification_preferences CASCADE;

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
