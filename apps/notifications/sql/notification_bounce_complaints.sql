-- =============================================================================
-- Notification Bounce Complaints Table
-- =============================================================================
-- Tracks email bounces and spam complaints from providers
-- DEPENDENCIES: Run after users.sql and user_channel_addresses.sql
-- =============================================================================

DROP TABLE IF EXISTS notification_bounce_complaints CASCADE;

CREATE TABLE notification_bounce_complaints (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    channel_address_id UUID REFERENCES user_channel_addresses(id) ON DELETE SET NULL,
    
    -- Event details
    email_address VARCHAR(255), -- Email that bounced/complained
    event_type VARCHAR(50) NOT NULL, -- 'hard_bounce', 'soft_bounce', 'complaint', 'unsubscribe'
    provider VARCHAR(50) NOT NULL, -- 'resend', 'sendgrid', etc.
    provider_event_id VARCHAR(255) NOT NULL, -- Provider's event ID for idempotency
    reason TEXT, -- Bounce/complaint reason
    metadata JSONB, -- Provider-specific data
    
    -- Processing
    processed BOOLEAN DEFAULT false,
    processed_at TIMESTAMPTZ,
    
    -- Metadata
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    CONSTRAINT uniq_notification_bounce_complaints_provider UNIQUE (provider, provider_event_id)
);

CREATE INDEX idx_notification_bounce_complaints_user ON notification_bounce_complaints(user_id);
CREATE INDEX idx_notification_bounce_complaints_email ON notification_bounce_complaints(email_address);
CREATE INDEX idx_notification_bounce_complaints_processed ON notification_bounce_complaints(processed) WHERE processed = false;
CREATE INDEX idx_notification_bounce_complaints_event ON notification_bounce_complaints(event_type);
