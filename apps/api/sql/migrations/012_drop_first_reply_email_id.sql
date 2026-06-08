-- Migration: Drop emails.first_reply_email_id
-- Reply (outbound) emails are no longer stored as rows, so there is no email id
-- to reference — only the reply timestamp is recorded in emails.first_reply_at.
-- The column was write-only and is now never written, mirroring the message_count
-- cleanup (migration 011).
-- Idempotent: safe to re-run.

ALTER TABLE emails DROP COLUMN IF EXISTS first_reply_email_id;
