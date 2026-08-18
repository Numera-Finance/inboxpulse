# First-Reply (TAT) Capture

How `emails.first_reply_at` / `emails.first_reply_by_id` — the time-to-response signal
behind negative-sentiment TAT reporting — get populated, and the blacklist interaction
that makes it subtle.

## What first_reply_at / first_reply_by_id mean

For a stored **customer** email (`is_customer_email = true`), `first_reply_at` is the
timestamp of the **earliest qualifying company reply that arrived strictly after it** in
the same thread, and `first_reply_by_id` is the user who sent *that same* reply.
Response time = `first_reply_at - received_at`. Reply (outbound) messages are
**never stored or analyzed** — only this trace is recorded on the customer email
they answer.

A reply qualifies only if **all** of the following hold:

1. It is outbound — SENT label or a sender on a tenant domain (`isReplyEmail`).
2. It is not automated — no `Auto-Submitted` / bulk `Precedence`, not a
   `noreply@`-style sender, and addressed to at least one external recipient
   (`isCountableReply`).
3. **It is addressed to that customer email's own sender — the originator —** in
   To or Cc. This is the per-row part of the rule, so it lives in the UPDATE
   rather than in the TypeScript classifiers.

Rule 3 is what makes attribution per *email* rather than per *thread*: on a thread
carrying mail from two customer contacts, a reply to one of them does not stop the
other's clock. A reply that goes only to colleagues, or only to a different contact,
is ignored entirely.

`first_reply_by_id` is resolved by matching the reply's sender against
`users(tenant_id, lower(email))`. It is **nullable**: a reply from a shared mailbox,
an alias, or someone never onboarded still sets `first_reply_at` — a human did respond
— we simply don't know who. Plus-addressing and other alias forms are not normalized.

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
`first_reply_at IS NULL` (never overwrites), `reply_at > received_at`, the originator
match, earliest-reply-wins, idempotent under redelivery. The marker schema already
carries `fromEmail` / `tos` / `ccs`, so it needed no change for the originator rule.

## The UPDATE

Both paths converge on `runFirstReplyUpdate`, which joins a VALUES table of
`(thread key, reply_at, recipients, replied_by_id)` against candidate customer emails:

```
AND r.reply_at > e2.received_at
AND LOWER(e2.from_email) = ANY(r.recipients)   -- the originator rule
```

and picks the winner with `DISTINCT ON (e2.id) … ORDER BY e2.id, r.reply_at` rather
than `MIN()`, so the timestamp and the replier come from the **same** message. (A
`replied_by_id NULLS LAST` tiebreaker keeps the pick deterministic when two replies
share a timestamp.) Addresses are lowercased on both sides.

## Operational notes

- **Watch labels:** the Gmail watch subscribes to `INBOX` + `SENT`. Label changes only
  take effect when `watch()` is re-invoked (re-auth or the renewal cron near expiry) — a
  watch registered by older code stays on its old labels until then.
- **Backfill:** historical replies are only recoverable while still in the mailbox's
  reach; there is no automatic backfill of `first_reply_at` for pre-existing emails.
  Rows written before the originator rule keep their old values and a NULL
  `first_reply_by_id` — the replies they were derived from were never stored, so
  nothing can be recomputed.
- **Coverage cost of the originator rule:** a team that answers from a shared address
  the customer never appears on, or replies to a thread's To list rather than its
  sender, will now leave those emails permanently unanswered — counted as pending
  rather than averaged into TAT. That is intended, but it is the failure mode to look
  for if TAT coverage drops after this change.
- **No tenant domains configured:** both paths disable reply attribution (we can't tell
  company mail from customer mail) and log a warning.

## Key code

| Concern | Location |
|--------|----------|
| Reply classification (shared) | `apps/api/src/emails/converter.ts` (`isReplyEmail`, `isCountableReply`, `toReplyAttribution`) |
| Replier → user resolution | `apps/api/src/users/repository.ts` (`findIdsByEmails`) |
| Full-email path | `apps/api/src/emails/service.ts` (`bulkInsertWithThreads`) |
| Marker path (API) | `apps/api/src/emails/service.ts` (`applyFirstReplyMarkers`) + route `POST /first-reply-markers` |
| Set-based UPDATEs | `apps/api/src/emails/repository.ts` (`setFirstReplyForThreads`, `setFirstReplyForProviderThreads`) |
| Header fetch + marker build | `apps/gmail/src/services/gmail.ts` (`batchGetMessageHeaders`), `apps/gmail/src/services/sync.ts` (`buildReplyMarker`) |
| Marker types | `packages/clients/src/email/types.ts` (`firstReplyMarkerSchema`) |
| Tests | `apps/api/src/__tests__/first-reply.integration.test.ts` |
