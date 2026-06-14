# First-Reply (TAT) Capture

How `emails.first_reply_at` — the time-to-response signal behind negative-sentiment
TAT reporting — gets populated, and the blacklist interaction that makes it subtle.

## What first_reply_at means

For a stored **customer** email (`is_customer_email = true`), `first_reply_at` is the
timestamp of the **earliest company reply that arrived strictly after it** in the same
thread. Response time = `first_reply_at - received_at`. Reply (outbound) messages are
**never stored or analyzed** — only their timestamp is recorded on the customer email
they answer.

A reply counts only if it is a genuine, human, customer-facing response
(`isCountableReply`): addressed to at least one external recipient, and not
auto-submitted / bulk (`Auto-Submitted`, `Precedence`, `noreply@`-style senders).

## Two ingestion paths

A company reply can reach us two ways:

1. **Full-email path** (`EmailService.bulkInsertWithThreads`): when a reply flows
   through normal sync, it's detected by `isReplyEmail` (SENT label **or** tenant-domain
   sender), partitioned into `replyEmails` (never stored), and its timestamp sets
   `first_reply_at` via `setFirstReplyForThreads`.

2. **Header-only marker path** (`EmailService.applyFirstReplyMarkers`): see below.

## Why the marker path exists — the blacklist interaction

The Gmail sync supports a per-integration **blacklist** (`integrations.parameters.blacklistEmails`)
that drops mail by sender email or **domain**. It filters at the *header* stage
(`SyncService.processMessageIds`, Phase 1) — blacklisted senders are never fetched in
full, never sent to the API, and never stored/analyzed. This is intentional: tenants
list their **own domains** to keep internal mail out of sentiment analysis (and to avoid
fetching bodies for a high-volume internal stream).

But the company's replies to customers are sent **from those same tenant domains**. So
the domain blacklist would drop exactly the messages first-reply capture needs — they'd
be discarded before the full-email path's `isReplyEmail` ever ran. (Symptom: a synced
"monitoring" inbox that receives customer mail but whose team replies from their own
mailboxes shows `first_reply_at = NULL` everywhere.)

### Resolution (do **not** remove tenant domains from the blacklist)

The blacklist keeps doing its job (no internal mail stored/analyzed, no body fetches).
Instead, when Phase 1 drops a sender on a **tenant (domain-blacklisted) domain** — whether
the domain rule or a specific email-blacklist entry matched — it builds a lightweight
**first-reply marker** from header metadata it already has and forwards it to the API:

- `threadId` and `internalDate` are **top-level fields** on the Gmail message resource —
  returned by `format=metadata` with **no body fetch** (and no extra API call; the
  blacklist already does a metadata GET per message). `batchGetMessageHeaders` also
  requests `To`/`Cc`/`Auto-Submitted`/`Precedence` for reply classification.
- `SyncService` collects markers `{ providerThreadId, fromEmail, tos, ccs, receivedAt,
  autoSubmitted, precedence }` and POSTs them to
  `POST /api/internal/emails/first-reply-markers` (best-effort — a failure never fails the
  sync).
- `EmailService.applyFirstReplyMarkers` applies the **same** `isReplyEmail` +
  `isCountableReply` rules (single source of truth in `converter.ts`) and calls
  `EmailRepository.setFirstReplyForProviderThreads`, keyed by `provider_thread_id` so no
  internal-id resolution round-trip is needed.

No email rows are created on this path. All the existing guards hold: `is_customer_email`,
`first_reply_at IS NULL` (never overwrites), `reply_at > received_at`, `MIN(reply_at)`,
idempotent under redelivery.

## Operational notes

- **Watch labels:** the Gmail watch subscribes to `INBOX` + `SENT`. Label changes only
  take effect when `watch()` is re-invoked (re-auth or the renewal cron near expiry) — a
  watch registered by older code stays on its old labels until then.
- **Backfill:** historical replies are only recoverable while still in the mailbox's
  reach; there is no automatic backfill of `first_reply_at` for pre-existing emails.
- **No tenant domains configured:** both paths disable reply attribution (we can't tell
  company mail from customer mail) and log a warning.

## Key code

| Concern | Location |
|--------|----------|
| Reply classification (shared) | `apps/api/src/emails/converter.ts` (`isReplyEmail`, `isCountableReply`) |
| Full-email path | `apps/api/src/emails/service.ts` (`bulkInsertWithThreads`) |
| Marker path (API) | `apps/api/src/emails/service.ts` (`applyFirstReplyMarkers`) + route `POST /first-reply-markers` |
| Set-based UPDATEs | `apps/api/src/emails/repository.ts` (`setFirstReplyForThreads`, `setFirstReplyForProviderThreads`) |
| Header fetch + marker build | `apps/gmail/src/services/gmail.ts` (`batchGetMessageHeaders`), `apps/gmail/src/services/sync.ts` (`buildReplyMarker`) |
| Marker types | `packages/clients/src/email/types.ts` (`firstReplyMarkerSchema`) |
| Tests | `apps/api/src/__tests__/first-reply.integration.test.ts` |
