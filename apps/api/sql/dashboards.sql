DROP TABLE IF EXISTS dashboards CASCADE;

-- Dashboards table
-- Stores user dashboard layout configurations (react-grid-layout format)
-- Each user has one dashboard config per tenant
CREATE TABLE IF NOT EXISTS dashboards (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    -- Dashboard layout configuration (react-grid-layout format)
    config JSONB NOT NULL,

    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Each user has one dashboard per tenant
CREATE UNIQUE INDEX uniq_dashboards_tenant_user ON dashboards(tenant_id, user_id);
