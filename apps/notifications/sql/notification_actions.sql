-- =============================================================================
-- Notification Actions Table
-- =============================================================================
-- Tracks actions taken on notifications
-- DEPENDENCIES: Run after notifications.sql and notification_batch_actions.sql
-- =============================================================================

DROP TABLE IF EXISTS notification_actions CASCADE;

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
