DROP TABLE IF EXISTS email_analyses CASCADE;

-- Email Analyses Table
-- Stores analysis results for individual emails
-- Each email can have multiple analysis results (one per analysis type)

CREATE TABLE IF NOT EXISTS email_analyses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Foreign keys
    email_id UUID NOT NULL REFERENCES emails(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    
    -- Analysis type and result
    analysis_type VARCHAR(50) NOT NULL,  -- 'sentiment', 'escalation', 'upsell', 'churn', 'kudos', 'competitor', 'signature-extraction'
    result JSONB NOT NULL,                -- The analysis result (validated by schema)
    
    -- Extracted fields for indexing and querying
    -- These fields are extracted from the result JSONB for efficient querying
    -- Not all fields apply to all analysis types (NULL when not applicable)
    confidence DECIMAL(3,2),              -- Extracted from result (0.00-1.00) - applies to all types
    detected BOOLEAN,                      -- For escalation, upsell, kudos, competitor (NULL for sentiment, churn)
    risk_level VARCHAR(20),                -- For churn: 'low' | 'medium' | 'high' | 'critical' (NULL for others)
    urgency VARCHAR(20),                   -- For escalation: 'low' | 'medium' | 'high' | 'critical' (NULL for others)
    sentiment_value VARCHAR(20),           -- For sentiment: 'positive' | 'negative' | 'neutral' (NULL for others)
    
    -- Metadata
    model_used VARCHAR(100),             -- Which model was used (primary or fallback)
    reasoning TEXT,                       -- LLM reasoning/thinking steps if available
    
    -- Token usage tracking
    prompt_tokens INTEGER,
    completion_tokens INTEGER,
    total_tokens INTEGER,
    
    -- Timestamps
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    
    -- Constraints
    CONSTRAINT uniq_email_analysis_type UNIQUE (email_id, analysis_type)
);

-- Indexes for common queries
CREATE INDEX idx_email_analyses_email ON email_analyses(email_id);
CREATE INDEX idx_email_analyses_tenant ON email_analyses(tenant_id);
CREATE INDEX idx_email_analyses_type ON email_analyses(analysis_type);
CREATE INDEX idx_email_analyses_confidence ON email_analyses(confidence);
CREATE INDEX idx_email_analyses_detected ON email_analyses(detected); -- For escalation, upsell, kudos, competitor
CREATE INDEX idx_email_analyses_risk_level ON email_analyses(risk_level); -- For churn
CREATE INDEX idx_email_analyses_urgency ON email_analyses(urgency); -- For escalation
CREATE INDEX idx_email_analyses_sentiment_value ON email_analyses(sentiment_value); -- For sentiment
CREATE INDEX idx_email_analyses_tenant_type ON email_analyses(tenant_id, analysis_type);
CREATE INDEX idx_email_analyses_tenant_type_detected ON email_analyses(tenant_id, analysis_type, detected); -- For querying detected escalations/upsells/etc.
CREATE INDEX idx_email_analyses_tenant_type_risk ON email_analyses(tenant_id, analysis_type, risk_level); -- For querying churn risk
CREATE INDEX idx_email_analyses_created_at ON email_analyses(created_at);

-- Comments for documentation
COMMENT ON TABLE email_analyses IS 'Stores analysis results for individual emails. Each email can have multiple analysis results (one per analysis type).';
COMMENT ON COLUMN email_analyses.analysis_type IS 'Type of analysis: sentiment, escalation, upsell, churn, kudos, competitor, signature-extraction';
COMMENT ON COLUMN email_analyses.result IS 'The analysis result as JSONB. Structure varies by analysis_type. Full result preserved for flexibility.';
COMMENT ON COLUMN email_analyses.confidence IS 'Confidence score extracted from result for easy querying (0.00-1.00). Applies to all analysis types.';
COMMENT ON COLUMN email_analyses.detected IS 'Boolean flag extracted from result. Applies to: escalation, upsell, kudos, competitor. NULL for sentiment and churn.';
COMMENT ON COLUMN email_analyses.risk_level IS 'Risk level extracted from result. Applies to: churn. NULL for other analysis types.';
COMMENT ON COLUMN email_analyses.urgency IS 'Urgency level extracted from result. Applies to: escalation. NULL for other analysis types.';
COMMENT ON COLUMN email_analyses.sentiment_value IS 'Sentiment value extracted from result. Applies to: sentiment. NULL for other analysis types.';
COMMENT ON COLUMN email_analyses.model_used IS 'Which LLM model was used (primary or fallback)';
COMMENT ON COLUMN email_analyses.reasoning IS 'LLM reasoning/thinking steps if available from the model';
