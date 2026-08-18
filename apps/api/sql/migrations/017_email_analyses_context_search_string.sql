-- Migration 014: register the context-search-string analysis type
--
-- `context-search-string` holds a Gmail search string generated from an email's
-- participants, subject and body, used to retrieve other threads that give the
-- reader context for it. Its result JSONB is
--   { intent: string, query: string, confidence: number }
-- where `intent` states what would count as useful context for the email. The
-- candidates are retrieved later and live, so they cannot be ranked at analysis
-- time; `intent` is the target a reranker scores them against.
--
-- There is NO structural change here. email_analyses stores one row per
-- (email_id, analysis_type) and analysis_type carries no CHECK constraint or
-- enum, so a new type is a new row value and needs no DDL to start writing.
-- What does need maintaining is the column comment, which enumerates the valid
-- types and is the only place in the database that documents them.
--
-- Idempotent: COMMENT ON is an unconditional overwrite.

COMMENT ON COLUMN email_analyses.analysis_type IS
    'Type of analysis: sentiment, escalation, upsell, churn, kudos, competitor, signature-extraction, context-search-string';

COMMENT ON COLUMN email_analyses.confidence IS
    'Confidence score extracted from result for easy querying (0.00-1.00). Applies to all analysis types. For context-search-string this is how likely the generated query is to surface genuinely related email.';
