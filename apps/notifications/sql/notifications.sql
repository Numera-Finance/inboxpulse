-- =============================================================================
-- Notifications Table
-- =============================================================================
-- Individual notification records (before batching/delivery)
-- DEPENDENCIES: Run after notification_types.sql, users.sql, notification_batches.sql
-- =============================================================================

DROP TABLE IF EXISTS notifications CASCADE;

CREATE TABLE notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    notification_type_id UUID NOT NULL REFERENCES notification_types(id) ON DELETE CASCADE,
    
    -- Content (generated at send time, stored after rendering)
    title VARCHAR(255) NOT NULL,
    body TEXT NOT NULL, -- Rendered template content (channel-specific)
    metadata JSONB DEFAULT '{}'::jsonb, -- Additional context for templates/actions
    
    -- Actionable items (if requires_action = true)
    action_items JSONB, -- [{ id: "item-1", type: "approval", data: {...} }]
    
    -- Delivery state
    status VARCHAR(20) NOT NULL DEFAULT 'pending', -- 'pending', 'batched', 'sent', 'failed', 'cancelled', 'expired', 'skipped', 'read'
    priority VARCHAR(20) DEFAULT 'normal', -- 'critical', 'high', 'normal', 'low'
    scheduled_for TIMESTAMPTZ, -- When to send (for batching - unified releaseAt)
    expires_at TIMESTAMPTZ, -- Skip sending if expired
    sent_at TIMESTAMPTZ,
    read_at TIMESTAMPTZ, -- When user marked as read
    
    -- Batching
    batch_id UUID REFERENCES notification_batches(id) ON DELETE SET NULL,
    channel VARCHAR(50), -- Channel this notification is for
    
    -- Deduplication
    event_key VARCHAR(255), -- Hash of event identifier (for deduplication)
    event_version INTEGER, -- For tracking event modifications
    idempotency_key VARCHAR(255), -- For idempotent notify() calls
    
    -- Delivery tracking
    delivery_attempts JSONB DEFAULT '[]'::jsonb, -- [{ channel: 'email', attempted_at: ..., status: 'sent'|'failed', error: ... }]
    
    -- Engagement tracking
    engagement JSONB, -- { opened_at: ..., opened_count: ..., clicked_at: ..., clicked_count: ..., clicked_links: [...] }
    
    -- Localization
    locale VARCHAR(10), -- e.g., 'en-US', 'es-ES', inherits from user
    
    -- Metadata
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_notifications_user ON notifications(user_id);
CREATE INDEX idx_notifications_type ON notifications(notification_type_id);
CREATE INDEX idx_notifications_status ON notifications(status, scheduled_for) WHERE status IN ('pending', 'batched');
CREATE INDEX idx_notifications_batch ON notifications(batch_id);
CREATE INDEX idx_notifications_scheduled ON notifications(scheduled_for) WHERE scheduled_for IS NOT NULL;
CREATE INDEX idx_notifications_expires ON notifications(expires_at) WHERE expires_at IS NOT NULL;
CREATE INDEX idx_notifications_read ON notifications(read_at) WHERE read_at IS NULL;
CREATE INDEX idx_notifications_priority ON notifications(priority);
CREATE UNIQUE INDEX idx_notifications_idempotency ON notifications(idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE UNIQUE INDEX idx_notifications_event_key ON notifications(user_id, notification_type_id, event_key) WHERE event_key IS NOT NULL;
CREATE INDEX idx_notifications_channel ON notifications(channel);
