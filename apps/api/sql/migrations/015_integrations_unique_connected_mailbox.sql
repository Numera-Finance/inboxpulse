-- Enforce at most one CONNECTED integration per (tenant, source, mailbox).
--
-- Background (ADR-006): IntegrationRepository resolved an existing integration
-- with an `is_active = true` filter. Disconnecting a mailbox flips is_active to
-- false, so every reconnect missed the existing row and INSERTed a new one. One
-- production tenant accumulated 14 gmail rows, 13 of them the same mailbox.
-- Because email_threads is unique on (tenant_id, integration_id,
-- provider_thread_id), the same Gmail thread was then re-ingested under each new
-- integration id and the mailbox's history fragmented across rows.
--
-- The code fix (matching disconnected rows too, then reviving them) is the
-- primary guard. This index is the backstop that keeps the invariant true even
-- if a future caller inserts directly.
--
-- WHY PARTIAL (WHERE is_active):
-- The full invariant we eventually want is one row per mailbox regardless of
-- is_active. That index cannot be built today — the 13 legacy rows above already
-- violate it, and CREATE UNIQUE INDEX would fail. Restricting to connected rows
-- builds cleanly against production right now (verified: zero collisions across
-- all tenants) and captures the invariant that actually matters at runtime,
-- since every read path filters on is_active. The strict version ships with the
-- historical merge described in ADR-006, once the duplicates are collapsed.
--
-- WHY AN EXPRESSION INDEX:
-- `parameters` is a JSONB ARRAY of {key, value} objects, not an object, so the
-- mailbox cannot be reached with `->>`. jsonb_path_query_first finds the element
-- whose key is "email" and `#>> '{}'` unwraps the JSON scalar to text. Both are
-- IMMUTABLE, which an index expression requires. lower() makes the constraint
-- case-insensitive: Gmail addresses are case-insensitive, and the lookup in
-- IntegrationRepository matches on the stored string, so two casings of one
-- mailbox would otherwise be two rows.
--
-- The mailbox can live under any of three keys, so the expression COALESCEs them
-- in the same precedence the API already uses to derive connectedEmail
-- (email > impersonatedUserEmail > userEmail). Covering only "email" would leave
-- a service-account or legacy row indexing as NULL, and NULLs are distinct in a
-- unique index — so exactly the rows most likely to duplicate would be the ones
-- the constraint ignored. A row with no mailbox at all still indexes as NULL and
-- is unconstrained, which is correct: it has no identity to collide on.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_integrations_active_tenant_source_email
  ON integrations (
    tenant_id,
    source,
    (lower(COALESCE(
      jsonb_path_query_first(parameters, '$[*] ? (@.key == "email").value') #>> '{}',
      jsonb_path_query_first(parameters, '$[*] ? (@.key == "impersonatedUserEmail").value') #>> '{}',
      jsonb_path_query_first(parameters, '$[*] ? (@.key == "userEmail").value') #>> '{}'
    )))
  )
  WHERE is_active;

COMMENT ON INDEX uniq_integrations_active_tenant_source_email IS
  'At most one connected integration per tenant/source/mailbox. Reconnecting a mailbox must UPDATE the existing row (IntegrationRepository.findByTenantAndEmail), never INSERT a second one. See ADR-006.';
