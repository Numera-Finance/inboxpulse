DROP TABLE IF EXISTS holiday_calendars CASCADE;

-- Holiday Calendars - Store holidays by tenant and timezone
-- Used for TAT (Turn Around Time) calculation to exclude holidays
-- from business days calculation.
-- Each tenant can have holidays configured per timezone to support
-- teams in different regions.
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

-- Indexes
-- For querying holidays by tenant and date range
CREATE INDEX idx_holidays_tenant_date ON holiday_calendars(tenant_id, date);
-- For querying holidays by tenant and timezone
CREATE INDEX idx_holidays_tenant_timezone ON holiday_calendars(tenant_id, timezone);
