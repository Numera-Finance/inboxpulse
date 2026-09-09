# What predicts trouble, and how to check it yourself

*Every number here was measured against this firm's own mail. None of it is
imported from a paper. Where a claim has been corrected, the correction is
stated, because the shape of the error recurs.*

## The one question

**Given what we can see about a client this week, what is the chance they
complain next week?**

Everything on the panel is an answer to that question. The base rate is the
number to hold in your head:

> Across **9,417 client-weeks**, **533** were followed by a complaint.
> **The prior is 5.7%.**

A signal is only worth a row on the panel if it moves that number materially.

## The ladder

| What we know about the client this week | client-weeks | P(complains next week) | vs prior |
|---|---|---|---|
| nothing — the prior | 9,417 | 5.7% | 1.0x |
| their volume doubled, but we are not replying | 1,131 | 4.4% | **0.8x** |
| their volume doubled | 2,658 | 7.2% | 1.3x |
| their mail is accelerating, three weeks running | 995 | 7.5% | 1.3x |
| **we are in a real back-and-forth with them** | 1,032 | 16.1% | 2.8x |
| **they complained in the last four weeks** | 1,181 | 16.9% | 3.0x |
| **both** | 384 | **24.7%** | **4.4x** |
| both, and complaints are still unanswered | 215 | **27.0%** | 4.7x |

Read the second row twice. **A client whose volume doubles while nobody is
replying is LESS likely to complain than average.** That is not noise: an
unattended volume spike is a notification stream, not a person getting angrier.
It is why the "we replied at least three times" condition is load-bearing rather
than hygiene.

## Why only two of the four signals count

Evidence only adds when it is independent. Engagement is worth 2.8x alone and a
recent complaint 3.0x alone; together they reach 4.4x, because each carries
something the other does not.

Volume and acceleration carry nothing new. Bolt volume onto the pair and 24.7%
becomes 25.0% while two thirds of the coverage is thrown away. Bolt acceleration
on and it drops to 23.7%. They look predictive alone only because loud, fast
weeks are mostly engaged weeks — once you know engagement, the volume term is
already spent.

## Definitions, exactly as the code computes them

**Engaged** (`FiresService`, `StirringService` in
`apps/api/src/addon/account-context.ts`): the client wrote **4 or more** messages
in the last 7 days, has **8 or more** in the preceding 28, and **we replied 3 or
more times** in the last 7.

**Complained recently**: at least one email from that client in the trailing four
weeks carries `email_analyses.sentiment_value = 'negative'`.

**Unanswered**: a negative email with `first_reply_at IS NULL`.

## Ordering the fires list, and the mistake that taught us the rule

The fires list shows six rows. For one day it was sorted by engagement first,
because engagement is the better predictor. That deleted the client who most
needed attention.

Berolzheimer had **three unanswered complaints**, more than anyone on the list,
and rendered nowhere. It sat one message under the engagement threshold on a
quiet week, so `engaged` flipped false and it sorted below six engaged clients
carrying zero or one unanswered complaint. `LIMIT 6` did the rest. It was
reported twice before the cause was found.

> **A predictor must not be the primary key of a short list.** Being wrong about
> a predictor does not reorder a client, it removes them.

The list now sorts `unanswered DESC, engaged DESC, negative DESC`. Unanswered is
an obligation rather than a forecast: three complaints nobody answered is not a
client who *might* escalate, it is a client already being ignored.

## Reply time: measured, reported, and not predictive

Over twelve months of client mail:

| | emails | answered | median | p90 | over 24h |
|---|---|---|---|---|---|
| negative mail | 861 | **53.0%** | 12.2h | 124.9h | 29.2% |
| ordinary mail | 29,666 | 36.1% | 14.6h | 189.6h | 37.5% |

The firm is **faster** on unhappy mail, not slower. The real gap is the 47% of
complaints that get no reply at all, and a p90 of five days.

Now the uncomfortable part. Raw numbers suggest replying *causes* complaints:

| that week, we… | client-weeks | P(complains next week) |
|---|---|---|
| answered nothing | 2,782 | 3.0% |
| answered within 4h | 817 | 9.4% |
| answered in 4–24h | 1,212 | 11.0% |
| answered in 24–72h | 536 | 12.3% |
| took over 72h | 889 | 9.3% |

That is the engagement signal wearing a disguise. We reply when something is
happening, and something happening is what predicts a complaint. Holding it
constant by looking only *inside* engaged weeks:

| engaged weeks, median reply | weeks | P(complains next week) |
|---|---|---|
| under 4h | 261 | 15.7% |
| 4–24h | 471 | 15.3% |
| 24–72h | 150 | 16.7% |
| over 72h | 150 | 18.7% |

**15.3% to 18.7% across a twentyfold range of response time**, on 150 weeks in
each tail bucket. The tail leans the right way; the counts cannot separate it
from flat.

## Two corrections, and the error they share

**Volume was reported as 68%.** That figure came from asking "did volume rise
before the complaint?" of clients selected *because they complained*. Run forward
as the alert it actually is, the same rule catches **7.5%** of complaints at
**15.7%** precision.

**Sensitisation was reported as real.** Complaint gaps appear to shrink as a
client accumulates them, 8.2 days to the second and 3.7 to the sixth. That is
survivorship: clients who complain often occupy the later positions by
definition. Within the same client, first gap against last across 46 clients:
**24 got faster, 22 got slower.** A coin flip.

Both are the same error. **Select on the outcome, measure backwards, report a
rate.** At a 5.7% prior it will make almost anything look strong.

> **Before believing any signal, ask two questions.**
> 1. Did the population get chosen by the outcome? If the denominator is "clients
>    who complained", the number describes history, it does not predict.
> 2. Does it survive conditioning on what you already show? A flat lift curve
>    across thresholds — 1.5x volume and 3x volume both landing near 7.2% — means
>    something correlated with the signal is carrying it, not the signal.

## Capital event: the one signal here that predicts nothing

Everything above is a posterior: P(trouble next week | what we can see), scored
against a 5.7% base rate. **Capital event is not that, and must not be read that
way.** It is an observation, not a prediction. The mail says a data room exists;
we report that a data room exists. There is no lift to quote because there is no
forecast being made.

It earns its place by a different test, the one in `07-DESIGN-PRINCIPLES.md`:
would seeing it change what somebody does? A client preparing a data room needs
diligence-grade books in weeks rather than months, and that is both a workload
the controller has to staff and an opening the sales rep has to work.

**Three flags, from sixteen requested categories.** Measured over 80,114
customer threads:

| | threads | genuinely a capital event |
|---|---|---|
| data room | 30 | **97%** |
| term sheet | 20 | **85%** |
| due diligence | 141 | 50% |
| cap table | 627 | **5%** |

The request listed sixteen categories. Three survived, because the list mixed
three kinds of phrase:

- **Event terms** are rare and mean something is happening now. These are the
  trigger.
- **Artifact terms** (`cap table`, `409a`, `SAFE`, `convertible note`) are
  almost always genuinely about that artifact, which is why they read well, and
  are near-useless as triggers: an outsourced CFO firm handles those artifacts
  continuously for companies that raised years ago. Booking convertible-note
  interest monthly. Refreshing a 409A annually because the option plan demands
  it. `cap table` is 95% about a cap table and 5% about an event.
- **Service terms** (`due diligence`, `financial projections`) appear in our own
  retainer letters, which sell "audit / due diligence support" as a service
  line, and in the disprz LMS, which runs a cap-table reconciliation course. The
  alert would fire on our own marketing.

**Named for the event, not the fundraise.** Of the twenty term-sheet threads, 8
are equity raises, 5 M&A and 3 debt. A fundraising-only tag discards the M&A,
where the controller workload is largest.

**Volume: about nineteen a year.** 58 hits across 1,481 candidate threads over
three years. That is the right order for a real capital event and the wrong one
for anything statistically validatable, so this is rules-and-review. **No
precision against outcomes is claimed**, because there is no labelled set of
clients who actually raised, and asking which raisers mentioned a data room
would measure backwards.

Code: `apps/api/src/emails/capital-event.ts`, deliberately outside the
tenant-configurable keyword map so `cap table` cannot be added back. Writes
`Signal.CAPITAL_EVENT` (70) and **no Gmail label**: `labelFor` returns null for
it, so this never touches a mailbox.

### What the row shows, and what it links to

Each row is one client and shows a **quote from the mail, not the subject line**.
The subject is usually administrative ("Re: Introduction") while the sentence
that matters is in the body, so the row carries the evidence and lets the reader
draw the conclusion.

```
Step Security, Inc.
Restarting our Series A in September, need your help on the model.
30d ago · 3 messages · Sandeep Shroff
```

The age is the **newest** mention, because a capital event is a deadline. The
name is the **sales rep** first, unlike every other section, which puts the
account manager first: this is the one signal whose action is commercial, so the
controller staffs the work and the rep opens the conversation. "no rep assigned"
means the allocation sheet has no rep for that client.

The whole row opens the AI Analysis page filtered to that client's capital-event
mail. Three conditions make that link meaningful, and each must hold when you
change either end:

1. **The destination filters on the signal.** `signal=capital-event` is handled
   by `getSignalFilterCondition`, which is a third filter path separate from the
   two in `EmailRepository`. See `03-ARCHITECTURE.md` for the contract that keeps
   an unhandled value from returning everything.
2. **The destination can display the row.** The AI Analysis page lists analyzed
   mail only, so the section requires `e.analysis_status = 3`. Ninety of the 130
   flagged emails qualify; the rest were never put through the model, and the
   rule does not need the model to fire. A client with no analyzed flagged mail
   does not appear (ADR-034).
3. **The windows match.** The section counts ninety days and the page defaults to
   thirty, so the link carries an explicit `from`.

### How the quote is chosen

**Which phrase:** the strongest present, by priority, not the earliest in the
body. `COALESCE` over an ordered list, never `LEAST`. A declaration outranks a
term sheet, which outranks a data room, which outranks an artifact word.
Position-first picks whichever phrase the bookkeeping happens to mention first.

**Where the sentence starts and ends:** the query returns a fixed 150-character
window opening 45 characters before the match, **plus the phrase's offset inside
it**. `tidyQuote` uses that offset to snap the start forward to the last clause
break before the phrase, never past it, then ends at the **first** sentence break
after it. It also drops a greeting that opens the window and cuts at a greeting
or sign-off that begins a later message in the chain.

The offset is load-bearing. Without it the function cannot tell a lead-in it
should drop from the evidence it must keep, and any start-snapping heuristic will
eventually push the phrase out of the window. The floor for every cut is the lead
plus 8, where 8 is the shortest phrase the extractor can match.

Code: `tidyQuote` and `CapitalEventsService` in
`apps/api/src/addon/account-context.ts`. `tidy-quote.test.ts` pins the boundary
behavior with strings taken from rendered output.

## How to re-derive all of this

Signals are computed from `emails.first_reply_at`, and **main's first-reply fix
writes forward only, with no backfill**. These numbers will drift. Re-measure
before quoting them in a customer conversation.

The queries live in this document's history and in `docs/EXPERIMENTS.md`. The
pattern is always the same:

1. Group client mail by sender domain and ISO week.
2. Exclude our own domains (derived from staff email addresses, never a
   hand-maintained list — one such list once contained a real paying customer)
   and the free mail providers.
3. Compute the condition for week *W*, and look at whether week *W+1* contains a
   negative email.
4. Report the rate against the 5.7% base, on every client-week, not on a selected
   population.

A worked example, and the exclusion that matters most:

```sql
-- poolbrain.com is a CLIENT'S OWN customer-facing platform. 42 homeowner
-- complaints about pool cleaning are correctly labelled negative and have
-- nothing to do with the firm's service. Leaving them in inflates everything.
AND e.body NOT LIKE '%poolbrain.com%'
```
