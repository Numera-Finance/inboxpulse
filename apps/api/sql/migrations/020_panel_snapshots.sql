-- =============================================================================
-- Migration: panel_snapshots — precomputed tenant-wide panel sections
-- =============================================================================
-- The panel's three tenant-wide sections (danger pulse, stirring, slow
-- responders) are 90-day aggregates that are IDENTICAL for every viewer in a
-- tenant, and they were recomputed on every panel open.
--
-- Measured against production on 2026-08-19 at 25 concurrent panel opens:
--
--   stirring          p50 4,502ms   65% of calls exceeded the add-on's 6s abort
--   pulse             p50 3,682ms   57%
--   viewer/waiting/fires  p50 125-256ms   7-10%
--
-- A timed-out section does not render as slow. It renders as absent, which on
-- this panel reads as "nothing is wrong" — so at two dozen users the product
-- was already lying by omission, and 200 is the stated target.
--
-- This table holds one row per (tenant, kind). A cron recomputes them on a
-- schedule; the endpoints read the row. The cost stops scaling with the number
-- of readers, which is the whole point: 200 users were paying 200 times for one
-- answer that changes a few times an hour.
--
-- Idempotent: safe to re-run.
-- =============================================================================

CREATE TABLE IF NOT EXISTS panel_snapshots (
  tenant_id   uuid  NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  -- 'pulse' | 'stirring' | 'slow_responders'. Text rather than an enum so a new
  -- section does not need a migration to be precomputed.
  kind        text  NOT NULL,
  -- The endpoint's response body verbatim, so serving is a read and a parse
  -- rather than a re-shaping that could drift from the live path.
  payload     jsonb NOT NULL,
  -- What the payload was computed over, so a reader can tell a 90-day window
  -- from a 30-day one without inferring it.
  window_days integer NOT NULL DEFAULT 90,
  -- How long the computation took. Kept because the reason this table exists is
  -- a latency problem, and the first question when it returns is whether the
  -- underlying queries got slower again.
  compute_ms  integer,
  computed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, kind, window_days)
);

-- The read is always "this tenant, this kind, is it fresh enough" — the primary
-- key covers it. This index serves the cron's sweep for stale rows instead.
CREATE INDEX IF NOT EXISTS idx_panel_snapshots_staleness
  ON panel_snapshots (computed_at);
