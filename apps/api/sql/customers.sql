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
    
    -- Metadata
    metadata JSONB, -- Additional customer data
    
    -- Tracking
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
