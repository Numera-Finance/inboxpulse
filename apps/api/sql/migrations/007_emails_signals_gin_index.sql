-- Add GIN index on emails.signals for efficient array containment/overlap queries
-- Queries like WHERE signals @> ARRAY[1] or WHERE signals && ARRAY[1,2,3] will use this index
-- instead of doing full table scans.
CREATE INDEX IF NOT EXISTS idx_emails_signals_gin ON emails USING GIN (signals);
