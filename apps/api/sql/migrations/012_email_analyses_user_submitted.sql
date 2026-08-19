-- Migration 012: user-submitted analysis tags on email_analyses
--
-- Lets a user in Gmail suggest an alternative churn risk level / sentiment for a
-- message without touching the AI's own verdict. The model-written columns
-- (risk_level, sentiment_value, result) are never modified by a suggestion; the
-- user's value lands in a parallel pair of columns so the two can be compared
-- (agreement rate, correction backlog, future re-training signal).
--
-- Layout mirrors the existing extracted columns: risk level lives on the row
-- whose analysis_type = 'churn', sentiment on the row with 'sentiment'.
--
-- Idempotent: safe to re-run.

ALTER TABLE email_analyses
    ADD COLUMN IF NOT EXISTS user_submitted_risk_level VARCHAR(20);

ALTER TABLE email_analyses
    ADD COLUMN IF NOT EXISTS user_submitted_sentiment_value VARCHAR(20);

-- Partial indexes: the vast majority of rows carry no suggestion, so only index
-- the ones that do (keeps these cheap on a table with ~100k analysis rows).
CREATE INDEX IF NOT EXISTS idx_email_analyses_user_submitted_risk_level
    ON email_analyses(user_submitted_risk_level)
    WHERE user_submitted_risk_level IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_email_analyses_user_submitted_sentiment_value
    ON email_analyses(user_submitted_sentiment_value)
    WHERE user_submitted_sentiment_value IS NOT NULL;

COMMENT ON COLUMN email_analyses.user_submitted_risk_level IS
    'User-suggested churn risk level (low | medium | high | critical), submitted from the Gmail extension. Applies to analysis_type = churn. NULL when no user has suggested an alternative. Never written by the analysis pipeline.';
COMMENT ON COLUMN email_analyses.user_submitted_sentiment_value IS
    'User-suggested sentiment (positive | negative | neutral), submitted from the Gmail extension. Applies to analysis_type = sentiment. NULL when no user has suggested an alternative. Never written by the analysis pipeline.';
