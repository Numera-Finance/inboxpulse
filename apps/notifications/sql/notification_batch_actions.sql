-- =============================================================================
-- Notification Batch Actions Table
-- =============================================================================
-- Groups multiple actions for batch processing (transactional)
-- DEPENDENCIES: Run after users.sql
-- =============================================================================

DROP TABLE IF EXISTS notification_batch_actions CASCADE;

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
