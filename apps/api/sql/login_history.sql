DROP TABLE IF EXISTS login_history CASCADE;

-- Login History - Append-only audit log of successful logins.
-- Written by the better-auth session.create.after hook. Pairs with
-- users.last_login_at (which only stores the most recent login) and
-- preserves the full history for audit / export.
CREATE TABLE IF NOT EXISTS login_history (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL REFERENCES tenants(id),

    -- Session correlation + request metadata
    better_auth_session_id VARCHAR(255),
    ip_address VARCHAR(64),
    user_agent VARCHAR(512),

    -- When the login happened
    logged_in_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Indexes
-- Tenant-wide audit / export queries (most recent first)
CREATE INDEX IF NOT EXISTS idx_login_history_tenant_logged_in
    ON login_history (tenant_id, logged_in_at DESC);
-- Per-user history queries
CREATE INDEX IF NOT EXISTS idx_login_history_user_logged_in
    ON login_history (user_id, logged_in_at DESC);
