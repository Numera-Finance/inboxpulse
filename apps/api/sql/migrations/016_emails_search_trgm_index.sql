-- Trigram indexes for the AI Analysis search box.
--
-- That search used to match subject and participant name/email only. It now
-- also matches the message body, which is what makes these indexes necessary:
-- `body ILIKE '%term%'` is unanchored, so no B-tree index can serve it and
-- every query would otherwise sequentially scan the whole emails table and read
-- every message body in the tenant. pg_trgm's GIN operator classes are the one
-- index type that answers a leading-wildcard ILIKE.
--
-- Safe to re-run: the extension, both indexes and the schema qualification are
-- all guarded.
--
-- NOTE ON RUNTIME: building these reads every row in `emails` and takes a
-- table-level lock for the duration. On a large table prefer the CONCURRENTLY
-- form (commented out below), which does not block writes but cannot run inside
-- a transaction block — so run it on its own, not as part of a batch.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_emails_subject_trgm
  ON emails USING GIN (subject gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_emails_body_trgm
  ON emails USING GIN (body gin_trgm_ops);

-- Participants are matched by the same search, and both columns are short
-- enough that a trigram index over them stays small.
CREATE INDEX IF NOT EXISTS idx_email_participants_email_trgm
  ON email_participants USING GIN (email gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_email_participants_name_trgm
  ON email_participants USING GIN (name gin_trgm_ops);

-- Non-blocking alternative, if the lock above is unacceptable on a live table.
-- Run each statement separately, outside any transaction:
--
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_emails_subject_trgm
--     ON emails USING GIN (subject gin_trgm_ops);
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_emails_body_trgm
--     ON emails USING GIN (body gin_trgm_ops);
