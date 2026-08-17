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
-- one". Not needed by the gate, which only ever does a dot product against its
-- own coefficients, so create it when something actually queries by similarity.
-- Left here as the intended shape rather than built now: an HNSW index over
-- 134k rows costs build time and write amplification for a feature nobody has
-- asked for yet.
--
-- CREATE INDEX IF NOT EXISTS emails_embedding_hnsw_idx
--   ON emails USING hnsw (embedding halfvec_cosine_ops);
