DROP TABLE IF EXISTS thread_analyses CASCADE;

-- Thread analyses table
-- Stores thread-level summaries for each analysis type
-- Acts as "memory" for the conversation, used as context for new email analysis
CREATE TABLE IF NOT EXISTS thread_analyses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    thread_id UUID NOT NULL REFERENCES email_threads(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    
    -- Analysis type (sentiment, escalation, churn, etc.)
    analysis_type VARCHAR(50) NOT NULL,
    
    -- Thread summary for this analysis type
    summary TEXT NOT NULL, -- LLM-generated summary of thread for this analysis type
    
    -- Analysis metadata
    last_analyzed_email_id UUID REFERENCES emails(id), -- Last email included in summary
    last_analyzed_at TIMESTAMP NOT NULL DEFAULT NOW(),
    
    -- Model and version used for summary
    model_used VARCHAR(100),
    summary_version VARCHAR(20) DEFAULT 'v1.0',
    
    -- Token usage tracking
    prompt_tokens INTEGER,
    completion_tokens INTEGER,
    total_tokens INTEGER,
    
    -- Metadata
    metadata JSONB, -- Additional context, confidence scores, etc.
    
    -- Tracking
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    
    CONSTRAINT uniq_thread_analysis_type UNIQUE (thread_id, analysis_type)
);

-- Indexes
CREATE INDEX idx_thread_analyses_thread ON thread_analyses(thread_id);
CREATE INDEX idx_thread_analyses_tenant_type ON thread_analyses(tenant_id, analysis_type);
CREATE INDEX idx_thread_analyses_last_analyzed ON thread_analyses(last_analyzed_at);
CREATE INDEX idx_thread_analyses_thread_type ON thread_analyses(thread_id, analysis_type);
