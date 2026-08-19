-- Manual signal (sentiment / churn / tag) overrides.
--
-- Adds:
--   1. emails.signals_overridden — a lock flag. When true, the analysis pipeline
--      (LLM + keyword) skips overwriting emails.signals, so a human correction is
--      not silently reverted by a later re-analysis.
--   2. email_signal_overrides — an append-only audit + learning log. One row per
--      manual correction, capturing the model's original signals and the human's
--      corrected signals (plus optional reason and analysis snapshot). This is the
--      labelled dataset used to measure and improve the analysis prompts.
--
-- Idempotent: safe to re-run.

ALTER TABLE emails
  ADD COLUMN IF NOT EXISTS signals_overridden boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS email_signal_overrides (
  id                uuid PRIMARY KEY,
  tenant_id         uuid NOT NULL REFERENCES tenants(id),
  email_id          uuid NOT NULL REFERENCES emails(id) ON DELETE CASCADE,
  previous_signals  integer[] NOT NULL DEFAULT '{}',
  new_signals       integer[] NOT NULL DEFAULT '{}',
  reason            text,
  analysis_snapshot jsonb,
  edited_by_user_id uuid NOT NULL,
  created_at        timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_email_signal_overrides_email
  ON email_signal_overrides (email_id);

CREATE INDEX IF NOT EXISTS idx_email_signal_overrides_tenant_created
  ON email_signal_overrides (tenant_id, created_at);
