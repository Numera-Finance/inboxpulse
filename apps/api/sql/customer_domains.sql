-- Company Domains table
-- Supports multiple domains per customer (for future customer merging)
-- Each domain is unique across all customers (within a tenant)

CREATE TABLE IF NOT EXISTS customer_domains (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    
    -- Domain (lowercase enforced in API layer)
    domain VARCHAR(255) NOT NULL,
    
    -- Metadata
    verified BOOLEAN NOT NULL DEFAULT false, -- Whether domain is verified
    
    -- Tracking
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    
    -- Each domain must be unique per tenant
    CONSTRAINT uniq_customer_domains_tenant_domain UNIQUE (tenant_id, domain)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_customer_domains_customer_id ON customer_domains(customer_id);
CREATE INDEX IF NOT EXISTS idx_customer_domains_tenant_domain ON customer_domains(tenant_id, domain);
