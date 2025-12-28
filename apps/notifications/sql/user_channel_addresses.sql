-- =============================================================================
-- User Channel Addresses Table
-- =============================================================================
-- Stores user-specific channel addresses (Slack ID, phone number, device tokens, etc.)
-- DEPENDENCIES: Run after users.sql
-- =============================================================================

DROP TABLE IF EXISTS user_channel_addresses CASCADE;

CREATE TABLE user_channel_addresses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    channel VARCHAR(50) NOT NULL, -- 'slack', 'sms', 'mobile_push', 'gchat'
    address VARCHAR(255) NOT NULL, -- Slack user ID, phone number, device token, etc.
    
    -- Verification and status
    is_verified BOOLEAN DEFAULT false,
    verified_at TIMESTAMPTZ,
    bounce_count INTEGER DEFAULT 0, -- Hard bounces for email
    complaint_count INTEGER DEFAULT 0, -- Spam complaints
    is_disabled BOOLEAN DEFAULT false, -- Disabled due to bounces/complaints
    
    -- Channel-specific metadata
    metadata JSONB, -- e.g., { deviceType: 'ios', appVersion: '1.0.0' } for push
    
    -- Metadata
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    CONSTRAINT uniq_user_channel_addresses UNIQUE (tenant_id, user_id, channel)
);

CREATE INDEX idx_user_channel_addresses_user ON user_channel_addresses(user_id);
CREATE INDEX idx_user_channel_addresses_channel ON user_channel_addresses(channel, is_disabled) WHERE is_disabled = false;
CREATE INDEX idx_user_channel_addresses_verified ON user_channel_addresses(is_verified) WHERE is_verified = true;
