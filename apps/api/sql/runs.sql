-- Drop table
DROP TABLE IF EXISTS runs CASCADE;

-- Drop enums
DROP TYPE IF EXISTS run_type CASCADE;
DROP TYPE IF EXISTS run_status CASCADE;

-- Create enums
CREATE TYPE run_status AS ENUM ('running', 'completed', 'failed');
CREATE TYPE run_type AS ENUM ('initial', 'incremental', 'historical', 'webhook');

-- Runs table
CREATE TABLE IF NOT EXISTS runs (
    id UUID PRIMARY KEY,
    integration_id UUID NOT NULL REFERENCES integrations(id),
    tenant_id UUID NOT NULL,
    status run_status NOT NULL,
    run_type run_type NOT NULL,
    items_processed INTEGER NOT NULL DEFAULT 0,
    items_inserted INTEGER NOT NULL DEFAULT 0,
    items_skipped INTEGER NOT NULL DEFAULT 0,
    start_token TEXT,
    end_token TEXT,
    error_message TEXT,
    error_stack TEXT,
    retry_count INTEGER NOT NULL DEFAULT 0,
    started_at TIMESTAMP NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Runs indexes
CREATE INDEX idx_runs_tenant_status ON runs(tenant_id, status, started_at);
CREATE INDEX idx_runs_integration_status ON runs(integration_id, status, started_at);
