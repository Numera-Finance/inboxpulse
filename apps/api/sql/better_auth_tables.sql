-- =============================================================================
-- Better-Auth Tables for Google SSO
-- =============================================================================

-- Drop tables if they exist (for idempotency)
DROP TABLE IF EXISTS better_auth_verification CASCADE;
DROP TABLE IF EXISTS better_auth_account CASCADE;
DROP TABLE IF EXISTS better_auth_session CASCADE;
DROP TABLE IF EXISTS better_auth_user CASCADE;

-- -----------------------------------------------------------------------------
-- Better-Auth User Table
-- Stores authentication data (managed by better-auth)
-- Custom field: tenant_id for fast tenant lookup in middleware
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS better_auth_user (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    email_verified BOOLEAN NOT NULL DEFAULT FALSE,
    name TEXT,
    image TEXT,
    tenant_id UUID REFERENCES tenants(id), -- Custom field: Store tenantId for fast lookup
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_better_auth_user_email ON better_auth_user(email);
CREATE INDEX IF NOT EXISTS idx_better_auth_user_tenant_id ON better_auth_user(tenant_id);

-- -----------------------------------------------------------------------------
-- Better-Auth Session Table
-- Stores active sessions (managed by better-auth)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS better_auth_session (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES better_auth_user(id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL,
    token TEXT NOT NULL UNIQUE,
    ip_address TEXT,
    user_agent TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_better_auth_session_user_id ON better_auth_session(user_id);
CREATE INDEX IF NOT EXISTS idx_better_auth_session_token ON better_auth_session(token);
CREATE INDEX IF NOT EXISTS idx_better_auth_session_expires_at ON better_auth_session(expires_at);

-- -----------------------------------------------------------------------------
-- Better-Auth Account Table (Google OAuth)
-- Stores OAuth account information
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS better_auth_account (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES better_auth_user(id) ON DELETE CASCADE,
    account_id TEXT NOT NULL,
    provider_id TEXT NOT NULL DEFAULT 'google',
    access_token TEXT,
    refresh_token TEXT,
    expires_at TIMESTAMPTZ,
    access_token_expires_at TIMESTAMPTZ,
    scope TEXT,
    id_token TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(provider_id, account_id)
);

CREATE INDEX IF NOT EXISTS idx_better_auth_account_user_id ON better_auth_account(user_id);

-- -----------------------------------------------------------------------------
-- Better-Auth Verification Table
-- Stores email verification tokens, password reset tokens, etc.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS better_auth_verification (
    id TEXT PRIMARY KEY,
    identifier TEXT NOT NULL,
    value TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(identifier, value)
);

CREATE INDEX IF NOT EXISTS idx_better_auth_verification_expires_at ON better_auth_verification(expires_at);

-- -----------------------------------------------------------------------------
-- Optional: Link users table to better-auth (for reference)
-- Note: We link via email (unique per tenant) rather than foreign key
-- -----------------------------------------------------------------------------
-- ALTER TABLE users ADD COLUMN IF NOT EXISTS better_auth_user_id TEXT REFERENCES better_auth_user(id);
-- CREATE INDEX IF NOT EXISTS idx_users_better_auth_user_id ON users(better_auth_user_id);
