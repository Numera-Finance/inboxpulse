-- Store an embedding per email, computed once at arrival.
--
-- The pre-filter decides whether a message is worth an LLM call. Its first
-- version carried a 3.7 MB tf-idf vocabulary and scored PR-AUC 0.221 on a
-- temporal hold-out. The same model over sentence embeddings scores 0.264 with
-- 7 KB of coefficients and no vocabulary at all — which also removes the decay
-- problem, since there are no words to go stale.
--
-- The vector belongs in the row rather than in the request path. The Gmail sync
-- already writes each email; embedding there means a message is scorable the
-- moment it lands, and scoring becomes a dot product against a column instead
-- of a call to a model service. A cron backfills what the sync missed.
--
-- 768 dimensions from nomic-embed-text, L2-normalised at write time so the
-- score is a plain dot product. halfvec rather than vector: 2 bytes per
-- dimension instead of 4, which is 0.21 GB for the current 134,836 emails
-- against 0.41 GB, and the precision loss is far below the noise in a
-- classifier trained on 1,058 positives.
--
-- Idempotent, per the migration rules in CLAUDE.md.

CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE emails ADD COLUMN IF NOT EXISTS embedding halfvec(768);

-- Which model produced it. A different embedding model means every coefficient
-- in berne-whiskers.json is meaningless, and that must be detectable rather
-- than silently wrong — the vectors would still be 768 numbers.
ALTER TABLE emails ADD COLUMN IF NOT EXISTS embedding_model text;
ALTER TABLE emails ADD COLUMN IF NOT EXISTS embedded_at timestamptz;

-- The backfill cron's working set: everything not yet embedded, newest first.
CREATE INDEX IF NOT EXISTS emails_embedding_pending_idx
  ON emails (received_at DESC)
  WHERE embedding IS NULL;

-- Similarity search over the same vector — "other threads that read like this
-- one". Built 2026-08-17, once retrieval of worked examples started querying by
-- similarity. 45 seconds to build over 35,653 vectors, concurrently, so writes
-- were never blocked.
CREATE INDEX CONCURRENTLY IF NOT EXISTS emails_embedding_hnsw_idx
  ON emails USING hnsw (embedding halfvec_cosine_ops);

-- WHAT THIS INDEX CANNOT DO, measured rather than assumed.
--
-- It serves `ORDER BY embedding <=> $1 LIMIT k` and nothing else. The retrieval
-- query originally balanced its examples with
-- ROW_NUMBER() OVER (PARTITION BY class ORDER BY distance), which is correct and
-- defeats the index completely — ranking within a class needs the distance for
-- every row, so Postgres sequential-scans all 35,653 vectors. That query took
-- 18 SECONDS with this index present and 8.8 without it; the index made it
-- slower by adding a plan the planner then declined to use.
--
-- Rewritten as two plain ORDER BY ... LIMIT queries it takes 2.8s.
--
-- The remaining cost is the complaints branch. Negatives are 3% of the corpus,
-- so an approximate scan reaches its limit before finding five and falls back.
--
-- FIRST FIX, applied: hnsw.iterative_scan. Measured on this corpus, 880ms ->
-- 261ms. It is pgvector's documented answer for exactly this selectivity regime,
-- and the ANN literature agrees that recall degrades below ~5% selectivity
-- (ACORN, SIGMOD 2024). Set with SET LOCAL inside the transaction in
-- retrieval.ts: the parameter only exists once the extension is loaded in a
-- session, ALTER ROLE is refused to the app user, and a pooled connection would
-- otherwise carry the setting into unrelated queries.
--
-- SECOND FIX, not applied: a PARTIAL index over negatives only:
--
--   ALTER TABLE emails ADD COLUMN sentiment_value text;   -- denormalised
--   CREATE INDEX ... ON emails USING hnsw (embedding halfvec_cosine_ops)
--     WHERE sentiment_value = 'negative';
--
-- which needs the label on this table, because an index cannot span two. Not
-- done: retrieval is off, and 2.8s in a background analysis is tolerable where
-- 2.8s in a request path would not be.
