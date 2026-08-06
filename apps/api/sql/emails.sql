DROP TABLE IF EXISTS emails CASCADE;

-- Emails table (individual messages, provider-agnostic)
CREATE TABLE IF NOT EXISTS emails (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    thread_id UUID NOT NULL REFERENCES email_threads(id) ON DELETE CASCADE,

    -- Provider identifiers
    integration_id UUID REFERENCES integrations(id),
    provider VARCHAR(50) NOT NULL, -- 'gmail', 'outlook', etc. (from integration_source)
    message_id VARCHAR(500) NOT NULL, -- provider's unique message ID

    -- Email content
    subject TEXT NOT NULL,
    body TEXT,

    -- Sender
    from_email VARCHAR(500) NOT NULL,
    from_name VARCHAR(500),

    -- Recipients (arrays of objects: [{email, name}])
    tos JSONB,
    ccs JSONB,
    bccs JSONB,

    -- Metadata
    priority VARCHAR(20) NOT NULL DEFAULT 'normal',
    labels TEXT[],
    received_at TIMESTAMP NOT NULL,

    -- Provider-specific data (store Gmail labels, Outlook categories, etc.)
    metadata JSONB,

    -- Deduplication fields (for detecting forwarded copies of the same email)
    rfc_message_id VARCHAR(500),   -- RFC 2822 Message-ID header (same across all recipients)
    content_hash VARCHAR(64),       -- SHA-256 hex of from+subject+body+recipients

    -- Analysis signals (computed async) - array of Signal integers
    -- See @crm/shared Signal constants:
    --   1=SENTIMENT_POSITIVE, 2=SENTIMENT_NEGATIVE, 3=SENTIMENT_NEUTRAL
    --   10=ESCALATION, 20=UPSELL
    --   30=CHURN_LOW, 31=CHURN_MEDIUM, 32=CHURN_HIGH, 33=CHURN_CRITICAL
    --   40=KUDOS, 50=COMPETITOR
    signals INTEGER[] NOT NULL DEFAULT '{}',
    analysis_status SMALLINT NOT NULL DEFAULT 1, -- 1=pending, 2=processing, 3=completed, 4=failed

    -- TAT (Turn Around Time) tracking - populated for customer emails
    -- is_customer_email: true if email is from customer (fromEmail domain != tenant domain)
    -- Set during email ingestion to avoid expensive domain matching in queries
    is_customer_email BOOLEAN,

    -- first_reply_at: Timestamp of the first reply (tenant's outbound message)
    -- that arrived after this customer email AND was addressed to its sender —
    -- the time-to-response anchor. Reply emails are not stored as rows, so only
    -- this trace of them is kept.
    first_reply_at TIMESTAMP,

    -- first_reply_by_id: The user who sent that first reply, resolved from its
    -- sender address. NULL when the address matches no user in the tenant
    -- (shared mailbox, alias) — the reply still counts for first_reply_at.
    first_reply_by_id UUID REFERENCES users(id) ON DELETE SET NULL,

    -- Tracking
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),

    -- Unique constraint
    CONSTRAINT uniq_emails_tenant_provider_message UNIQUE (tenant_id, provider, message_id)
);

-- Indexes
CREATE INDEX idx_emails_tenant_received ON emails(tenant_id, received_at DESC);
CREATE INDEX idx_emails_thread ON emails(thread_id, received_at DESC);
CREATE INDEX idx_emails_from ON emails(tenant_id, from_email);
CREATE INDEX idx_emails_provider_message ON emails(provider, message_id);
CREATE INDEX idx_emails_integration ON emails(integration_id);

-- Dedup indexes
CREATE INDEX idx_emails_rfc_message_id ON emails(tenant_id, rfc_message_id);
CREATE INDEX idx_emails_content_hash ON emails(tenant_id, content_hash);

-- GIN index for efficient signal array queries: WHERE signals @> ARRAY[1]
CREATE INDEX idx_emails_signals ON emails USING GIN(signals);

-- Index for TAT metrics queries (customer emails only)
CREATE INDEX idx_emails_tenant_customer ON emails(tenant_id, is_customer_email);

-- Index for "who responded first" reporting
CREATE INDEX idx_emails_first_reply_by ON emails(tenant_id, first_reply_by_id);
