# InboxPulse Add-on — data and schema

## The headline

**The add-on adds no tables and writes no rows.** It reads from the existing CRM
schema and writes only to Gmail (labels). "Analysed live. Not stored" is a
literal description of the data path, not a slogan.

## What it reads

### From Gmail, per request

Headers, thread messages, snippets, label ids. Read live via the Gmail API using
the token Google supplies with the request. **Never persisted.**

### From the CRM database, via `crm-api`

All reads, all enrichment, all viewer-scoped:

| table | used for |
|---|---|
| `customers`, `customer_domains` | resolve the sender's domain to a customer |
| `emails`, `email_participants` | message/thread counts, first and last contact |
| `email_analyses` | prior negative readings — "they raised this before" |
| `tasks` | open task count for the account |
| `contacts` | how many people we know there |
| `users`, `roles`, `user_accessible_customers` | who the viewer is and what they may see |
| `integrations` | resolve a Gmail address to a tenant |

Every one of these is enrichment. The thread reading does not depend on any of
them, which is why a 2s timeout that drops them is acceptable.

## What it writes

**Only Gmail labels**, all namespaced `⚡/`:

```
⚡/Focus          ⚡/Unhappy          user-chosen        model-derived
⚡/Research       ⚡/Needs a time
⚡/Block time     ⚡/Waiting on you
⚡/Waiting on     ⚡/Opening
```

Removable in one operation, by name prefix. The legacy prefix `InboxPulse ⚡/` is
still recognised so labels written before the rename stay reachable.

`createTaskForViewer` can insert a `tasks` row — the only database write — and
refuses unless the viewer is entitled to that customer.

## Schema changes in this work

**None.** One query correction:

```diff
- WHERE tenant_id = $1 AND customer_id = $2 AND status <> 2
+ WHERE tenant_id = $1 AND customer_id = $2 AND status = 0
```

`TaskStatus` is `OPEN: 0, DONE: 1`. There is no 2, so the old filter matched both
and counted **every task ever created** as open — 964 against 145 across the 348
customers with any completed task.

## Schema changes that would be needed next

| feature | change |
|---|---|
| connectors (Canopy, QBO, Streak, GChat) | `integrations.source` enum values — it is `gmail / outlook / slack / other` today |
| durable label expiry | a table of `(viewer, thread, label, expires_at)` plus a stored refresh token for the sweeper |
| provenance on analyses | `email_analyses.model_used` is populated on **6 of 139,642** rows; none of the 34,600 sentiment rows |

## Data-quality findings worth knowing

These shaped the design and will bite anyone reading the tables cold:

- **`CHURN_LOW` is not a flag.** 28,226 rows against 4,015 at medium or above,
  and sampled low rows carry reasoning that says in terms "no signs of churn".
- **The competitor flag is mostly a parser bug.** 1,947 of 3,595 hits matched a
  stopword — `"and"` chief among them — and the survivors include `"&"`,
  `"Accounting"` and `"Global"`.
- **Sentiment is overwhelmingly neutral**: 33,373 neutral, 1,017 negative, 210
  positive. Useless as a stratifier on its own.
- **`emails.labels` is a sync-time mirror.** It holds only Gmail system labels
  (`INBOX`, `UNREAD`, `CATEGORY_*`). Labels applied through the API never appear
  there — absence is **not** evidence a label was never applied.
