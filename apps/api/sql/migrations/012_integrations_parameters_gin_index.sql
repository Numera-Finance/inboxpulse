-- Add GIN index on integrations.parameters for efficient JSONB containment (@>) lookups.
-- The Gmail webhook resolves the owning integration by email via a containment match
-- inside the parameters key-value array, e.g.
--   WHERE parameters @> '[{"key":"email","value":"user@example.com"}]'
-- Used by IntegrationRepository.findByEmail / findIdByEmail.
--
-- Without this index those queries do a full table scan on every Gmail webhook
-- (~840 lookups / 30 min observed on 2026-06-22), which loaded the whole table into
-- memory and contributed to crm-api OOM crashes.
--
-- jsonb_path_ops is smaller and faster than the default jsonb_ops and supports the
-- @> operator, which is the only JSONB operator these lookups use.
CREATE INDEX IF NOT EXISTS idx_integrations_parameters_gin
  ON integrations USING GIN (parameters jsonb_path_ops);
