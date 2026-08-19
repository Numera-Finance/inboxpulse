-- =============================================================================
-- Migration: Sentiment attribution (email_analyses.sentiment_target)
-- =============================================================================
-- Records WHO a sentiment verdict is aimed at, alongside the existing
-- sentiment_value (WHAT the verdict is).
--
-- Multi-party threads routinely carry strong sentiment directed at someone
-- other than the tenant — a vendor chasing the tenant's client for payment
-- while the tenant sits on Cc, or a client faulting a prior provider's work.
-- Previously the model had no participant information at all and folded these
-- into `negative`, which auto-created an escalation task for each one.
--
-- Ships with a matching application change: the analysis prompt now receives a
-- role-labelled participant roster (US / CUSTOMER / UNKNOWN_EXTERNAL) plus
-- per-message To/Cc, and the sentiment schema requires the model to commit to a
-- target before it may return `negative`.
--
-- Changes:
-- 1. Add sentiment_target column to email_analyses (nullable)
-- 2. Add composite index for "negative AND aimed at us" filtering
--
-- Backfill: none. Historical rows were classified without participant roles, so
-- their target cannot be recovered without re-running analysis. They keep
-- sentiment_target = NULL, which readers must treat as "not attributed" rather
-- than as "aimed at us" — see the note on consumers below.
--
-- NOTE for consumers: keyword-matched sentiment (analysis_keywords) also leaves
-- this NULL. A keyword hit asserts a value without establishing a target, and
-- inventing one would fabricate attribution. Any query that gates on
-- sentiment_target must decide explicitly how it treats NULL.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. email_analyses: add sentiment attribution column
-- -----------------------------------------------------------------------------

-- sentiment_target: 'us' | 'third_party' | 'none'.
--   us          — the sentiment is aimed at the tenant's own firm or its work
--   third_party — aimed at any other party on or named in the thread
--   none        — no directed sentiment (the neutral default)
-- NULL for non-sentiment analysis types, for rows predating this migration, and
-- for keyword-matched sentiment.
ALTER TABLE email_analyses
ADD COLUMN IF NOT EXISTS sentiment_target VARCHAR(20);

-- -----------------------------------------------------------------------------
-- 2. Index for attribution-aware sentiment filtering
-- -----------------------------------------------------------------------------

-- The dominant query is "negative sentiment that is actually about us"
-- (escalation creation, dashboards), so index the pair rather than the target
-- alone.
CREATE INDEX IF NOT EXISTS idx_email_analyses_sentiment_value_target
ON email_analyses(sentiment_value, sentiment_target);

-- -----------------------------------------------------------------------------
-- Verification queries (run manually to verify migration)
-- -----------------------------------------------------------------------------
-- Check column:
-- SELECT column_name, data_type, is_nullable FROM information_schema.columns
-- WHERE table_name = 'email_analyses' AND column_name = 'sentiment_target';

-- Check index:
-- SELECT indexname FROM pg_indexes
-- WHERE indexname = 'idx_email_analyses_sentiment_value_target';

-- Distribution once analyses start landing (NULL = unattributed / pre-migration):
-- SELECT sentiment_value, sentiment_target, count(*)
-- FROM email_analyses WHERE analysis_type = 'sentiment'
-- GROUP BY 1, 2 ORDER BY 1, 2;
