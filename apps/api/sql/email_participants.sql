DROP TABLE IF EXISTS email_participants CASCADE;
DROP TYPE IF EXISTS participant_type CASCADE;
DROP TYPE IF EXISTS email_direction CASCADE;

-- Participant type enum
CREATE TYPE participant_type AS ENUM ('user', 'contact');

-- Email direction enum
CREATE TYPE email_direction AS ENUM ('from', 'to', 'cc', 'bcc');

-- Email Participants - Links emails to users/contacts with customer context
--
-- This table enables:
-- 1. Efficient access control via customer_id join
-- 2. Multi-customer email support (email to multiple domains)
-- 3. Unified participant tracking (users and contacts)
-- 4. Direction tracking (from/to/cc/bcc)
CREATE TABLE IF NOT EXISTS email_participants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Tenant isolation
    tenant_id UUID NOT NULL REFERENCES tenants(id),

    email_id UUID NOT NULL REFERENCES emails(id) ON DELETE CASCADE,

    -- Participant (polymorphic - can be user or contact)
    participant_type participant_type NOT NULL,
    participant_id UUID NOT NULL,

    -- Email address (denormalized for display/search)
    email VARCHAR(500) NOT NULL,
    name VARCHAR(500),

    -- Direction in the email
    direction email_direction NOT NULL,

    -- Customer link for access control (NULL for internal users without customer context)
    customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,

    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Indexes
-- Tenant isolation
CREATE INDEX IF NOT EXISTS idx_ep_tenant ON email_participants(tenant_id);

-- Primary lookup: find participants for an email
CREATE INDEX IF NOT EXISTS idx_ep_email ON email_participants(email_id);

-- Access control: find all emails for accessible customers (within tenant)
CREATE INDEX IF NOT EXISTS idx_ep_tenant_customer ON email_participants(tenant_id, customer_id);

-- Participant lookup: find all emails for a user or contact
CREATE INDEX IF NOT EXISTS idx_ep_participant ON email_participants(participant_type, participant_id);

-- Direction filtering: find all 'from' participants for an email
CREATE INDEX IF NOT EXISTS idx_ep_email_direction ON email_participants(email_id, direction);

-- Email address lookup (for finding participant by email within tenant)
CREATE INDEX IF NOT EXISTS idx_ep_tenant_email_address ON email_participants(tenant_id, email);
