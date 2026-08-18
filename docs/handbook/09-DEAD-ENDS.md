# What was tried and did not work

*This document exists so nobody spends a week rediscovering these. Each entry has
a measured result, because "we tried it and it felt worse" is not a reason anyone
can act on.*

## The tone branches — all of them failed for one reason

**Hotspot clients read 94% Adult stance even in their angriest months.** They do
not start shouting. They stay polite and get unhappy more often. Every approach
that looked for a change in *register* was looking for something that is not
there.

| approach | measured | why it failed |
|---|---|---|
| Bag of words | PR-AUC 0.221 | beaten by embeddings at 1/500th the size |
| Hand-written idiom lexicon | 13% recall | 11 of 18 patterns never fired once; an invented register |
| Transactional analysis (ego states) | 11x lift | adds **zero** recall over sentiment already present |
| Politeness theory | p = 0.36 | B2B mail is uniformly polite; no separation |
| Per-client mood vector | flat | topic dominates the embedding; stance does not survive averaging |

The mood vector deserves a note because it is the most seductive idea here. Hold
a centroid per client domain, watch it move, and a shift should mean the
relationship is changing. **It stayed flat through a real escalation.** What
moves a client's centroid is what they are *talking about*, not how they feel
about it.

## Retrieval-augmented prompting

**Result: 18 of 20 caught, against 19 of 20 for the hand-written rulebook.**

The idea: instead of 11,500 characters of rules describing what a complaint looks
like, retrieve ten already-judged emails from this mailbox by similarity and show
the model the decided cases.

It matched the rulebook and did not beat it, at full pool density (35,653
vectors). Shipped disabled. The code is retained in
`apps/analysis/src/analyses/retrieval.ts` with its reasoning, because the
argument for it is still good and only the measurement is against it.

Three real bugs were found by running it against actual mail, and they are worth
knowing if anyone revisits this:

- The three nearest neighbours were all **the same conversation**. Replies quote
  each other and are near-identical in embedding space, so they crowd out every
  genuine example — and some carried the verdict for the exchange being judged.
  The whole thread must be excluded, not just the message.
- Complaints are 3% of mail, so the ten nearest neighbours of anything are almost
  always ten neutral emails. A model shown ten neutral examples learns that this
  mailbox is neutral, which is the exact bias the product exists to correct. The
  query balances classes, half each.
- A `ROW_NUMBER() OVER (PARTITION BY ...)` for that balance **cannot use an
  index** and took 18 seconds against 35,653 vectors. Split into two plain
  `ORDER BY ... LIMIT` queries it takes 2.8s, because that shape is what an HNSW
  index can serve.

## Nearest-neighbour promotion (k-NN)

**Result: 86% precision / 60% recall — but it is client memory, not complaint
detection.**

Take the nearest already-judged email and use its label directly, with no model
call at all. It beats the production model on precision (86% against 70%).

Excluding the client's **own** prior mail — the grouped split that leakage
requires when items share a source — costs half the recall and eleven points of
precision:

| | precision | caught |
|---|---|---|
| neighbours include the client's history | 86% | 12 of 20 |
| same sender domain also excluded | 75% | 6 of 20 |

So most of the lift is recognising *"this client complaining again"*, not
recognising a complaint. That is legitimate in production, where the history
genuinely exists, but it sets what may be claimed: **86%/60% on an established
client, 75%/30% on one with no history.** Quote the second when talking about
onboarding a new tenant.

Also: clearing mail as benign when all k neighbours are benign **loses 6 to 17 of
20 complaints**. Ruled out.

## Synthetic training data

**Result: +0.6 points, and the gain shrank as real data grew sixfold.**

Two models talking to each other, Monte Carlo style, to manufacture complaint
conversations. It helps when you have almost nothing and stops helping as soon as
you have real mail. A cold-start technique, not a supplement.

## Rising volume as an alert

**Result: 1.3x, and flat across thresholds.**

Covered fully in `06-SIGNALS.md`. The short version: it was reported as 68%,
which was measured over clients already known to have complained. Forward over
every client-week it catches 7.5% of complaints at 15.7% precision, and the lift
does not increase as the threshold rises — 1.5x usual volume and 3x usual volume
both land near 7.2%. That flatness is the tell that something correlated with
volume is doing the work.

## Automatic company matching by name or domain similarity

**Result: pairs unrelated companies. Rejected.**

The problem is real: a client's mail arrives from a domain no customer record
claims, so ingest creates a new record and the allocation stays on the old one.

| rule | pairs found | example failure |
|---|---|---|
| name prefix, 8 characters | 119 | *Americanexpress* → *AMERICAN NUTRITION ALLIANCE INC.* |
| domain-base prefix | 60 | *Prismahealth* → *Prisma Data, Inc.* |
| shared threads | 3,164 | vendors and cc'd third parties share threads too |

**A wrong owner sends someone to call the wrong client, which is worse than an
empty field.** What replaced these is documented in `04-DATA-MODEL.md`: a
per-client alias at the firm's own domain, which is evidence rather than
resemblance.

## Sensitisation — clients getting touchier

**Result: survivorship. Within a client it is a coin flip.**

Complaint gaps appear to shrink with each complaint, 8.2 days to the second and
3.7 to the sixth. But clients who complain often occupy the later positions by
definition, so the population changes as you read down the column. Comparing each
client's first gap to their last, across 46 clients with five or more complaints:
**24 got faster, 22 got slower.**

## The embedding gate

**Status: built, measured, never wired in.**

A linear model over embeddings that would drop obvious mail before it reaches the
model. Honest numbers from a fit that never saw the test mail: **1 in 5 sent
catches 7 in 10 complaints; 2 in 5 sent catches 9 in 10.**

It is not wired in because **there was never a cost case**. Reading every client
email costs about $7 a month. The gate would buy ordering and latency, not money,
and every email it drops is a complaint it can no longer catch. The classifier is
now the binding constraint: tightening the gate cannot recover a complaint the
judge misreads, because the gate already sent it.

If you wire it in, note the trap already caught once: `berne-whiskers.json`
carries coefficients fit on the **whole** corpus, correct for deployment and
fatal to measure. Scoring them back over that corpus reports 91% train / 89%
"held-out", and the flat line reads like generalisation when it is memorisation.
Quote `metrics`, which comes from a separate held-out fit.
