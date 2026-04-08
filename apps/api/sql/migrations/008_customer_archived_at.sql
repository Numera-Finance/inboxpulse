-- Migration: Add row_status to customers (0=ACTIVE, 1=INACTIVE, 2=ARCHIVED)
-- Consistent with users.row_status pattern
ALTER TABLE customers ADD COLUMN IF NOT EXISTS row_status SMALLINT NOT NULL DEFAULT 0;

-- Index for filtering by status
CREATE INDEX IF NOT EXISTS idx_customers_row_status ON customers(tenant_id, row_status);
