DROP TABLE IF EXISTS customers CASCADE;

-- Customers table
-- Note: Domain information is stored in customer_domains table (see customer_domains.sql)
CREATE TABLE IF NOT EXISTS customers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    
    -- Customer information
    name TEXT, -- Extracted from emails or manual entry
    website TEXT,
    industry VARCHAR(100),
    labels JSONB DEFAULT '[]'::jsonb,
    external_id VARCHAR(255), -- External system identifier (e.g., Client ID from spreadsheet)

    -- Metadata
    metadata JSONB, -- Additional customer data

    -- Status: 0=ACTIVE, 1=INACTIVE, 2=ARCHIVED (consistent with users.row_status)
    row_status SMALLINT NOT NULL DEFAULT 0,

    -- Tracking
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Unique index on external_id per tenant (allows null)
CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_tenant_external_id
    ON customers(tenant_id, external_id) WHERE external_id IS NOT NULL;

-- Index for filtering by status
CREATE INDEX IF NOT EXISTS idx_customers_row_status
    ON customers(tenant_id, row_status);
