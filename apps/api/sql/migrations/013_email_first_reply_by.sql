-- =============================================================================
-- Migration: First-reply attribution (emails.first_reply_by_id)
-- =============================================================================
-- Records WHO sent the first reply to a customer email, alongside the existing
-- first_reply_at (WHEN it was sent).
--
-- Ships with a matching rule change in the application: a reply now only counts
-- for a customer email when it is addressed to that email's own sender (the
-- originator) via To or Cc. Replies that go only to colleagues, or to a
-- different contact on the same thread, are ignored.
--
-- Changes:
-- 1. Add first_reply_by_id column to emails (FK -> users, nullable)
-- 2. Add index for "who responded first" reporting
--
-- Backfill: none. Reply messages are never stored as rows, so historical
-- first_reply_at values cannot be recomputed under the new rule and no user can
-- be resolved for them. Existing first_reply_at values are left untouched
-- (they keep their pre-change semantics); first_reply_by_id stays NULL for them.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Emails table: Add first-reply attribution column
-- -----------------------------------------------------------------------------

-- first_reply_by_id: users.id of whoever sent the reply recorded in
-- first_reply_at. NULL when the reply came from an address with no matching user
-- in the tenant (shared mailbox, alias, someone never onboarded) — the reply
-- still counts for first_reply_at, only the attribution is unknown.
-- ON DELETE SET NULL so removing a user never blocks on, or cascades into, email rows.
ALTER TABLE emails
ADD COLUMN IF NOT EXISTS first_reply_by_id UUID;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'fk_emails_first_reply_by'
    ) THEN
        ALTER TABLE emails
        ADD CONSTRAINT fk_emails_first_reply_by
        FOREIGN KEY (first_reply_by_id) REFERENCES users(id) ON DELETE SET NULL;
    END IF;
END
$$;

-- -----------------------------------------------------------------------------
-- 2. Index for first-responder reporting
-- -----------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_emails_first_reply_by
ON emails(tenant_id, first_reply_by_id);

-- -----------------------------------------------------------------------------
-- Verification queries (run manually to verify migration)
-- -----------------------------------------------------------------------------
-- Check column:
-- SELECT column_name, data_type, is_nullable FROM information_schema.columns
-- WHERE table_name = 'emails' AND column_name = 'first_reply_by_id';

-- Check foreign key:
-- SELECT conname FROM pg_constraint WHERE conname = 'fk_emails_first_reply_by';

-- Check index:
-- SELECT indexname FROM pg_indexes WHERE indexname = 'idx_emails_first_reply_by';
