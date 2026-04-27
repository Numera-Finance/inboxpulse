-- Migration: Login history audit table
--
-- Captures every successful login as an append-only audit record. Written by
-- the better-auth `session.create.after` hook. The existing
-- `users.last_login_at` column still tracks the most recent login for fast
-- per-user reads; this table preserves the full history.

CREATE TABLE IF NOT EXISTS login_history (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  better_auth_session_id TEXT,
  ip_address TEXT,
  user_agent TEXT,
  logged_in_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_login_history_tenant_logged_in
  ON login_history (tenant_id, logged_in_at DESC);

CREATE INDEX IF NOT EXISTS idx_login_history_user_logged_in
  ON login_history (user_id, logged_in_at DESC);
