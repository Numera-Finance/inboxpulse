# Glossary

*Every term this handbook uses without explaining. Read it once; come back when a
word stops making sense.*

## The four surfaces, and what people call them

The single biggest source of confusion. **Four separate things put "InboxPulse"
in front of a user**, and people use the same words for different ones.

| Term used here | What it is | Where it lives |
|---|---|---|
| **the add-on** / "the panel in Gmail" | Google **Workspace Add-on**. Google-styled card, no tabs. | `apps/addon` |
| **the extension** / "the sidebar" | **Chrome extension** with tabs *Thread / Dashboard / AI Analysis / Customers / Users*. | `apps/chrome-extension` |
| **the web app** | React SPA, branded *Email Intelligence / Customer Insights*. | `apps/web` |
| **crm-manager** | A backend API with **no UI at all**. | `apps/manager` |

> **Ask "does yours have tabs?"** Tabs mean the extension. No tabs means the
> add-on. That one question resolves most ambiguous reports.

## Panel vocabulary

| Term | Means |
|---|---|
| **fires** | Clients with negative mail in 90 days — the "Where the fires are" section. Also the endpoint `/fires`. |
| **stirring** | Clients talking more than usual who have *not* complained. Endpoint `/stirring`, section "Talking more than usual". |
| **pulse** | Reply-time medians and trend. Endpoint `/pulse`. |
| **waiting** | Unhappy clients with no reply. Endpoint `/waiting`. |
| **the arc** | A client's monthly complaint rate, rendered as Rising / Cooling / Entrenched. |
| **Rising** | Latest monthly rate above the first, and not every month ≥10%. Newly slipping. |
| **Cooling** | Latest monthly rate at or below the first, and not every month ≥10%. |
| **Entrenched** | **Every** month at or above 10%. A relationship already in the state. |
| **engaged** / "In conversation" | 4+ messages from them in 7 days, 8+ in the preceding 28, **and** 3+ replies from us in 7. All three. |
| **the fold** | The bottom of the visible panel before scrolling. |
| **most in touch** | The owner shown came from the correspondence, not the allocation sheet. |
| **the teaching layer** | Naming the register device in an email ("a litotes", "a chase"). |

## Identity and access

| Term | Means |
|---|---|
| **tenant** | One customer firm of the product. Everything is scoped by `tenantId`. Today there is effectively one live tenant. |
| **viewer** | The person the panel resolves the request to: a row in `users`, found by matching the signed-in Gmail address. Not a better-auth identity. |
| **entitlement / entitlement-scoped** | Filtered by `user_accessible_customers` — which customers this viewer may see. **Admins bypass it entirely.** |
| **the allocation sheet** | `customer_allocations`, the firm's own spreadsheet of who owns which client, loaded as a table. |
| **consent** | Permission to read mail with a model. Recorded as the Gmail label **`⚡/Reading on`** — its existence *is* the record, so the user can revoke it by deleting the label. |
| **service key** | `SERVICE_API_KEY`, sent as `x-internal-api-key`. Grants `ALL_PERMISSIONS`. |

## Measurement vocabulary

| Term | Means |
|---|---|
| **client-week** | One client, one ISO week. The unit of every prediction number. 9,417 of them in the corpus. |
| **base rate** / **prior** | How often the thing happens with no signal. Here: **5.7%** of client-weeks are followed by a complaint. |
| **lift** | Rate given the signal, divided by the base rate. 24.7% ÷ 5.7% = 4.4×. |
| **recall** | Of all real complaints, the share caught. |
| **precision** | Of everything flagged, the share that was right. |
| **p90** | The value 90% of cases fall below. p90 of 125h means a tenth waited longer than five days. |
| **PR-AUC** | Precision-recall area under curve. A single score for a classifier on rare events. |
| **survivorship** | Selecting a population by its outcome, then measuring backwards. The error behind two retracted findings. |
| **TAT** | Turnaround time — how long until the firm first replied. |

## Register (the linguistic idea the product rests on)

**Register** is the way a language expresses attitude through *style* rather than
words. American professional English signals displeasure by **withdrawing
warmth** — dropping the greeting, shortening the sentence, omitting thanks —
rather than adding heat. The signal is in what is *missing*, which is why a busy
reader misses it.

| Device | Example |
|---|---|
| **litotes** | Understatement by negation: "not ideal", "less than helpful". |
| **counterfactual** | Naming what should have happened: "this should have been done last week". |
| **the chase** | Asking *when* about work already ours: "any update on the timeline?" |

**Transactional analysis / ego states / "Adult stance"** — Eric Berne's model of
Parent, Adult, Child modes of address. Tested here and abandoned: angry clients
still read 94% Adult. The file `berne-whiskers.json` is named after Berne; the
"whiskers" is box-plot whiskers. It is a joke, not a term of art.

## Technical terms assumed elsewhere

| Term | One line |
|---|---|
| **CardService / Cards v2** | Google's JSON format for add-on UI. Three text sizes, tiny HTML subset, no CSS. |
| **InboxSDK** | Third-party library the Chrome extension uses to inject a rail into Gmail. |
| **Inngest** | Background job runner. Retries, concurrency, idempotency. |
| **better-auth** | The session/SSO library. Replaced an older JWT scheme — **any doc mentioning JWT is stale**. |
| **Drizzle** | The TypeScript ORM. Its schema files can disagree with the real SQL. |
| **Hono** | The HTTP framework. **Routes match in registration order.** |
| **Pub/Sub** | Google's message queue. Gmail pushes change notifications through it. |
| **ADR** | Architecture Decision Record — numbered entries in `docs/decisions.md`. |
| **CTE** | SQL `WITH` clause. |
| **GIN index** | Postgres index for array/text containment; needed for `@>` and `&&`. |
| **HNSW** | The vector-similarity index. Serves `ORDER BY embedding <=> $1 LIMIT k` **and nothing else**. |
| **halfvec** | A 16-bit vector type. Half the storage of `vector`. |
| **talonjs / email-reply-parser** | Two libraries that strip quoted replies. The **difference between their outputs is the signature**, which is how the signature gets isolated. |
| **Ollama / nomic-embed-text** | The local model runner and the 768-dimension embedding model. Pinned, because a different implementation returns 768 plausible but incompatible numbers. |

## The names you will see in examples

Client and staff names appear throughout as **real worked examples**, because
abstract ones would not have caught the bugs: Berolzheimer, Truefoundry,
Hammerhead, Curium, Falconx, Aescape, Blue Ocean Pool Service. Staff names appear
in the slow-responder examples.

**Treat this handbook as internal.** It contains real client names and real
performance figures for named employees.
