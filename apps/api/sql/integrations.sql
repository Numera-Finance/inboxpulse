-- Drop table
DROP TABLE IF EXISTS integrations CASCADE;

-- Drop enums
DROP TYPE IF EXISTS integration_auth_type CASCADE;
DROP TYPE IF EXISTS integration_source CASCADE;

-- Create enums
CREATE TYPE integration_source AS ENUM ('gmail', 'outlook', 'slack', 'other');
CREATE TYPE integration_auth_type AS ENUM ('oauth', 'service_account', 'api_key');

-- Integrations table
CREATE TABLE IF NOT EXISTS integrations (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL,
    source integration_source NOT NULL,
    auth_type integration_auth_type NOT NULL,
    parameters JSONB NOT NULL,
    -- OAuth tokens (new fields)
    access_token TEXT,
    refresh_token TEXT,
    access_token_expires_at TIMESTAMP,
    -- Legacy fields (backward compatibility)
    token TEXT,
    token_expires_at TIMESTAMP,
    -- Gmail Watch tracking
    watch_set_at TIMESTAMP,
    watch_expires_at TIMESTAMP,
    -- Run state
    last_run_token TEXT,
    last_run_at TIMESTAMP,
    -- Metadata
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    last_used_at TIMESTAMP,
    -- Audit fields
    created_by UUID,
    updated_by UUID,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
