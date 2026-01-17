DROP TABLE IF EXISTS tenants CASCADE;

-- Tenants table
CREATE TABLE IF NOT EXISTS tenants (
    id UUID PRIMARY KEY,
    name TEXT NOT NULL,
    domain VARCHAR(255), -- Email domain for tenant users (e.g., 'acme.com') used for SSO auto-provisioning
    account_manager_role_id UUID, -- Role ID that identifies "Controller" (Account Manager) for TAT tracking
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Index for domain lookup during SSO
CREATE INDEX IF NOT EXISTS idx_tenants_domain ON tenants(domain);

insert into tenants(id, name, created_at, updated_at, domain)
values(gen_random_uuid(), 'MyStartupCFO', now(), now(), 'mystartupcfo.com')
