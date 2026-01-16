-- =============================================================================
-- Migration: TAT (Turn Around Time) Metrics
-- =============================================================================
-- This migration adds support for email TAT tracking and SLA breach monitoring.
--
-- Changes:
-- 1. Add is_customer_email column to emails table (for efficient TAT queries)
-- 2. Add first_reply_email_id and first_reply_at to emails table (TAT tracking)
-- 3. Add controller_role_id to tenants table (configurable controller role)
-- 4. Create holiday_calendars table (business days calculation)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Emails table: Add TAT tracking columns
-- -----------------------------------------------------------------------------

-- is_customer_email: Boolean flag set during email ingestion
-- true = email from customer (fromEmail domain != tenant domain)
-- false = email from tenant domain
-- null = unknown (legacy data, needs backfill)
-- Using this column avoids expensive domain matching in TAT queries
ALTER TABLE emails
ADD COLUMN IF NOT EXISTS is_customer_email BOOLEAN;

-- first_reply_email_id: UUID of the first reply from tenant domain
-- Populated when a reply is detected during email sync
ALTER TABLE emails
ADD COLUMN IF NOT EXISTS first_reply_email_id UUID;

-- first_reply_at: Timestamp when the first reply was sent
-- Used to calculate TAT (time from received_at to first_reply_at)
ALTER TABLE emails
ADD COLUMN IF NOT EXISTS first_reply_at TIMESTAMP;

-- Index for TAT metrics queries (customer emails only)
CREATE INDEX IF NOT EXISTS idx_emails_tenant_customer
ON emails(tenant_id, is_customer_email);

-- -----------------------------------------------------------------------------
-- 2. Tenants table: Add controller role configuration
-- -----------------------------------------------------------------------------

-- controller_role_id: UUID of the role that identifies "Controller" (Account Manager)
-- Used to link customers to their controllers via user_customers table
-- TAT metrics are grouped by controller
ALTER TABLE tenants
ADD COLUMN IF NOT EXISTS controller_role_id UUID;

-- -----------------------------------------------------------------------------
-- 3. Holiday Calendars table: Create for business days calculation
-- -----------------------------------------------------------------------------

-- Only create if not exists (safe to re-run)
CREATE TABLE IF NOT EXISTS holiday_calendars (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),

    -- Holiday details
    date DATE NOT NULL, -- '2026-01-01'
    timezone VARCHAR(100) NOT NULL, -- 'America/New_York'
    name VARCHAR(255) NOT NULL, -- 'New Year''s Day'

    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

    -- Prevent duplicate holidays on same date/timezone for a tenant
    CONSTRAINT uniq_holidays_tenant_date_timezone UNIQUE (tenant_id, date, timezone)
);

-- Indexes for holiday_calendars (idempotent)
CREATE INDEX IF NOT EXISTS idx_holidays_tenant_date
ON holiday_calendars(tenant_id, date);

CREATE INDEX IF NOT EXISTS idx_holidays_tenant_timezone
ON holiday_calendars(tenant_id, timezone);

-- -----------------------------------------------------------------------------
-- Verification queries (run manually to verify migration)
-- -----------------------------------------------------------------------------
-- Check emails columns:
-- SELECT column_name, data_type FROM information_schema.columns
-- WHERE table_name = 'emails' AND column_name IN ('is_customer_email', 'first_reply_email_id', 'first_reply_at');

-- Check tenants columns:
-- SELECT column_name, data_type FROM information_schema.columns
-- WHERE table_name = 'tenants' AND column_name = 'controller_role_id';

-- Check holiday_calendars table:
-- SELECT * FROM information_schema.tables WHERE table_name = 'holiday_calendars';

-- Check indexes:
-- SELECT indexname FROM pg_indexes WHERE indexname LIKE '%holiday%' OR indexname = 'idx_emails_tenant_customer';
