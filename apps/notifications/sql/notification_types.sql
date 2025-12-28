-- =============================================================================
-- Notification Types Table
-- =============================================================================
-- Defines available notification types in the system
-- DEPENDENCIES: Run after tenants.sql
-- =============================================================================

DROP TABLE IF EXISTS notification_types CASCADE;

CREATE TABLE notification_types (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    
    -- Type identification
    name VARCHAR(100) NOT NULL, -- e.g., "escalation_alert"
    description TEXT,
    category VARCHAR(50), -- 'alerts', 'approvals', 'digests', 'system'
    
    -- Default configuration
    default_channels JSONB NOT NULL DEFAULT '[]'::jsonb, -- Array of channel names
    default_frequency VARCHAR(20) NOT NULL DEFAULT 'immediate', -- 'immediate' | 'batched'
    default_batch_interval JSONB, -- { type: 'minutes', value: 15 } or null for immediate
    
    -- Permission-based subscription
    required_permission VARCHAR(100), -- Permission string required to receive this notification
    auto_subscribe_enabled BOOLEAN DEFAULT false,
    subscription_conditions JSONB, -- { hasCustomers?: boolean, hasManager?: boolean }
    
    -- Features
    requires_action BOOLEAN NOT NULL DEFAULT false,
    default_expires_after_hours INTEGER, -- Default expiry time, null for no expiry
    default_priority VARCHAR(20) DEFAULT 'normal', -- 'critical', 'high', 'normal', 'low'
    
    -- Template configuration
    template_config JSONB, -- { channels: {...}, data_loader_enabled: boolean, variable_mapping: {...} }
    
    -- Deduplication configuration
    deduplication_config JSONB, -- { strategy: 'overwrite'|'create_new'|'ignore', event_key_fields: [...], update_window_minutes: number }
    
    -- Metadata
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    CONSTRAINT uniq_notification_types_tenant_name UNIQUE (tenant_id, name)
);

CREATE INDEX idx_notification_types_tenant ON notification_types(tenant_id);
CREATE INDEX idx_notification_types_active ON notification_types(tenant_id, is_active);
CREATE INDEX idx_notification_types_permission ON notification_types(required_permission) WHERE required_permission IS NOT NULL;
