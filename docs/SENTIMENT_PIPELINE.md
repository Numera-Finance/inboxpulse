# The sentiment pipeline

How a client's complaint reaches the person who needs to see it, what each stage
buys, and how to undo any of it.

## Why this exists

The people reading this mail are bookkeepers and accountants in India working for
American startups. They are fluent in English, but the register is not theirs —
and it is not general American English either, it is Silicon Valley operating
language where ordinary words carry fixed severity.

Of 20 complaints a native reader identified in a labelled sample, **only 5 used
explicit failure wording**. The other 15 carried their force in phrases that do
not mean what they appear to mean:

> "Could you please provide an update on the expected timeline for the completion
> of the FY2025-26 financials?"

No accusation, no failure named, every word courteous. Every American reader
knows a timeline chase is a complaint. That single email is the product.

The measure of any change here is whether it helps someone see that email sooner.
Not accuracy for its own sake — time to respond.

## The path

```
email arrives (crm-gmail)
   ↓
[1] embed          768 numbers, stored on the row          crm-embeddings
   ↓
[2] gate           dot product, microseconds               crm-api
   ↓  below the line → stops here, no model call, no cost
   ↓  above  the line
[3] retrieve       10 nearest already-judged emails        pgvector
   ↓                from the SAME tenant
[4] judge          Gemini, with those as worked examples   crm-analysis
   ↓
[5] store          verdict saved → becomes the next email's example
                   cron refits the gate's coefficients
```

Steps 3 and 5 close the loop: every judgement makes the next one better, and
nobody edits a prompt for that to happen.

### [1] Embed — `apps/embeddings`

**What it buys:** everything downstream. A stored vector makes scoring free and
retrieval possible.

**Why Ollama and not something lighter.** Every one of the 35,507 training
vectors and every coefficient in `berne-whiskers.json` came from
`ollama nomic-embed-text`. A different implementation of the same model —
transformers.js, sentence-transformers, Vertex — can differ in pooling, in
normalisation, or in whether it silently prepends a task prefix. The result is
still 768 plausible numbers. There would be no error, only a gate that has
quietly stopped meaning what it was trained to mean. Verified at **0.999997
cosine** against locally-produced vectors.

Pinned to `ollama/ollama:0.32.9`, model baked into the image so a cold start does
not wait on a 274 MB download.

### [2] The gate — `apps/api/src/emails/prefilter/berne-whiskers.ts`

**What it buys:** ordering and latency, *not* cost. Reading every client email
costs about **$7/month** at current volume, so there was never a cost argument
for dropping mail. The gate earns its place by putting the worst first and by
being instant — a dot product over 768 numbers, no model, no network.

Honest numbers, from a fit that never saw the test mail:

| sent | complaints caught |
|---|---|
| 1 in 5 | ~7 in 10 |
| 2 in 5 | ~9 in 10 |

The deployed threshold sits at 2 in 5.

**Do not re-measure the shipped coefficients against the corpus.** They are refit
on every row before shipping, which is correct and makes them unmeasurable
afterwards: scoring them back reports 91% on the training portion and 89% on the
"held-out" portion, and a flat line across the split reads like strong
generalisation when it is memorisation.

### [3] Retrieve — `apps/analysis/src/analyses/retrieval.ts`

**What it buys:** the end of hand-written rules, and per-tenant behaviour for
free. Ten decided emails score the same as 11,546 characters of rules, never
contradict each other, and improve as the mailbox is judged. A client who writes
tersely and one who buries the ask in pleasantries are each judged against their
own history without anyone tuning a prompt per customer.

**Currently off** (`SENTIMENT_EXAMPLES_ENABLED`). See "Not yet demonstrated" in
ADR-026.

### [4] Judge — `apps/analysis/src/analyses/modules.ts`

`gemini-2.5-flash`, prompt v1.8. Catches 19 of 20 on the human-judged set with 9
false alarms. This is the only paid step and the only one that decides anything.

**It is now the binding constraint.** Tightening the gate cannot recover a
complaint the judge misreads, because the gate already sent it.

### [5] The ratchet

Verdicts become training data. The classifier is refit; **the encoder is never
retrained** — see ADR-024. That is what stops the loop drifting toward its own
beliefs: a complaint the gate buried still sits near the ones it caught, in a
space that does not move, so learning from what was caught drags the boundary
toward what was missed.

Keep a random exploration slice regardless. It is the only mail not selected by
the thing being measured, and therefore the only way to notice rot if it starts.

---

## Backing out

Ordered cheapest first. Each step is independent of the ones below it.

### Turn off worked examples — seconds, no deploy

```bash
gcloud run services update crm-analysis --region=us-central1 \
  --project=project-y-email-sentiment \
  --update-env-vars=SENTIMENT_EXAMPLES_ENABLED=false
```

The flag must equal exactly `'true'` to be on; `1`, `yes` and `TRUE` all leave it
off. Every failure path — no vector, no judged history, query error, fewer than
four examples — already falls back to the written instructions, which is
production's current behaviour rather than a degraded one.

### Roll back the analysis service — one command

```bash
gcloud run services update crm-analysis --region=us-central1 \
  --project=project-y-email-sentiment \
  --image=us-central1-docker.pkg.dev/project-y-email-sentiment/crm/crm-analysis:3e7e521912fa771bcb44d5d164bb3257d43bee36
```

That tag is the revision that preceded retrieval. Record the current image
before any deploy:

```bash
gcloud run services describe crm-analysis --region=us-central1 \
  --format="value(spec.template.spec.containers[0].image)"
```

### Stop the embedding service

```bash
gcloud run services delete crm-embeddings --region=us-central1
```

Nothing in the request path calls it — embedding happens at sync time and at
backfill. Deleting it stops new vectors being written; existing ones keep working.

### Undo the schema — last resort

```sql
ALTER TABLE emails DROP COLUMN IF EXISTS embedding;
ALTER TABLE emails DROP COLUMN IF EXISTS embedding_model;
ALTER TABLE emails DROP COLUMN IF EXISTS embedded_at;
DROP INDEX IF EXISTS emails_embedding_pending_idx;
```

Rarely worth doing. The columns are additive, nothing else reads them, and
re-embedding 31,000 rows costs about 100 minutes and 30 cents.

### Revert the prompt

`version` in `modules.ts` is written onto every stored analysis, so a prompt
change without a version bump makes two different classifiers indistinguishable
in the data. Bump it, always. To compare versions after the fact, filter
`email_analyses` on `model_used` and the stored version.

---

## Failure modes already paid for

Recorded because each cost real time and none announced itself.

**A gate that silently costs 60% more.** `scoreEmbedding` assumed the caller had
normalised the vector. An un-normalised one does not error — it scores high on
everything, so the gate sends 67% of the mail instead of 42%. The only symptom is
the invoice. It now normalises internally.

**Mocked tests cannot see a wrong query.** Three retrieval bugs survived 234
passing tests and died on the first query against real data: neighbours from the
same thread, ten neutral examples at 3% prevalence, and pool-company complaints
recycled as lessons. Run every new query against the corpus before trusting it.

**A dead API scores like a cautious model.** The production prompt appeared to
catch 0 of 49 complaints. Every call was 403ing on an expired token and the
exception handler returned "not a complaint". Harnesses must abort loudly on an
error rate above a few percent, never fold failures into a verdict.

**Empty logs look identical to early progress.** A backfill chain sat deadlocked
for 1h47m because its wait condition was `pgrep -f harvest.py`, which matched the
waiting shell itself. It was caught by checking what the GPU was actually doing,
not by reading logs. Prefer a file-existence check over process matching.

**Text that was never stored cannot be classified.** One complaint is unreachable
by any prompt: its stored body is 7,752 characters of pure CSS, truncated
mid-declaration before the prose began. Outlook's style preamble is longer than
the sync limit. Check the stored body before blaming the classifier.

**Labels can be correct and still wrong.** 42 homeowner complaints about pool
cleaning were labelled negative — accurately, since they are complaints, just not
about us. The sentiment prompt was asked *is this negative*; the product question
is *is this client unhappy with US*. See `prefilter/third-party.ts`.
