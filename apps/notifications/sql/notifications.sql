-- =============================================================================
-- Notifications Table
-- =============================================================================
-- Individual notification records for history/audit
-- DEPENDENCIES: Run after tenants.sql, users.sql, notification_batches.sql
-- =============================================================================

DROP TABLE IF EXISTS notifications CASCADE;

CREATE TABLE notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    template_name VARCHAR(100) NOT NULL,

    -- Content
    title VARCHAR(255) NOT NULL,
    body TEXT NOT NULL,
    metadata JSONB DEFAULT '{}'::jsonb,

    -- Delivery state
    status VARCHAR(20) NOT NULL DEFAULT 'pending', -- 'pending', 'sent', 'failed', 'skipped'
    priority VARCHAR(20) DEFAULT 'normal',
    scheduled_for TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    sent_at TIMESTAMPTZ,
    read_at TIMESTAMPTZ,

    -- Batching
    batch_id UUID REFERENCES notification_batches(id) ON DELETE SET NULL,
    channel VARCHAR(50),

    -- Deduplication
    event_key VARCHAR(255),
    idempotency_key VARCHAR(255),

    -- Delivery tracking
    delivery_attempts JSONB DEFAULT '[]'::jsonb,

    -- Metadata
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_notifications_user ON notifications(user_id);
CREATE INDEX idx_notifications_template ON notifications(template_name);
CREATE INDEX idx_notifications_status ON notifications(status, scheduled_for) WHERE status = 'pending';
CREATE INDEX idx_notifications_batch ON notifications(batch_id);
CREATE INDEX idx_notifications_read ON notifications(read_at) WHERE read_at IS NULL;
CREATE UNIQUE INDEX idx_notifications_idempotency ON notifications(idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE UNIQUE INDEX idx_notifications_event_key ON notifications(user_id, template_name, event_key) WHERE event_key IS NOT NULL;
CREATE INDEX idx_notifications_channel ON notifications(channel);
