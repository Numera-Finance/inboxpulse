-- =============================================================================
-- Notification Batches Table
-- =============================================================================
-- Groups notifications for batch delivery
-- DEPENDENCIES: Run after notification_types.sql and users.sql
-- =============================================================================

DROP TABLE IF EXISTS notification_batches CASCADE;

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
