DROP TABLE IF EXISTS tasks CASCADE;

-- Tasks table
-- Auto-created from negative sentiment emails or manually created
-- Used for escalation management
CREATE TABLE IF NOT EXISTS tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),

    -- Source email (optional - tasks can be created manually)
    email_id UUID REFERENCES emails(id) ON DELETE SET NULL,

    -- Customer association
    customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,

    -- Task details
    title TEXT NOT NULL,
    status SMALLINT NOT NULL DEFAULT 0, -- 0=open, 1=done

    -- Assignment
    assigned_to_id UUID REFERENCES users(id) ON DELETE SET NULL,

    -- Creation tracking
    created_by_system BOOLEAN NOT NULL DEFAULT false, -- true if auto-created from negative email

    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMP WITH TIME ZONE
);

-- Indexes
CREATE INDEX idx_tasks_tenant ON tasks(tenant_id);
CREATE INDEX idx_tasks_tenant_status ON tasks(tenant_id, status);
CREATE INDEX idx_tasks_assigned ON tasks(assigned_to_id, status);
CREATE INDEX idx_tasks_customer ON tasks(customer_id);
CREATE INDEX idx_tasks_email ON tasks(email_id);
CREATE INDEX idx_tasks_created ON tasks(tenant_id, created_at DESC);
