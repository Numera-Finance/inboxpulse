DROP TABLE IF EXISTS tenants CASCADE;

-- Tenants table
CREATE TABLE IF NOT EXISTS tenants (
    id UUID PRIMARY KEY,
    name TEXT NOT NULL,
    domains TEXT[] NOT NULL DEFAULT '{}', -- Email domains for tenant users (e.g., '{acme.com,subsidiary.com}') used for SSO auto-provisioning
    account_manager_role_id UUID, -- Role ID that identifies "Controller" (Account Manager) for TAT tracking
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- GIN index for array lookups during SSO domain matching
CREATE INDEX IF NOT EXISTS idx_tenants_domains ON tenants USING GIN (domains);

insert into tenants(id, name, created_at, updated_at, domains)
values(gen_random_uuid(), 'MyStartupCFO', now(), now(), '{mystartupcfo.com}')
