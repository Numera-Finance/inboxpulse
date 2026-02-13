-- Email Deduplication: Add RFC Message-ID and content hash columns
-- These columns enable detection of forwarded copies of the same email
-- (e.g., when multiple users forward the same email to a shared mailbox)
--
-- Migration is idempotent (safe to run multiple times)

-- Add RFC 2822 Message-ID header column
ALTER TABLE emails ADD COLUMN IF NOT EXISTS rfc_message_id VARCHAR(500);

-- Add content hash column (SHA-256 hex)
ALTER TABLE emails ADD COLUMN IF NOT EXISTS content_hash VARCHAR(64);

-- Index for RFC Message-ID dedup lookups (Layer 1)
CREATE INDEX IF NOT EXISTS idx_emails_rfc_message_id ON emails(tenant_id, rfc_message_id);

-- Index for content hash dedup lookups (Layer 2)
CREATE INDEX IF NOT EXISTS idx_emails_content_hash ON emails(tenant_id, content_hash);
