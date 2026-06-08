-- Migration: Drop email_threads.message_count
-- The message_count column was write-only (computed during sync but never read).
-- It also became ambiguous once sent/reply emails stopped being stored as rows
-- (the count would no longer match the number of email rows in a thread).
-- Idempotent: safe to re-run.

ALTER TABLE email_threads DROP COLUMN IF EXISTS message_count;
