# What we tried, what it measured, where we landed

72 hours of experiments on one question: **can we find the client emails that are
complaints, when three complaints in four never say so?**

Read this before proposing an approach. Most of the obvious ones have been tried
and measured, and several of the appealing ones are dead.

---

## The yardstick

**49 emails a person read and judged** (`apps/api/scripts/human-labels.json`),
20 of them complaints. Every precision and recall figure below is measured
against these unless stated otherwise.

We looked for an external corpus and there isn't one. Twitter customer service is
unlabelled; Ubuntu Dialogue has the wrong labels; MultiWOZ is role-play; Enron is
unlabelled; the CFPB complaint database has no negative class (every row is
already a complaint); Amazon and Yelp are public reviews, a different speech act
from private correspondence; the Hugging Face ticket sets are synthetic. **No
domain-matched public yardstick exists.** Those 49 rows are the only instrument,
which is why they are in the repo rather than in /tmp.

Two properties to keep in mind when quoting from them: 41% prevalence against ~3%
in the real corpus, so precision reads optimistic; and at n=49 a single
disagreement moves precision by two points. Treat gaps under ten points as noise.

---

## Branch 1 — Words

**TF-IDF + logistic regression.** 118,932 terms, 3.7 MB of vocabulary.
PR-AUC **0.221** on a temporal hold-out; sending 60% of mail kept 94% of
complaints. Shipped first (`prefilter/score.ts`, `model.json`), later superseded.

**Learning stance from words.** Trained the same machinery on ego-state labels to
detect "hackles raised" rather than complaint content. PR-AUC **0.049** — barely
twice base rate. The learned terms were function words: *re, why, dont, you guys,
asap*. **Dead.** Stance lives in punctuation, syntax and what isn't said; there is
no vocabulary of hackles.

**Hand-written idiom lexicon.** 18 patterns for the register a non-native reader
misses — litotes, understatement, challenge-as-question, the Silicon Valley
operating vocabulary. On the 50 emails it was written against: 100% precision,
60% recall. **On 250 held-out emails: 13% recall, 80% precision, and 11 of the 18
patterns never fired once** — the entire "SV register" set (*blocker*, *take it
offline*, *flagging*, *sanity check*, *circle back*, *bandwidth*). I had invented
a register that isn't in this corpus. **Dead as a matcher**, kept as a teaching
list.

**Mined phrases.** Rather than inventing patterns, mined them from the training
half: *should have been* (9.3× lift), *supposed to* (8.0×), *why the* (7.3×),
*i thought* (6.4×), *your team* (5.6×). Genuinely predictive alone — and **added
−0.5% on top of the embedding**. The embedding already knows them. **Dead as a
feature**, alive as explanation.

**Politeness theory** (Danescu-Niculescu-Mizil, ACL 2013). Borrowed the Stanford
classifier rather than building one. Complaints scored −0.60, non-complaints
+0.10, **Mann-Whitney p = 0.36**. **Dead.** B2B correspondence is uniformly
polite — *"Could you please fix the incorrect P&L"* is maximally polite and a
complaint. The Stanford corpus (Wikipedia, StackExchange) varies on politeness;
this corpus does not.

---

## Branch 2 — Transactional analysis (Berne)

The premise: a complaint is a move in a game, and the unit of analysis is the
transaction (their message, our reply), not the message.

**Unsupervised clustering of 4,000 transaction pairs.** Clusters recovered
*workflow* — reminder→promise, request→inline-reply, scheduling, out-of-office.
No games. **Topic dominates the embedding; stance does not survive it.** Route
closed.

**Direct LLM classification against Berne's taxonomy**, 400 transactions:

| | |
|---|---|
| no game | 85.8% |
| Blemish / Kick Me | 4.5% each |
| NIGYSOB / Why Don't You–Yes But | 2.0% each |
| See What You Made Me Do | 1.2% |

**Ego state as a predictor** — the strongest single signal found in the whole
week, and still not enough. Measured on 2,984 emails at 3.0% base rate:

| client's state | emails | complaint rate | lift |
|---|---|---|---|
| Adult | 2,921 | 2.4% | 0.8× |
| Parent | 49 | **34.7%** | **11.4×** |
| Child | 14 | **35.7%** | **11.7×** |

Flagging every non-Adult email: 2.1% of mail, **24% recall at 35% precision**.

Then the test that killed it: **does ego state add anything sentiment doesn't
already catch?**

| | recall | precision |
|---|---|---|
| ego state alone | 35% | 78% |
| LLM sentiment alone | 85% | 89% |
| either | 85% | 85% |
| both | 35% | 88% |

**Ego state adds zero recall.** Every complaint it finds, sentiment already
found. **Dead as a detector**, retained only as a priority signal — the
both-agree set is the hottest 8 emails.

**Prior art:** ego-state classification from text is essentially unpublished (one
2011 CSCW paper, Naïve Bayes, Japanese blogs, unverifiable behind a paywall).
Detecting Berne's games in real correspondence: **zero prior work**. No
commercial product claims it. We would have been first — the reason nobody has
done it appears to be that it doesn't work well enough.

The name survived. The classifier is called Berne Whiskers.

---

## Branch 3 — Embeddings

**Head-to-head against TF-IDF**, same temporal hold-out, same model class:

| | PR-AUC | at 40% sent | vocabulary |
|---|---|---|---|
| TF-IDF | 0.221 | 84% kept | 3.7 MB |
| `nomic-embed-text` 768d | **0.264** | **89% kept** | 7.5 KB |

20% better with 500× less to carry, and nothing to go stale — there are no words
to decay as clients and projects change. **Shipped** as `berne-whiskers.json`.

**The learning curve** (independently reproduced):

| training rows | positives | PR-AUC | catch at 1-in-5 |
|---|---|---|---|
| 2,642 | 65 | 0.103 | 59% |
| 10,568 | 305 | 0.191 | 66% |
| 26,421 | 755 | 0.234 | **69%** |

Aggregate ranking keeps improving. **The number we care about flattened at 69%
after about 10,000 rows.** More labelled data past that buys ranking quality, not
decisions — worth knowing before anyone proposes labelling another 30,000 emails.

**As a ranker, honestly measured** (a fit that never saw the test mail):

| sent | complaints caught |
|---|---|
| 1 in 5 | ~7 in 10 |
| 2 in 5 | ~9 in 10 |

The top 1% is 50% precision — 17× base rate — which is a usable "read these
first" list with no model call at all. It cannot be a verdict: at 3% prevalence
nothing can be both precise and complete.

**The ratchet does not rot.** Simulated 12 rounds of closed-loop retraining where
everything the gate dropped was recorded as "not a complaint" — the poison the
objection predicts. True recall improved at every send fraction (40%: 79%→88%;
20%: 58%→66%), and random exploration added nothing. **The frozen encoder is
why**: a buried complaint still sits near the caught ones in a space that never
moves, so learning from what was caught drags the boundary toward what was
missed. Fine-tuning the embedder would close the loop for real. ADR-024.

---

## Branch 4 — Judges and panels

**Single judges** on the 49:

| | recall | precision |
|---|---|---|
| gemini-2.5-flash | 95% | 66% |
| Haiku | 90% | 75% |
| gemini-3.1-flash-lite | 85% | 71% |

**Anchored cascade — dead.** Telling a strong second judge "a first-pass
classifier flagged this" made it confirm **24 of 24**, filtering nothing. Blind,
the *cheap* model was the stricter filter (85%/85%). The escalate-to-strength
intuition is backwards here.

**Two-judge agreement — not enough.** Both-yes was 85% precise; both-no still hid
2 real complaints. Judges given the same instructions make the same mistakes.

**Three-judge unanimity:**

| votes | emails | complaints | precision |
|---|---|---|---|
| 3/3 | 20 | 17 | 85% |
| 2/3 | 3 | 0 | **0%** |
| 1/3 | 8 | 3 | 38% |
| 0/3 | 18 | 0 | — |

**Majority voting is worse than unanimity** — the 2/3 bucket was 0 for 3. Dissent
means "don't trust this verdict", not "the minority is right" (minority votes
were right 6 times and wrong 5).

**The 120° idea, first attempt — dead.** Taken literally as three *different
questions* (stance, consequence, repetition), unanimous agreement scored **33%
precision — below every individual judge.** Votes only combine when they are
votes on one proposition; three answers to three questions are three facts.

**The 120° idea, second attempt — this is what shipped.** Same question, opposed
**prior**:

| judge | recall | precision |
|---|---|---|
| gemma3:27b as advocate | 100% | 43% |
| gemma3:27b as defender | 70% | 88% |
| qwen2.5:32b as advocate | 90% | 69% |
| qwen2.5:32b as defender | 60% | 92% |

One model spans 43→88% precision on identical inputs. **The prior is a bigger
lever than the model.** Rule: both defenders yes → positive (92% clean); both
advocates see nothing → negative (nothing lost); the disagreement band stays
unlabelled. ADR-023.

Also discovered: qwen's YES set was a strict *subset* of gemma's, so their AND
was just qwen and their OR was just gemma — **the panel was one judge wearing two
hats.** The priors decorrelated them, not the model pairing.

**`nemotron-3.5-lightning` — dead in every configuration.** 4% recall without
thinking, 15% with it. It answers only inside its reasoning block, and
`think:false` returns nothing at all.

**The dragnet tradeoff, measured.** The advocate alone missed **0 of 20**
complaints. Adding a defender to cut false alarms from 26 to 1 **lost 8 of the
20**. You cannot have both from a cascade — which is why the design became three
tiers that delete nothing, rather than one verdict.

At real prevalence (2,000 random production emails) the loose judge fires on
**79%** of mail, so the "quiet" tier is 21%, not the majority. The tiering
survives; the claim that it would absorb most of the inbox did not.

**What the panel is for.** Against production it is *stricter, not better* —
70%/60% recall versus production's 95%. **Its value is labelling training data
cheaply, not replacing the prompt.**

---

## Branch 5 — Synthetic training data

Generated complaint/neutral mail with an LLM, including two-LLM conversations
where a complaint emerges over three turns.

**A classifier separates synthetic from real mail at 100% accuracy.** Synthetic
sits at 0.725 nearest-neighbour cosine from real mail against 0.844 among real
emails — an adjacent neighbourhood, not the same one.

The volume test settled it:

| synthetic rows added | catch at 1-in-5 | gain | 90% interval |
|---|---|---|---|
| 500 | 71% | +1.7 | [−1.7, +5.1] |
| 3,000 | 70% | **+0.6** | [−3.5, +4.8] |

**The gain shrank as the data grew sixfold.** A real effect tightens toward a
stable value; this decayed toward zero with an interval as wide as it started. An
early +3.3 from 480 rows was luck.

The two-LLM conversations — which read *far* more realistic — were the **worst**:
−1.3 points, winning 27% of resamples. Instructing a generator to understate made
its complaints indistinguishable from its neutrals. And my judgement that they
"read more realistically" had **zero** correlation with the embedding distance,
which was identical to three decimals.

**Dead as a supplement.** Kept as a cold start: 54% recall from zero real labels
is a working day-one filter for a new tenant. ADR-025.

---

## Branch 6 — The prompt

**Non-native framing.** Asking *"would she miss this?"* instead of *"is this
negative?"* gave the highest recall measured all week: **95%**. This became the
core lever.

**v1.7** — "a request can be a complaint." **v1.8** — asking *when* is a
complaint, after finding the prompt explicitly taught the opposite (*"Can you
share a timeline?" → NEUTRAL*). Catches 19 of 20 now, at two more false alarms.

**Examples instead of rules.** Three ways of telling the model what a complaint
is, on the same 49:

| | catches | false alarms |
|---|---|---|
| 11,546 characters of rules | 19/20 | 9 |
| 28 fixed real examples | 18/20 | 9 |
| 10 retrieved per email | 18/20 | 9 |

Indistinguishable — **which is the argument for retrieval**, since the rules are
the only one a human maintains, and adding one rule required repairing two
others that contradicted it.

---

## Where we landed

**Live:** a regex spam filter, and gemini-2.5-flash with prompt v1.8. Everything
surviving the spam filter goes to the model. 19 of 20 caught, 9 false alarms.

**Built, not switched on:** the embedding gate (nothing imports it), retrieval of
worked examples (flag off, pending a denser pool), the refit cron (not built).

**Deployed and idle:** `crm-embeddings`, called only by the backfill.

**The binding constraint has moved to the prompt.** Tightening the gate cannot
recover a complaint the judge misreads, because the gate already sent it.

**Dead ends, in one place:** stance from words · politeness theory · ego state as
a detector · Berne's games as a detector · the invented SV idiom lexicon · mined
phrases on top of embeddings · synthetic data as a supplement · two-LLM
conversations · nemotron as a judge · anchored cascades · majority voting ·
panels of judges asked different questions.

**What actually moved the needle:** embeddings over words · opposed priors over
model diversity · non-native prompt framing · and reading real output instead of
trusting tests.

---

## The synthesis: the dead ends are the explanation layer

Every branch above failed as a *detector*. None failed as an *explanation*, and
that is where they combine.

| component | as a detector | what it is actually for |
|---|---|---|
| ego state | adds **zero** recall | 11x lift — *they have left Adult* |
| idioms | 13% recall | names the device |
| mined phrases | +0 on the embedding | quotes the receipt |
| embedding | poor verdict | free instant ranking, 50% precision at top 1% |
| advocate prior | 43% precision | **100% recall** — misses nothing |
| defender prior | 60% recall | **92% precision** — the confident tier |
| the LLM | 68% precision | **95% recall** — the verdict |

Each is bad at being the system and good at exactly one job. The mistake was
asking each to be the detector and discarding it when it wasn't.

**The annotation layer is the telos more than the flag is.** A flag says *this
one*. An explanation teaches the register, so the reader catches the next one
themselves — including mail we never flagged. Raising the floor means the person
improves, not just the queue.

But only if the explanations are true. Measured on 250 held-out emails, the
lexicon splits by what each pattern CLAIMS:

| | fires | correct |
|---|---|---|
| names something literally written | 15 | **15** |
| infers what the writer meant | 10 | 6 |

*Repetition*, *non-delivery*, *litotes*, *challenge* and the mined
*counterfactual* point at words on the page. *Consequence*, *resignation* and
*escalation* claim to know that stakes rose or that someone gave up — and carry
every error between them.

`explain()` renders only the literal ones: **11 fires on 250 held-out emails, 11
correct.** The inferential patterns keep their weight as scoring features and are
never shown. A wrong score costs one bad flag; a wrong explanation teaches a
bookkeeper to misread the next email.

They fire on ~6% of mail. That is not coverage — it is a correct lesson when one
is available, instead of a plausible guess on everything.

**Asking the model to QUOTE, not to categorise.** Sixty real complaints the
lexicon said nothing about were given to a local model twice. Asked to *name the
device*, it returned only the eight examples the prompt had supplied — a leading
question, and the same mistake that produced the invented Silicon Valley
register. Asked instead to *quote the phrase carrying the displeasure*, 59 of 60
answers were verbatim from the email, and four devices surfaced:

| device | held-out fires | correct |
|---|---|---|
| broader why-questions (*any reason why*, *is a mystery*) | 4 | **4 — added** |
| a named emotion (*getting a little nervous*) | 0 | — |
| stated intention to leave (*look for a new accountant*) | 0 | — |
| flat disagreement (*I don't agree*) | 0 | — |

Three of the four are real in one sample and **absent from the next**. Only the
why-questions survived, folded into `challenge`: production coverage 99 → 113
complaints, held-out shown precision **14 fires, 14 correct**.

The method that works is narrow and worth stating: ask for a quote rather than a
category, take the answer only if it appears verbatim in the source, and then
validate on mail nobody looked at. Two of those three steps exist because the
alternative already failed here.

**The phrase layer has a ceiling, and it is reached.** The quoting method was
then run at scale: 450 complaints the lexicon says nothing about, 442 verbatim
quotes returned. Across all 442, the most common recurring shape appears **eight
times** — and it is *"do not"*. The rest of the top ten are *"i am"*, *"have
not"*, *"can you"*, *"not sure"*. There is no concentrated device left to name;
442 clients phrased their displeasure 442 different ways.

That closes the branch. **113 of 1,015 complaints (11%) is the ceiling for
anything phrase-based**, and the limit is the mail, not the effort. The other 89%
carry displeasure through structure, context and history that no list of
expressions reaches — which is precisely why the embedding beat the words, and
why the embedding cannot explain itself.

**Widening it further by n-gram mining is exhausted.** 637 phrases at ≥3× lift were mined from
the training half; 19 made a checkable claim about what happened rather than an
inference about mood; each was then validated on the 250 held-out emails
individually. Four survived, and none of them earns a place:

| candidate | fires | correct |
|---|---|---|
| *i thought* | 4 | 4 — already inside `counterfactual` |
| *are still* | 4 | 4 — but *is still* was 2 of 3, so the split is noise |
| *did not* | 9 | 8 |
| *was not* | 7 | 6 |

*did not* and *was not* clear 85% but are plain negation, not register. There is
no lesson to attach to them — "they said something did not happen" teaches
nobody anything, and adding them would dilute the section into noise.

**Measured on real production mail:** 99 of 1,015 flagged complaints carry a
lesson — 1 in 10 — counted on the new message only, after the quoted chain is
stripped. (A count against raw bodies says 117, but those extra matches sit in
text somebody quoted from an earlier email, which teaches nothing about what the
sender just wrote.)

| class | fires on 1,015 real complaints |
|---|---|
| **counterfactual** — mined, not invented | **28** |
| repetition | 25 |
| litotes | 19 |
| non-delivery | 19 |
| challenge | 15 |
| colloquial failure | 5 |
| understatement | 4 |
| small error | 1 |

The class mined from the corpus is the largest single contributor, ahead of every
hand-written one. Every invented Silicon Valley pattern still fires **zero**
times across 1,015 real complaints. Mine the register; do not imagine it.

**The remaining 9 in 10 is a property of the mail, not of the pattern list.** Explicit register
devices are simply rare; the remaining complaints are carried by structure and
context that no phrase list reaches. Extending coverage would need the embedding
to find paraphrases the regex cannot enumerate — but an embedding can only say
*this resembles that*, and cannot name the device, which is the part that
teaches. **Untested, and the weaker half of the idea.**
