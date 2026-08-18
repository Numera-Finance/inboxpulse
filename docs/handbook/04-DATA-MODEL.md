# The data model

*One PostgreSQL database. The schema is defined in **two places that must be read
together**: Drizzle definitions at `apps/api/src/*/schema.ts` (what the ORM
believes) and raw SQL under `apps/api/sql/` (what actually exists). They diverge,
and the divergences are listed at the end.*

## The tables, by domain

**Tenancy** — `tenants` (the firm), `roles` (per-tenant RBAC with a permission
integer array), `users` (employees).

**Access control** — `user_managers` and `user_customers` are the **sources of
truth**. `user_accessible_customers` and `user_subordinates` are **derived caches**,
rebuilt asynchronously through Inngest with a five-minute per-tenant debounce.
Editing a cache directly is pointless; the next rebuild overwrites it. If they
look stale, that is the debounce, not corruption.

**Customers** — `customers`, `customer_domains` (many domains per customer),
`contacts` (individuals, enriched from email signatures),
`customer_relationships` (marks a customer as **not** a client),
`customer_allocations` (the firm's allocation sheet).

**Email** — `email_threads`, `emails`, `email_participants`, `email_analyses`
(one verdict per email per analysis type), `thread_analyses` (a rolling
conversation summary fed back in as context).

**Work** — `tasks`, `task_comments`.

**Auth** — `better_auth_user`, `better_auth_session`, `better_auth_account`,
`better_auth_verification`, `login_history`.

> **Two user tables, deliberately.** `better_auth_user` is the login identity;
> `users` is the employee record. They are joined **by email, not by foreign
> key**. `better_auth_user.tenant_id` is a denormalized copy so middleware can
> resolve a tenant without a join.

## The single most confusing thing: two attribution paths

**An email is linked to a customer two different ways, and both are live.**

**Path A, the participant link.** `email_participants.customer_id`. Set at
ingestion when a participant resolves to a contact. It covers `from`, `to`, `cc`
and `bcc` alike — which is the problem.

**Path B, the sender's domain.** `emails.from_email`'s domain looked up in
`customer_domains`.

They disagree constantly. The measurement, from `apps/api/src/emails/repository.ts:298`:

> Of **1,484 participant rows** behind one population, only **275** were cases
> where the customer actually wrote.

Path A credits a client for mail they merely *received*. That is why the add-on
panel — which asks *who complained* — attributes by sender domain.

**The bug this caused:** a panel row reading "Berolzheimer — 3 unanswered" linked
to a page reporting "No analyzed emails found". Six emails by sender domain, one
by participant link, zero after the status and date filters.

**Neither path was dropped**, because participant links are often wrong but not
always absent. Four query sites now use `A OR B`: `findByCustomer`,
`countByCustomer`, the scoped email list, and the AI Analysis search.

| use | attribution |
|---|---|
| add-on management sections (fires, slow responders) | **B alone** — only the writer counts |
| access control, per-customer rollups | **A alone** |
| customer email lists and search | **A OR B** |

> Because Path B is an `EXISTS` over a `LEFT JOIN`, these queries need
> `selectDistinct` / `count(DISTINCT e.id)` — an email with several participants
> would otherwise multiply. Adding a participant join to an aggregate once took a
> headline from 501 to 2,089.

## Columns that will mislead you

**`emails.labels`** is an **ingested copy of Gmail's own labels** (`INBOX`,
`SENT`, `IMPORTANT`), written at sync time. **Our label writes never touch it.**
Do not read this column expecting to see labels InboxPulse applied — check Gmail.
Its real functional use is reply detection: `isReplyEmail` tests for `SENT`.
Unrelated to `customers.labels`, which is a `string[]` of business tags.

**`customers.is_auto_created`** — the ingester invented this customer from a
sender domain. Every management query filters it out: without that filter, the
unhappy-clients list is topped by invented records, and the population went from
188 threads to 30. **Migration 009 baked the literal `" (Auto)"` into the name**,
so the suffix is stored text, not a display decoration.

**`emails.first_reply_at` vs `first_reply_by_id`** — related, different vintages,
not consistent with each other.

- `first_reply_at` is *when* the first outbound reply arrived. **Reply emails are
  never stored as rows**; only this timestamp survives them.
- `first_reply_by_id` is *who* sent it, and shipped later with a rule change: a
  reply now only counts when addressed to that email's own sender.
- **No backfill was possible.** Old rows keep pre-change semantics and a NULL
  author. A timestamp with no author is **normal for old data**, not missing
  data. Even for new rows NULL is legitimate — shared mailboxes and aliases.

**`emails.signals integer[]`** — the flattened, queryable summary of all
analyses. 1–3 sentiment, 10 escalation, 20 upsell, 30–33 churn, 40 kudos, 50
competitor, 60–64 classification. Query with GIN operators (`@>`, `&&`), never
`= ANY`. The comment in `sql/emails.sql` stops at 50 and is stale.

**`emails.analysis_status`** — 1 Pending, 2 Processing, 3 Completed, 4 Failed. It
doubles as an **idempotency guard**: the analysis job skips anything already
Completed, so **resetting this value re-triggers model spend**.

**`email_analyses` extracted columns** — `confidence`, `detected`, `risk_level`,
`urgency`, `sentiment_value` are denormalized copies pulled out of `result` jsonb
**purely to be indexable**. NULL means "not applicable to this analysis type",
not "not analysed".

**`user_submitted_risk_level` / `user_submitted_sentiment_value`** — a human
suggesting a different tag. They sit **parallel to** the model's verdict and
**never overwrite it**, so the two stay comparable.

**`email_participants.participant_id`** — **polymorphic, no foreign key.** Points
at `users.id` or `contacts.id` depending on `participant_type`. Dangling values
are possible.

**`integrations.parameters`** — an **array** of `{key, value}`, not an object.
`->>'email'` will not work. The mailbox address may live under any of three keys.

**`emails.embedding halfvec(768)`** — `halfvec`, not `vector`: 2 bytes per
dimension, 0.21 GB against 0.41 GB. **The HNSW index serves
`ORDER BY embedding <=> $1 LIMIT k` and nothing else** — a window function over
it took 18 seconds *with* the index and 8.8 without.

## `customer_allocations` — the allocation sheet

The firm's own spreadsheet, loaded as a table. **4,724 rows, 857 clients, 181
people, six roles.**

`client_key` is the join key: the client's name **lowercased with every
non-alphanumeric character stripped**. It exists because only 116 of 857 rows
carry a domain while 774 match on name.

**About 454 rows (~9.6%) have a NULL `customer_id`.** That means the sheet knows
about an allocation that could not be tied to a `customers` row — **not** that
the client is unowned. Nullable by design, "so an unmatched allocation is still
stored and countable rather than silently dropped".

The usual cause is the sheet naming a client more fully than the CRM does:
`customers.name = "Falconx"` against the sheet's `"FalconX (Warp Drive, Inc)"`.
The visible symptom was a panel row reading "Falconx — 5 unanswered — no account
manager", which is a failed join reading as an accusation.

**Why this table rather than `user_customers`:** the latter has 100% coverage but
four to five owners per client and `role_id` NULL on all 4,111 mappings —
counting per owner charged one complaint to five people.

> **Three add-on endpoints return 500 if this table is missing** — `/fires`,
> `/slow-responders`, `/owner-load` — while `/waiting` and `/pulse` return 200.
> The add-on client swallows a non-OK response and returns `[]`, so the section
> renders empty and reads as "nothing to report".

## `customer_relationships` — absence means client

Only **non-clients** are ever inserted. A customer with no row is treated as a
client by default.

That direction was chosen deliberately: a missing row makes a vendor wrongly
appear in a review (visible), where the reverse would make a client vanish from
it (invisible). The table replaced a code constant that wrongly contained
`blueoceanps` — a real client — silently dropping it and 45 threads from
management review.

`kind` is text rather than an enum so a new kind needs no migration. Nothing
branches on the value; the metrics only ask whether a row exists.

## Migrations

Numbered files under `apps/api/sql/migrations/`, all idempotent and re-runnable.
Apply in numeric order — **note that `sql/README.md` lists 016 and 017 before
013–015**, an artifact of a union merge. Numeric order is still correct.

Two of them repay reading before you touch anything nearby:

- **`015_integrations_unique_connected_mailbox.sql`** — a partial unique
  expression index. Disconnecting a mailbox flipped `is_active=false`, so every
  reconnect INSERTed a new row. One tenant accumulated **14 gmail rows, 13 the
  same mailbox** — and because `email_threads` is unique on
  `(tenant, integration, provider_thread_id)`, every thread was re-ingested under
  each new id, fragmenting the mailbox's history.
- **`email_embeddings.sql`** — why `halfvec`, why L2-normalized at write time,
  why `embedding_model` must be recorded, and why the HNSW index answers only one
  query shape.

**A numbering collision was resolved by renumbering**: ours became 016 and 017.
Git also matched the two `013_*` files as a rename and dropped main's
`013_email_first_reply_by.sql` entirely; it was restored explicitly. `017`'s own
first line still says "Migration 014" — cosmetic, not a second file.

## Where Drizzle and SQL disagree

These are real and will bite:

| column | Drizzle says | SQL says |
|---|---|---|
| `emails.first_reply_by_id` | absent | exists (migration 013) |
| `emails.embedding`, `embedding_model`, `embedded_at` | absent | exist |
| `emails.analysis_status` | nullable | `NOT NULL DEFAULT 1` |
| `emails.signals` | nullable | `NOT NULL DEFAULT '{}'` |
| `customer_domains.customer_id` FK | not modelled | real FK with CASCADE |
| three `users` indexes | absent | exist |

`apps/api/src/schemas.ts` is **not a reliable table inventory** — it omits
`emailParticipants` and `customerDomains`.

Also vestigial: `emails.first_reply_email_id`, created by migration 001, present
in the database and in neither schema source.
