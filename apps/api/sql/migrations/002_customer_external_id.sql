-- =============================================================================
-- Migration: Customer External ID for Spreadsheet Import
-- =============================================================================
-- This migration adds support for external system identifiers on customers.
--
-- Changes:
-- 1. Add external_id column to customers table
-- 2. Add unique index on (tenant_id, external_id) where external_id is not null
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Customers table: Add external_id column
-- -----------------------------------------------------------------------------

-- external_id: External system identifier (e.g., Client ID from spreadsheet)
-- Used to match customers during import operations
-- Nullable - not all customers need an external ID
ALTER TABLE customers
ADD COLUMN IF NOT EXISTS external_id VARCHAR(255);

-- Unique index per tenant (only for non-null values)
-- This allows multiple customers to have NULL external_id
-- but ensures no duplicates within a tenant for non-null values
CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_tenant_external_id
ON customers(tenant_id, external_id)
WHERE external_id IS NOT NULL;

-- -----------------------------------------------------------------------------
-- Verification queries (run manually to verify migration)
-- -----------------------------------------------------------------------------
-- Check customers columns:
-- SELECT column_name, data_type FROM information_schema.columns
-- WHERE table_name = 'customers' AND column_name = 'external_id';

-- Check indexes:
-- SELECT indexname FROM pg_indexes WHERE indexname = 'idx_customers_tenant_external_id';
