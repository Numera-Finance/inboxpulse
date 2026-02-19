-- Analysis Keywords
-- Stores keyword rules per tenant + category for keyword-based email analysis
-- When keywords match, analysis results are determined without LLM calls

CREATE TABLE IF NOT EXISTS analysis_keywords (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  category VARCHAR(50) NOT NULL,
  keywords TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id, category)
);

CREATE INDEX IF NOT EXISTS idx_analysis_keywords_tenant ON analysis_keywords(tenant_id);
