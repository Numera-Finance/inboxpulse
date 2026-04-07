-- Migration: Add archived_at to customers for soft-archive on merge
ALTER TABLE customers ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

-- Partial index for efficient filtering of archived customers
CREATE INDEX IF NOT EXISTS idx_customers_archived_at ON customers(tenant_id) WHERE archived_at IS NOT NULL;
