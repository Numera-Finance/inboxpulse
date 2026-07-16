# InboxPulse — Business Rules (Technical Reference)

InboxPulse is a multi-tenant customer-communications intelligence platform for **MyStartupCFO** (a finance & accounting firm; product context is hard-coded into analysis prompts at `apps/analysis/src/analyses/modules.ts:144`). It syncs Gmail, classifies/analyzes email with LLMs, matches email to customer companies, measures response time (TAT) against implicit SLAs, and drives escalation tasks and manager digests.

**End-to-end flow:** Gmail change → Pub/Sub webhook (`crm-gmail`) → incremental sync → filter + parse → `crm-api` bulk-insert (dedup, thread upsert, inbound/outbound split, `first_reply_at`) → emit `email/inserted` → Inngest `analyze-email` → `crm-analysis` (classify + LLM) → persist signals/analyses, create customers/contacts/participants, auto-create escalation tasks → hourly cron sends manager escalation digests.

---

## 1. Email ingestion (Gmail sync)

### 1.1 Triggers → Implements: ING-1, ING-2, ING-3, ING-4
- **Pub/Sub push webhook** — `POST /webhooks/pubsub` decodes `{ emailAddress, historyId }`, resolves the integration by email, creates an `incremental` run, and fires the sync **in the background without awaiting**; errors are captured on the run row. (`apps/gmail/src/routes/webhooks.ts:20-78`, `apps/gmail/src/utils/pubsub.ts:30`)
- **Manual/internal HTTP** — `POST /api/sync/:tenantId` (incremental), `.../initial` (30-day). `.../historical` is a **501 stub**. Service-API-key protected. (`apps/gmail/src/routes/sync.ts:19,69,130`)
- ⚠️ **Pub/Sub auth is open by default** when `PUBSUB_VERIFICATION_TOKEN` is unset. (`apps/gmail/src/utils/pubsub.ts:12-24`)

### 1.2 Gmail watch → Implements: ING-5, ING-8
- Watches labels **`['INBOX','SENT']`**; SENT is watched only to capture reply timestamps. (`apps/gmail/src/services/gmail.ts:419-433`)
- Renewal: an API-side Inngest cron (`0 */4 * * *`, every 4h) calls the Gmail `renew-expiring` endpoint (window 2 days) **and** lazy renewal on every incremental sync (window 1 day, non-fatal). (`apps/api/src/integrations/inngest/functions.ts:22`, `apps/gmail/src/routes/watch-renewal.ts:37-124`, `apps/gmail/src/services/sync.ts:417-444`, `packages/clients/src/integration/client.ts:109-116`)

### 1.3 Incremental vs initial sync → Implements: ING-3, ING-4, ING-6, ING-7
- **Incremental** uses stored `lastRunToken` (Gmail historyId); missing token → falls back to initial. (`apps/gmail/src/services/sync.ts:21-71`)
- **Initial** backfills **last 30 days** (`services/sync.ts:81-84`), and **reverses newest-first results to oldest-first** so a customer email precedes the reply that answers it (`services/sync.ts:108`, rationale `:86-90`).
- **Chunking/checkpointing** in chunks of 50 via Gmail batch API; checkpoint persisted per chunk as the highest historyId. (`apps/gmail/src/services/sync.ts:139-292`, `apps/gmail/src/services/gmail.ts:116-240`)

### 1.4 Parsing → Implements: ING-12, ING-13, ING-14, ING-15
- Grouped by threadId, sorted ascending by Date header. Subject → `'(No Subject)'` when absent. Addresses without `@` dropped. **Body prefers HTML, falls back to plain text**. Priority from `x-priority`/`importance`. Captures rfcMessageId/references/inReplyTo/autoSubmitted/precedence. (`apps/gmail/src/services/email-parser.ts:25-295`)

### 1.5 Read-time filtering → Implements: ING-9, ING-10, ING-11, ING-12, DIR-5
| Stage | Rule | Location |
|---|---|---|
| Gmail fetch | Deleted/trashed/spam → 404 → skipped | `gmail.ts:234-240` |
| Gmail fetch | **Blacklist** (email vs domain lists), two-phase metadata-first fetch | `apps/gmail/src/services/sync.ts:151-242` |
| Parser | No recipients; `DRAFT`/`SPAM` labels; blacklisted sender | `email-parser.ts:46-69` |
| API insert | Outbound replies never stored (timestamp only) | `service.ts:541-543` |
- Tenant's own domains auto-added to the sync blacklist. (`apps/api/src/integrations/service.ts:207-255`)
- Domain-blacklisted senders are still forwarded as `FirstReplyMarker`s for TAT. (`apps/gmail/src/services/sync.ts:203-229,343-363`)

### 1.6 Deduplication → Implements: ING-16
- Two layers against DB **and** in-memory batch set: (1) exact RFC 2822 `Message-ID`; (2) SHA-256 content hash **only when Message-ID is missing**. Hash = `SHA-256(lower(from)+subject+body+sorted(tos)+sorted(ccs)+sorted(bccs))`. Existing messageIds upsert (refresh body/labels). (`apps/api/src/emails/service.ts:812-931`, `converter.ts:175-189`)

---

## 2. Threading → Implements: THR-1, THR-2, THR-3, THR-4, THR-5

- Thread key = `(tenant_id, integration_id, provider_thread_id)` unique; upsert via `onConflictDoUpdate`. **No subject normalization** (Re:/Fwd: kept). (`apps/api/src/emails/schema.ts:43-47`, `service.ts:649-667`)
- `firstMessageAt`+subject anchor to earliest **storable** email; `lastMessageAt = GREATEST(existing, incoming)` reflects all activity incl. replies, never regresses. (`service.ts:622-645`)
- Reply-only batch bumps `lastMessageAt` with no row; a reply before its thread exists is logged and dropped. (`service.ts:584-613`)

---

## 3. Inbound vs outbound classification → Implements: DIR-1..DIR-6

- **`isFromTenantDomain`** — lowercases from-address, checks `endsWith('@'+domain)`; suffix match so `attacker@nottenant.com` ≠ `tenant.com`; false when no domains. (`apps/api/src/emails/converter.ts:44-50`)
- **`isReplyEmail`** — outbound if `SENT` label **or** sender on tenant domain. (`converter.ts:60-66`)
- **`is_customer_email`** — `tenantDomains?.length ? !isFromTenantDomain : null` at insert; ⚠️ **null when domains unconfigured** (detection off, all mail stored). (`converter.ts:135-137`, `schema.ts:97`, `service.ts:538`)
- **`isCountableReply`** (TAT-strict) = `!isAutoSubmitted && hasExternalRecipient`; `isAutoSubmitted` covers `Auto-Submitted≠no`, `Precedence∈{bulk,auto_reply,junk}`, `noreply@`-style locals. (`converter.ts:83-120`)

---

## 4. First-reply capture (`first_reply_at`) → Implements: TAT-1..TAT-8

Shared rule in `runFirstReplyUpdate` (`repository.ts:2365`): set `first_reply_at = MIN(reply_at)` where `is_customer_email=true` **and** `first_reply_at IS NULL` (never overwritten) **and** `reply_at > received_at` (strictly after). Each customer email gets the earliest qualifying reply that followed it. (`first-reply.integration.test.ts:249-276`)
- **Path A — bulk insert:** partition into `replyEmails`/`storableEmails`; only `isCountableReply` replies set `first_reply_at`; all reply timestamps still advance `lastMessageAt`; failure non-fatal. (`service.ts:208-230,538-550`)
- **Path B — header-only markers:** blacklisted tenant-domain replies forwarded and run through the same rules, keyed by provider thread id; won't overwrite; ignores markers before the customer email; disabled without domains. (`service.ts:38-95`)

| Situation | `first_reply_at`? | `last_message_at`? | PRD |
|---|---|---|---|
| Human SENT/tenant reply to external | ✅ | ✅ | TAT-1 |
| Internal-only note | ❌ | ✅ | TAT-6, TAT-7 |
| Auto-submitted / bulk / `noreply@` | ❌ | ✅ | TAT-5, TAT-7 |
| `Auto-Submitted: no` | ✅ | ✅ | TAT-5 |
| Reply before thread exists | ❌ | ❌ | THR-5 |
| No tenant domains | ❌ (stored) | ✅ | DIR-6 |

---

## 5. TAT & SLA → Implements: SLA-1..SLA-12

> No SLA config entity, no `due_at`, no `breach` flag, no time-of-day window. "Business hours" = business **days** (Mon–Fri minus holidays). Thresholds are hard-coded buckets. Two TAT definitions coexist.

### 5.1 Average wall-clock hours → SLA-1, SLA-2
`AVG(EXTRACT(EPOCH FROM (first_reply_at - received_at))/3600)`, filtered `is_customer_email=true AND first_reply_at IS NOT NULL` (**answered only**), per customer. (`repository.ts:1229-1264`)

### 5.2 Elapsed business days ("single source of truth") → SLA-3..SLA-8, SLA-11
`buildTATBaseCTE` (`repository.ts:2163,2174`): count Mon–Fri non-holiday days in the inclusive `generate_series(received_at, COALESCE(first_reply_at, NOW()))`, then `GREATEST(0, COUNT-1)`. **This means only a same-business-day reply = 0 days; each additional business day = +1, so a next-business-day reply (e.g. Mon→Tue) = 1 day and is a "1+" breach.** Ranges spanning only weekend/holiday days also collapse to 0 (e.g. Fri→Sat). Unanswered accrue to `NOW()`. Timezone = account manager's (via `account_manager_role_id`, default UTC). Excludes spam/marketing/transactional/automated signals. (`repository.ts:2206-2265`, `tenants/schema.ts:12`)

### 5.3 SLA breach buckets → SLA-9, SLA-10, SLA-12
`getTATMetricsScoped`: `onePlusDays`(≥1&<2), `twoPlusDays`(≥2&<3), `threePlusDays`(≥3&<5), `fivePlusDays`(≥5&<6), `sixPlusDays`(≥6), grouped per customer, worst-first. Not configurable. (`repository.ts:2277-2300`, `routes.ts:262-267`)

### 5.4 Holidays → SLA-4, SLA-5, SLA-6
`holiday_calendars(date,timezone,name)` unique `(tenant,date,timezone)`; a holiday removes a day only when it matches **both** tenant and the AM's timezone. (`holidays/schema.ts:16-56`, `repository.ts:2259-2264`)

⚠️ **Known drift:** the `signal='tat'` filter path (`repository.ts:1657-1675`) is UTC-based, tenant-only holidays, unanswered-only — diverges from the canonical CTE (see PRD Q-2).

---

## 6. Company / customer matching → Implements: CO-1..CO-15

### 6.1 Key resolution → CO-2, CO-3, CO-4
`resolveCustomerKeyForEmail` maps each address → `(domain, defaultName)`: personal providers → per-address pseudo-domain (`uzi.dutta@gmail.com → uzi.dutta-gmail.com`); corporate → registrable last-two-labels (`mail.acme.com → acme.com`). ⚠️ Naive last-two-labels mishandles `co.uk`/`com.au` (PRD Q-5). (`packages/shared/src/types/personal-domains.ts:88-106`)

### 6.2 Matching precedence → CO-1, CO-5, CO-6
`ensureContactsInTransaction`: (1) domain lookup on `customer_domains`; (2) existing contact's `customerId`; (3) last-resort auto-create. By domain only — no fuzzy/name matching. (`analysis-service.ts:642-687`, `customers/repository.ts:43-77`)

### 6.3 Auto-create, naming, concurrency → CO-5, CO-9, CO-10, CO-11, CO-13
`ensureCustomerForEmail` idempotent; name precedence signature-company > domain default, tagged `" (Auto)"`; manual customers never renamed. ⚠️ Advisory lock **removed** (#143/f2e7464) — now races on unique index `uniq_customer_domains_tenant_domain` inside a SAVEPOINT, loser re-reads winner. (`apps/api/src/customers/service.ts:725-877`, `packages/shared/src/types/auto-customer.ts:41`)

### 6.4 Domains, schema, merge, import → CO-7, CO-8, CO-12, CO-14, CO-15
Multiple domains/customer, unique per tenant, lowercased. Customer columns: `is_auto_created`, `row_status` (ACTIVE/INACTIVE/ARCHIVED), `external_id` (unique per tenant), `labels`. Merge uses `FOR UPDATE`, reassigns children, archives source. Import matches externalId→domain, rejects cross-customer domain. (`customers/schema.ts:17-49`, `customer-domains-schema.ts:11-36`, `service.ts:435-512,995-1029`)

---

## 7. Contacts → Implements: CON-1..CON-6

- Identity `(tenant_id, email)` unique; dedup by lowercased email. Create with resolved `customerId` or backfill later without overwriting. (`contacts/schema.ts:35`, `analysis-service.ts:648-734`)
- Signature enrichment **fill-empty-only**, rejects placeholders, only when signature belongs to sender (same mailbox or same domain). Enrichable: name/title/phone/mobile/address/website/linkedin/x/linktree. (`contacts/service.ts:53-67,283-454`, `contacts/repository.ts:120-175`)

**Email participants** (access-control linkage, ⚠️ created **only after async analysis**, not at ingestion): rows are inserted in the Phase-2 analysis transaction (`analysis-service.ts:528-535` orchestration, `:816` `createParticipants`), while the ingestion path (`service.ts:703-720`, `repository.ts:55-68`) writes emails with **no** participant rows. Record builders (`collectEmailParticipants`/`buildParticipantRecord`) at `analysis-service.ts:1286-1371` link email→user/contact with denormalized `customer_id`; dedup first-seen wins `from>to>cc>bcc`; thread→customer resolution uses only the `from` contact (`repository.ts:659-700`). Consequence: un-analyzed emails are invisible to non-admin scoped queries, which all join through `email_participants` (`repository.ts:411-437`). (`email-participants-schema.ts:35-90`)

---

## 8. Keywords → Implements: KW-1..KW-4

Tenant keyword lists per category (`sentiment_positive/negative, escalation, upsell, churn, kudos, competitor`), cached 5 min. Whole-word case-insensitive regex over `subject+body`; hit → synthetic result tagged `modelUsed:'keyword-match'` and **excludes that type from the LLM call**; discarded for non-business emails. Note: `confidence:1.0` is set only for **sentiment** hits (`analysis-service.ts:308,314`); upsell/churn/kudos/competitor hits emit `detected:true`/`riskLevel:'medium'` with **no confidence field** (`:323,332,341,350`). (`keywords/service.ts:5-13`, `analysis-service.ts:289-392`)

---

## 9. Email classification → Implements: CLS-1..CLS-5

5 categories (`spam, marketing, transactional, automated, business`) via 5-stage cascade returning at first confident stage (thresholds 0.85/0.7/0.9/0.75): (1) content patterns, (2) sender reputation, (3) HuggingFace spam `roberta-spam`, (4) HuggingFace zero-shot `bart-large-mnli`, (5) LLM `gemini-2.5-flash`; default `business @0.5`. Filtered categories skip insights but **still return extracted participants**. (`apps/analysis/src/services/email-filter.ts:206-437`, `routes/analysis.ts:116-147`, `analysis-service.ts:224-229`)

---

## 10. AI analysis → Implements: AI-1..AI-17

### 10.1 Pipeline & framework → AI-1, AI-12, AI-13, AI-17
Two-phase (gather with no writes → single commit tx); Inngest `analyze-email` idempotent (skips if `Completed`). Executor tries one combined LLM call, falls back to individual calls, with per-call model fallback. Thread context = recent 5 emails, bodies truncated 300 chars. (`analysis-service.ts:137-168`, `framework/executor.ts:130-506`, `emails/thread-context.ts:27-89`)

### 10.2 Analysis outputs → AI-2..AI-9, AI-14
| Type | Fields | PRD |
|---|---|---|
| sentiment | `value/confidence/reason` | AI-2 |
| churn | `riskLevel/confidence/indicators/reason` | AI-4 |
| upsell | `detected/confidence/opportunity/product` | AI-5 |
| escalation | `detected/confidence/urgency/reason` | AI-6 |
| kudos | `detected/confidence/message/category` | AI-7 |
| competitor | `detected/confidence/competitors/context` | AI-8 |
| signature-extraction | name/title/company/contact fields | AI-9 |

One row per `(email, analysisType)` in `email_analyses` (JSONB + denormalized columns + model/version/token metadata). (`apps/analysis/src/analyses/schemas.ts`, `analysis-schema.ts`, `analysis-utils.ts`)

### 10.3 Config & defaults → AI-10, AI-11
7 types configurable per tenant (enable, model, prompt version, thresholds). Default-enabled: sentiment, churn, upsell, signature-extraction; default-disabled: escalation, kudos, competitor. ⚠️ Default fallback model = primary (`gemini-2.5-flash`) — PRD Q-6. (`packages/shared/src/types/analysis.ts:154-279`, `constants/models.ts:9-12`)

### 10.4 Prompt-encoded rules → AI-3, AI-5, AI-9
Sentiment v1.5: default-neutral, "assertion vs inquiry", "urgency is not escalation" (`modules.ts:27,58,68`). Upsell v1.3: new service not already in-flight (any `@mystartupcfo.com` participant doing the work ⇒ false, `:160-163`); taxonomy (`:167-186`) = Bookkeeping (basic/advanced), F&A operations, Custom reporting, Compliance and tax, F&A and company admin. Signature v1.2: must belong to sender (`:299-306`). (`apps/analysis/src/analyses/modules.ts:19-316`)

### 10.5 Caching & re-analysis → AI-15, AI-16
Postgres `analysis_cache` keyed `(messageId, sorted models)`, 7-day TTL, fail-open. ⚠️ Key omits tenantId + enabled-type list (PRD Q — collision risk). Re-analysis only for new emails or changed-body-not-yet-analyzed. (`cache-service.ts`, `routes/analysis.ts:199-202`, `service.ts:725-751`)

---

## 11. Tasks, access, notifications, jobs

### 11.1 Tasks → Implements: TSK-1..TSK-12
Status binary `OPEN=0/DONE=1` (no in-progress). Auto-create on negative sentiment from an external `from` contact with a customer; skip non-business categories and internal senders; idempotent per emailId; auto-assign Controller > Account Manager. Done captures problem/resolution/completedBy; reassign notifies; assignable = self+subordinates (admins any); transfer moves open tasks. (`tasks/schema.ts:23`, `analysis-service.ts:1136-1234`, `tasks/service.ts:259-411`, `tasks/repository.ts:318-584`)

### 11.2 Access, roles, tenancy → Implements: ACC-1..ACC-13
`tenantFilter` on every scoped query (never bypassed). Google SSO only; domain gate rejects unregistered domains; first tenant user = Administrator. Permissions int enum (USER_*/CUSTOMER_*/USER_CUSTOMER_MANAGE/ADMIN/TASK_*); system roles User/Manager/Administrator (unrenamable/undeletable); custom roles allowed. Matrix org (`user_managers`); denormalized `user_accessible_customers`/`user_subordinates` rebuilt async on change; admin bypasses access filters but not tenant. Login audit to `login_history`. (`packages/database/src/scoped-repository.ts:47-131`, `apps/api/src/auth/better-auth.ts:55-287`, `packages/shared/src/types/rbac.ts:11-116`, `apps/api/src/users/schema.ts:86-184`)

> Verified directly: `customerAccessFilter` at `scoped-repository.ts:47`, `tenantFilter` at `:66` (comment "MUST be included in every query - NEVER bypassed, even for admins" at `:64`), admin bypass at `:51`, `userAccessFilter` at `:127`.

### 11.3 Notifications → Implements: NOT-1..NOT-6
Email channel only (Postmark/SES); the channel type enum also declares slack/gchat/sms/mobile_push but none are wired. `task.assigned` (immediate, skipped if escalation not openable); `escalation.summary` (daily 8am in the manager's timezone, only when escalations exist). Per-user prefs (enable/frequency/cron), one-click unsubscribe, fail-open preference check. ⚠️ Send-**hour** hardcoded to 8am (`tasks/service.ts:748`, TODO at `:747`); the **timezone is per-manager** with an `Asia/Kolkata` fallback (`:742`) — not hardcoded (PRD Q-8). (`apps/notifications/src/templates/*`, `tasks/service.ts:741-920`, `apps/notifications/src/routes/index.ts:235-578`)

### 11.4 Background jobs (Inngest) → Implements: AI-17, ACC-12, ING-8, NOT-2, NOT-3
`analyze-email` (event, idempotent) · `rebuild-accessible-customers` (event, debounced 10s) · `escalation-notification-cron` (hourly) · `gmail-watch-renewal-cron` (every 4h) · notifications process-pending (1m) / process-pending-batches (5m) / send / process-batch. (`apps/api/src/inngest/*`, `packages/notifications/src/inngest/functions.ts`)

---

## 12. Runs (ingestion telemetry) — no PRD requirement

`runs` records each sync: `status` (running/completed/failed), `run_type` (initial/incremental/historical/webhook), item counts, historyId cursors, errors, timing. No TAT/SLA interaction. (`apps/api/src/runs/schema.ts`)

---

## 13. Cross-cutting drift / open items (→ PRD §14)

| PRD Q | Technical evidence |
|---|---|
| Q-1 | `converter.ts:135-137`; `service.ts:538` — domains-unconfigured disables detection/TAT |
| Q-2 | `repository.ts:1229-1264` (hours) vs `2174-2265` (business days) vs `1657-1675` (`signal='tat'` divergent) |
| Q-3 | `repository.ts:2292-2296` — hard-coded buckets, no config table |
| Q-4 | `analysis-service.ts:528-535,816` — participants inserted in analysis tx; ingestion path (`service.ts:703-720`) writes none |
| Q-5 | `personal-domains.ts:103-105` — last-two-labels domain rule |
| Q-6 | `constants/models.ts:9-12` — fallback == primary |
| Q-7 | `apps/gmail/src/routes/sync.ts:130` (501 historical); `apps/api/src/emails/thread-analysis-service.ts` (summaries off, `useThreadSummaries=false` at all call sites); `apps/analysis/src/services/domain-enrichment.ts:28-30` (enrichment unwired) |
| Q-8 | `tasks/service.ts:748` — 8am hour hardcoded (TODO `:747`); timezone per-manager with `Asia/Kolkata` fallback (`:742`) |

---

*Companion to PRODUCT_REQUIREMENTS.md. Verify every rule at its cited `file:line` before relying on it; update both docs when rules change.*
