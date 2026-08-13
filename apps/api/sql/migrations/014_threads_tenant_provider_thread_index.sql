-- 014: Index email_threads on (tenant_id, provider_thread_id)
--
-- Context
--   The first-reply marker path (setFirstReplyForProviderThreads) used to look up
--   threads by (tenant_id, integration_id, provider_thread_id), served by the
--   uniq_thread_tenant_integration unique index. Reconnecting a mailbox mints a new
--   integrations row, so the same Gmail threads acquire a second set of email_threads
--   rows under the new integration id — and every reply to a thread first seen under
--   an earlier connection stopped matching. The join now matches on
--   (tenant_id, provider_thread_id) across all integrations. See ADR-005.
--
--   No existing index leads with provider_thread_id — uniq_thread_tenant_integration
--   and idx_threads_integration_thread both put integration_id ahead of it. Measured
--   on production (PostgreSQL 18.4), the widened lookup does NOT seq-scan: PG18's
--   skip scan drives idx_threads_integration_thread with the leading column omitted,
--   costing one index search per distinct integration_id (5 searches, 20 buffers for
--   a single-thread probe). This index makes it one search instead, and keeps the
--   cost flat as reconnects add integrations — there are already 14 integration rows
--   for this one mailbox, 3 of which own threads. On PostgreSQL 17 and older, where
--   skip scan does not exist, it is the difference between an index scan and a
--   sequential scan of email_threads.
--
-- Change
--   email_threads: CREATE INDEX idx_threads_tenant_provider_thread (tenant_id, provider_thread_id)
--
-- Idempotent: safe to re-run.

CREATE INDEX IF NOT EXISTS idx_threads_tenant_provider_thread
    ON email_threads(tenant_id, provider_thread_id);

-- Verify:
--   SELECT indexname FROM pg_indexes
--   WHERE tablename = 'email_threads' AND indexname = 'idx_threads_tenant_provider_thread';
