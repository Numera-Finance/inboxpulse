DROP TABLE IF EXISTS email_threads CASCADE;

-- Email threads table (provider-agnostic)
CREATE TABLE IF NOT EXISTS email_threads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),

    -- Provider info (provider can be derived from integration_id via integrations table)
    integration_id UUID NOT NULL REFERENCES integrations(id),
    provider_thread_id VARCHAR(500) NOT NULL, -- provider's thread identifier

    -- Thread metadata
    subject TEXT NOT NULL,

    -- Timestamps
    first_message_at TIMESTAMP NOT NULL,
    last_message_at TIMESTAMP NOT NULL,
    message_count INTEGER NOT NULL DEFAULT 0,

    -- Provider-specific data
    metadata JSONB,

    -- Tracking
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),

    -- Unique constraint per integration (integration_id already implies provider)
    CONSTRAINT uniq_thread_tenant_integration UNIQUE (tenant_id, integration_id, provider_thread_id)
);

-- Indexes
CREATE INDEX idx_threads_tenant_last_message ON email_threads(tenant_id, last_message_at DESC);
CREATE INDEX idx_threads_integration_thread ON email_threads(integration_id, provider_thread_id);
CREATE INDEX idx_threads_integration ON email_threads(integration_id);
