-- =============================================================================
-- Users and related tables
-- =============================================================================
-- DEPENDENCIES: Run after tenants.sql and roles.sql
-- =============================================================================

DROP TABLE IF EXISTS user_accessible_customers CASCADE;
DROP TABLE IF EXISTS user_customers CASCADE;
DROP TABLE IF EXISTS user_managers CASCADE;
DROP TABLE IF EXISTS users CASCADE;

-- -----------------------------------------------------------------------------
-- Users - Core user entity (employees/users are same)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),

    -- User information
    first_name VARCHAR(60) NOT NULL,
    last_name VARCHAR(60) NOT NULL,
    email VARCHAR(255) NOT NULL,

    -- RBAC role (references roles table)
    role_id UUID REFERENCES roles(id),

    -- API key hash for service/API users (SHA-256 hex, null for regular users)
    -- Used for service-to-service authentication
    api_key_hash VARCHAR(64),

    -- Whether the user can login to the application
    can_login BOOLEAN NOT NULL DEFAULT true,

    -- Status: 0 = active, 1 = inactive, 2 = archived
    row_status SMALLINT NOT NULL DEFAULT 0,

    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_login_at TIMESTAMPTZ, -- Last time the user logged in

    CONSTRAINT uniq_users_tenant_email UNIQUE (tenant_id, email)
);

CREATE INDEX IF NOT EXISTS idx_users_tenant ON users(tenant_id);
CREATE INDEX IF NOT EXISTS idx_users_tenant_status ON users(tenant_id, row_status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_api_key_hash ON users(api_key_hash) WHERE api_key_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_can_login ON users(tenant_id, can_login) WHERE can_login = true;
CREATE INDEX IF NOT EXISTS idx_users_last_login ON users(last_login_at);

-- -----------------------------------------------------------------------------
-- User Managers - Direct manager relationships (source of truth)
-- One user can have multiple managers (matrix organization).
-- Changes trigger async rebuild of user_accessible_customers.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_managers (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    manager_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    PRIMARY KEY (user_id, manager_id),
    CONSTRAINT chk_no_self_manager CHECK (user_id != manager_id)
);

CREATE INDEX IF NOT EXISTS idx_user_managers_manager ON user_managers(manager_id);
CREATE INDEX IF NOT EXISTS idx_user_managers_user ON user_managers(user_id);

-- -----------------------------------------------------------------------------
-- User Customers - Direct customer assignments (source of truth)
-- A user can be assigned to many customers (50-100+).
-- Changes trigger async rebuild of user_accessible_customers.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_customers (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    role_id UUID, -- References predefined customer roles (Account Manager, Controller, etc.)
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    PRIMARY KEY (user_id, customer_id)
);

CREATE INDEX IF NOT EXISTS idx_user_customers_customer ON user_customers(customer_id);
CREATE INDEX IF NOT EXISTS idx_user_customers_user ON user_customers(user_id);

-- -----------------------------------------------------------------------------
-- User Accessible Customers - Denormalized access control table
--
-- Contains ALL customers a user can access (their own + all descendants').
-- Rebuilt asynchronously via Inngest with 5-minute debounce per tenant.
-- This enables O(1) access control queries instead of recursive hierarchy traversal.
--
-- Example: If Alice manages Bob, and Bob is assigned to CompanyX:
--   - Bob can access CompanyX (direct assignment)
--   - Alice can access CompanyX (via managing Bob)
--   Both rows exist in this table.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_accessible_customers (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    rebuilt_at TIMESTAMPTZ NOT NULL, -- When this row was computed

    PRIMARY KEY (user_id, customer_id)
);

CREATE INDEX IF NOT EXISTS idx_uac_customer ON user_accessible_customers(customer_id);
CREATE INDEX IF NOT EXISTS idx_uac_user ON user_accessible_customers(user_id);

