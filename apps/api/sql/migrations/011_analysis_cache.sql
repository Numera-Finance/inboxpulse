-- Migration: Create analysis_cache table.
--
-- The Drizzle schema for this table (apps/analysis/src/db/schema.ts) was added
-- without a corresponding SQL migration, so the table never existed in
-- production. Every cache get/set in AnalysisCacheService failed (and failed
-- open), meaning LLM analysis results were never cached and Inngest retries
-- re-billed the full set of Gemini calls for every attempt.
--
-- Stores LLM analysis results keyed by (message_id, model_id) so retries and
-- re-analyses reuse prior results. TTL (7 days) is enforced on read with lazy
-- cleanup by created_at. Idempotent.

CREATE TABLE IF NOT EXISTS analysis_cache (
  message_id TEXT NOT NULL,
  model_id   TEXT NOT NULL,
  tenant_id  UUID NOT NULL,
  results    JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT analysis_cache_pkey PRIMARY KEY (message_id, model_id)
);

-- Supports TTL cleanup (DELETE ... WHERE created_at < cutoff)
CREATE INDEX IF NOT EXISTS idx_analysis_cache_created_at
  ON analysis_cache (created_at);

-- Supports tenant-scoped queries / future cleanup by tenant
CREATE INDEX IF NOT EXISTS idx_analysis_cache_tenant_id
  ON analysis_cache (tenant_id);
