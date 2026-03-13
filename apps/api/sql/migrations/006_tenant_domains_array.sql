-- Migration: Migrate tenant.domain (VARCHAR) to tenant.domains (TEXT[])
-- Supports multiple email domains per tenant for SSO authentication
-- Idempotent: safe to re-run

-- Step 1: Add new domains column
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS domains TEXT[] NOT NULL DEFAULT '{}';

-- Step 2: Migrate existing data (single domain → array)
UPDATE tenants SET domains = ARRAY[domain] WHERE domain IS NOT NULL AND domains = '{}';

-- Step 3: Drop old column and index
DROP INDEX IF EXISTS idx_tenants_domain;
ALTER TABLE tenants DROP COLUMN IF EXISTS domain;

-- Step 4: Create GIN index for array lookups (used by SSO domain matching)
CREATE INDEX IF NOT EXISTS idx_tenants_domains ON tenants USING GIN (domains);
