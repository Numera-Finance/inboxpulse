# How an email becomes a verdict

## The four services *in this pipeline*, and the boundary between them

*Ten services run in total (see `03-ARCHITECTURE.md`). These four carry an email
from Gmail to a stored verdict.*

| service | owns | never does |
|---|---|---|
| `crm-gmail` | talks to Gmail: fetch, parse, filter, forward | **never writes the database** |
| `crm-api` | owns the database, orchestrates, persists | |
| `crm-analysis` | runs prompts, returns JSON | **never touches the business database** |
| `crm-embeddings` | Ollama + `nomic-embed-text` | (no TypeScript at all — just the container) |

The boundary is deliberate: *"All writes happen in apps/api inside a single
transaction so partial-write inconsistency is impossible."*

## Ingestion

Mail arrives by **Gmail Pub/Sub push**. The webhook verifies a token, decodes
`{ emailAddress, historyId }`, creates a `runs` row, and starts the sync
**without awaiting** so it can return fast. Failures land on the run row, not in
the response.

> If `PUBSUB_VERIFICATION_TOKEN` is unset, **the request is allowed through**.

**The watch covers INBOX *and* SENT on purpose.** Sent messages are never stored;
they are read only to capture the first-reply timestamp on the customer email
they answer.

**Initial sync reverses Gmail's ordering.** Gmail returns newest-first; the sync
processes oldest-first so a customer email is always stored before the reply that
answers it. Otherwise the reply arrives before its thread exists, gets dropped,
and the response time is lost forever.

### The two-phase fetch is where the money is saved

If the integration carries a blacklist, a **metadata-only** fetch pulls just
`From, To, Cc, Auto-Submitted, Precedence`. Only survivors get a full fetch.
Blacklisted-by-domain senders — your own staff, replying outward — produce a
**first-reply marker** instead of a stored row.

### What is deliberately never stored

Reply and outbound mail. Blacklisted senders. Drafts and spam. Mail with no `To`
recipients. Duplicates, caught by two layers: RFC `Message-ID`, then a SHA-256
content hash. And **Bcc is stripped from every prompt** — *"a blind recipient is
invisible to everyone on the thread, and a search string built from one would
leak that they were copied the moment a reader saw the results."*

`emails.body` stores the **full, untrimmed** message. Trimming happens per-call,
in memory.

## The eight analyses

Each is a `{ module, models, settings }` triple. All eight use
**`gemini-2.5-flash`** — primary and fallback are the same model.

| type | version | on by default? |
|---|---|---|
| `sentiment` | **v1.9** | **yes** |
| `upsell` | v1.3 | **yes** |
| `churn` | v1.1 | **yes** |
| `signature-extraction` | v1.2 | **yes** |
| `context-search-string` | v1.1 | **yes** |
| `escalation` | v1.0 | no — negative sentiment drives the workflow instead |
| `kudos` | v1.0 | no |
| `competitor` | v1.0 | no |

> The comments beside `kudos` and `competitor` still read "Enable kudos
> detection" next to `false`. Misleading; they are off.

**One batched call, not eight.** Multiple analyses are combined into a single
prompt with a combined schema. Only if that throws does it fall back to parallel
individual calls, and a failure is captured rather than thrown.

**Inngest retries are set to 3, not 10**, deliberately: *"Most analysis failures
are deterministic (schema-validation mismatches), so high retry counts multiply
LLM cost without improving success rate. The Jun 2026 cost spike was amplified by
emails burning all 10 attempts."*

`analysis_status = Completed` short-circuits the job. **Resetting it re-triggers
model spend.**

## The sentiment prompt

`apps/analysis/src/analyses/modules.ts`, ~11,500 characters. Its spine:

1. Default to **NEUTRAL** — "95%+ of business emails are neutral".
2. **The one question:** does the client state or imply that *we* did something
   wrong, failed to deliver, missed something, were too slow, or caused them a
   problem?
3. **Assertion, not inquiry.** "Please send me the reports" is neutral. "No
   vendor bills entered. Please send me the reports" is negative.
4. **Asking *when* is a complaint** when the work is already ours. "This is the
   politest form a complaint takes, and the easiest to miss."
5. **Urgency is not escalation.** A deadline alone is neutral.
6. Four documented over-firing cases: third-party frustration, fee discussion,
   time pressure alone, and mail not about our firm.

Its own accuracy note: *"Measured on 120 production negatives, the classifier is
right about 72% of the time and over-fires on the rest… It does not under-fire.
Correct the over-firing WITHOUT becoming reluctant — a missed complaint costs
more than a false one."*

> **v1.9 is not backed by a measurement**, and says so. An A/B against v1.8 was
> abandoned as unsound: reproducing the prompt outside the structured-output path
> required bolting a "return JSON" instruction onto it, which changed behaviour
> enough that a third of responses failed to parse. *"The harness was measuring
> itself."* The change is kept because it is better specified. What actually
> protects the reader is `checkQuotes()` at display time.

**If you change the wording, bump the version.**

## The filters, in the order they fire

1. **Blacklist**, during sync — never fetched in full.
2. **`third-party.ts`** — the only prefilter wired into the request path. It
   skips mail from a client's *own* customer-facing platform. Blue Ocean Pool
   Service is a client; `poolbrain.com` is the software that emails their
   homeowners, and **42 of those replies sat in the training set as complaints**.
   Correct sentiment, wrong product: *"a bookkeeper in Pune gets escalated a pool
   complaint from a homeowner in Texas."*
3. **`EmailFilterService`** inside `/analyze` — a five-stage cascade ending in a
   paid LLM classification, discarding spam/marketing/transactional/automated.
4. **Keyword rules** — a tenant keyword match resolves the verdict with no model
   call (`modelUsed: 'keyword-match'`).

**Two prefilters are built and unwired**, and the superseded one says so:

```
score.ts (tf-idf)      PR-AUC 0.221   84% kept at 40% sent   3.7 MB vocabulary
berne-whiskers (768d)  PR-AUC 0.264   89% kept at 40% sent   7.5 KB
```

*"20x better on 500x less… This file is bigger and older and therefore looks more
established, which is the only reason it might get picked."* Both **fail open** —
a gate that dropped mail it could not parse would turn a parser bug into missing
escalations.

## Extraction: five copies of one transform

Before a model call, the quoted chain and signature are stripped. The API path
uses `html-to-text` plus talonjs plus email-reply-parser; the **difference
between two libraries' output is how the signature is isolated**.

There are **five independent implementations** of nearly the same transform — the
API extractor, the add-on's hand-rolled regex version, the retrieval query, the
unwired prefilter, and a Python copy in the embedding backfill. Three of them
carry comments saying they must stay in step with something else.

Measured on the add-on path: stripping cuts billed characters by **51%**, median
body 17,274 raw against 1,232 stripped.

## First-reply attribution, and a bug in it

A reply counts only when it is not auto-submitted, has an external recipient,
and — **the originator rule** — the answered email's own sender appears in the
reply's To or Cc.

Two paths converge on one set-based UPDATE, guarded by `first_reply_at IS NULL`
so an earlier value is never overwritten.

**ADR-005:** the thread join was scoped to the *submitting* integration. That
mirrors the uniqueness constraint and reads as correct, but reconnecting a
mailbox mints a **new integration row**, and the same Gmail threads acquire a
second set of thread rows. One mailbox reconnected three times had **66,527
thread rows across three integrations, only 46% under the active one** — matching
the observed 46% marker match rate exactly. **62,562 unanswered customer emails
sat on superseded threads.** Now matched on `(tenant, provider_thread_id)` across
every integration.

> **Expect TAT to jump.** Those 62,562 emails became matchable. A reply landing
> today on an April email yields a delta of ~3,000 hours, and the metric averages
> with no upper bound. The numbers are genuine; the shift is an artifact of the
> deploy, not of changed behaviour.

### Known defect: `first_reply_by_id` is never written

`runFirstReplyUpdate`'s `SET` clause writes `first_reply_at` and `updated_at`
only. The machinery that computes the author runs — `attributeRepliesToUsers`
resolves it, the VALUES row carries `replied_by_id` — and the value is then
discarded.

Verified live on this tenant: **16,290 rows have a reply time; 2,065 have an
author.**

The cause is traceable: the squashed port `72f8231` replaced a
`DISTINCT ON (e2.id) … ORDER BY e2.id, r.reply_at` form, which could carry the
winning row's author, with `MIN(r.reply_at) … GROUP BY e2.id`, which cannot. The
later merge preserved that hunk.

Two consequences: the doc comments above the method describe code that is not
there, and downstream code has adapted to the sparseness — "Slowest to answer
unhappy clients" attributes by **allocation**, not by who actually replied,
precisely because this column is 7% populated.

Fixing it means restoring a form that picks the author of the winning reply, not
just adding a column to the `SET`.

## Embeddings

`nomic-embed-text`, 768 dimensions, stored as `halfvec` and L2-normalized at
write time. Ollama is **pinned to 0.32.9 with the model baked into the image**:

> *"A different implementation of the same model — transformers.js,
> sentence-transformers, Vertex — can differ in pooling, in normalisation, or in
> whether it silently prepends a task prefix, and the result is still 768
> plausible numbers. There would be no error, only a gate that has quietly
> stopped meaning what it was trained to mean."*

**Nothing in TypeScript reads or writes these columns.** Vectors are produced by
a manual Python backfill and consumed by two things that are both switched off —
retrieval and the embedding prefilter. The migration comment describes a sync
that writes embeddings on arrival; that was intended, not shipped.

## Retrieval: built, measured, off

`SENTIMENT_EXAMPLES_ENABLED` is not set anywhere. Measured against 49
human-judged emails, ten retrieved examples score the same as the 11,500-character
rulebook: 18–19 of 20 caught either way, nine false alarms either way.

The flag is read from `process.env` **directly, not through `getEnv()`**, and the
reason is worth knowing: *"getEnv() validates the WHOLE environment and calls
process.exit(1)… Routing an optional feature flag through that would give this
feature the power to kill the service on a cold path."*

## Triage: why did this email get no sentiment?

Check in order:

1. Was it a **reply or outbound**? Never stored.
2. Was the sender **blacklisted**? Never fetched.
3. Was it **deduped** by Message-ID or content hash?
4. Was it **third-party traffic** (`poolbrain.com`)? Skipped before the call.
5. Did the **classifier** call it spam / marketing / transactional / automated?
6. Did a **tenant keyword** resolve it without the model? Look for
   `modelUsed: 'keyword-match'`.
