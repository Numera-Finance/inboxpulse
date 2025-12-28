-- =============================================================================
-- Notification Audit Log Table
-- =============================================================================
-- Audit trail for notification lifecycle events and configuration changes
-- DEPENDENCIES: Run after tenants.sql and users.sql
-- =============================================================================

DROP TABLE IF EXISTS notification_audit_log CASCADE;

CREATE TABLE notification_audit_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    
    -- Event details
    event_type VARCHAR(50) NOT NULL, -- 'notification_created', 'notification_sent', 'notification_failed', 'preference_updated', etc.
    entity_type VARCHAR(50) NOT NULL, -- 'notification', 'preference', 'channel_address', etc.
    entity_id UUID, -- ID of the entity
    
    -- User context
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    
    -- Change tracking
    changes JSONB, -- { before: {...}, after: {...} } for updates
    metadata JSONB, -- Additional context
    
    -- Metadata
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_notification_audit_log_tenant ON notification_audit_log(tenant_id);
CREATE INDEX idx_notification_audit_log_entity ON notification_audit_log(entity_type, entity_id);
CREATE INDEX idx_notification_audit_log_user ON notification_audit_log(user_id);
CREATE INDEX idx_notification_audit_log_created ON notification_audit_log(created_at);
CREATE INDEX idx_notification_audit_log_event ON notification_audit_log(event_type);
