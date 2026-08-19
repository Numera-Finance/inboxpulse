# InboxPulse Add-on — the design

## The problem it answers

A person opens a thread and has to work out: *what does this need from me?*

Gmail already answers a nearby question. The **Summarise this email** button sits
three inches to the left of our panel and reads the same thread we do. So
anything derived only from the open messages is a point Gemini already makes, for
free, better integrated. A panel that summarises is a worse Gemini.

Two things are left, and everything in the product is one of them:

1. **What Gemini structurally cannot see** — account history, prior complaints,
   what is open in the CRM, who dropped off the thread three replies ago.
2. **Acting on the thread** rather than describing it — a calendar draft with the
   right people on it, a task, a label you can see while scanning.

## The measure

> Make the best behaviour available to the average person, and reduce the time it
> takes them to respond.

Both halves are about the **median** user, not the best one. A feature that makes
an expert 5% faster and does nothing for everyone else fails this test. A feature
that gives an average user the judgement an expert would have applied passes it.

This is the tiebreaker for every design argument below.

## The shape

### The card changes with the kind of email

Five modes, classified in ~0.6s before anything expensive runs:

| mode | the card leads with |
|---|---|
| `complaint` | history first, account, and the draft matters most |
| `scheduling` | who owes the next move — **no** sentiment, no history |
| `opportunity` | history + account: what decides whether to lean in |
| `working` | commitments and unanswered questions |
| `fyi` | one line — "Nothing needed from you" — and stop |

`fyi` short-circuits the deep read entirely. It is the most common kind of mail,
so the panel answers it in under a second rather than paying ~2s to conclude
there was nothing to analyse.

### The reply is a choice of stance, not a draft

```
Own it  · recommended  — third time raised
"I understand this is the third time you've raised this…"     [Use this]
Ask first — scope is unclear                                  [Write this]
```

The stance is where the expertise lives. A good CSM knows whether a thread wants
ownership, a question, or escalation; the median user gets one draft and makes
that call unaided. That gap is the floor this exists to raise.

Each mode offers the moves actually available on that kind of thread —
*Own it / Ask first / Escalate* for a complaint, *Accept / Propose another /
Hand off* for scheduling. The card changing shape around identical prose would
be a rearrangement, not a different answer.

Only the recommended stance arrives **written**. Writing all three cost ~7s and
the user sends exactly one; the alternatives cost a click.

### Everything is quoted

The sentiment reason **is** the verbatim sentence:

> "This is the third time I've raised the webhook delay and it still hasn't moved."

not *"the customer expresses frustration"*. A paraphrase is a claim you must
trust; a quote is one you can check against the thread on screen in two seconds.
Commitments carry the sentence they came from, and a commitment without a quote
is discarded rather than shown.

### Actions that are not email

Writing the reply is the one thing Gmail already does. So a commitment carries:

- a **resolvable date** → Google Calendar reminder
- **no date but a known account** → tracked task
- **neither** → no button, rather than a control that lies

Dates resolve deterministically, never by the model, and always forward. *"soon"*
and *"when the migration lands"* get nothing.

### Prioritise the inbox

One press from the panel: the top of the inbox, classified, **numbered**, ordered
by what each thread costs you to *leave* — complaints get worse, scheduling
expires, live work waits. Oldest first within a mode.

Gmail gives add-ons no access to which rows you selected, so the panel picks the
threads rather than the user picking them. That is the better shape anyway:
raising the floor means the **default** order is good.

### Instant labels

Four self-clearing labels the user turns on: *Focus, Research, Block time,
Waiting on*. They describe the user's session, not the email — so unlike every
classifier output, **they cannot be a false positive**. They clear themselves in
30 minutes, which inverts the accretion that kills every manual labelling system.

## Rules that keep recurring

- **Never render a fabricated value.** A sample figure is indistinguishable from
  a real one three seconds later, and a panel that has shown one invented number
  has spent the credibility of every real one.
- **Refusing is a feature.** No date → no reminder. No customer → no lookup. No
  quote → no commitment.
- **One label per message, one fact per connector, three buttons not six.** A
  panel you scroll has already lost to the reply box six inches away.
