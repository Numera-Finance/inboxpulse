DROP TABLE IF EXISTS contacts CASCADE;

-- Contacts table
CREATE TABLE IF NOT EXISTS contacts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,

    -- Contact information
    email VARCHAR(500) NOT NULL,
    name TEXT,

    -- Extracted from signature
    title VARCHAR(200),
    phone VARCHAR(50),
    mobile VARCHAR(50),
    address TEXT,
    website VARCHAR(500),
    linkedin VARCHAR(500),
    x VARCHAR(200),
    linktree VARCHAR(500),

    -- Tracking
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),

    CONSTRAINT uniq_contacts_tenant_email UNIQUE (tenant_id, email)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_contacts_tenant_email ON contacts(tenant_id, email);
CREATE INDEX IF NOT EXISTS idx_contacts_customer ON contacts(customer_id);
CREATE INDEX IF NOT EXISTS idx_contacts_tenant_customer ON contacts(tenant_id, customer_id);
