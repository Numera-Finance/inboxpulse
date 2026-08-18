# `feat/addon-thread-card-design` — what's in it

51 commits ahead of `main`. 48 are this branch's work; 3 are Naren's, already in
the branch when it was picked up (thread context drop bar, context-search-string
analysis module, manager sections ported to crm-api).

A Google Workspace Add-on (`apps/addon`, HTTP alternate runtime) that reads the
open Gmail thread and answers **what does this need from me** — plus the API and
data work behind it. 116 tests.

---

## The argument

Gemini sits three inches to the left of this panel reading the same thread. So
anything derived only from the open messages is a point it already makes for
free, and a panel that summarises is a worse Gemini.

Everything below is either (a) something Gemini structurally cannot see —
account history, prior complaints, what's open in the CRM — or (b) an action on
the thread rather than a description of it.

---

## Features

### The card changes shape with the kind of email

Five modes, classified in ~0.6s before anything expensive runs:

| mode | what the card leads with |
|---|---|
| `complaint` | history first, account, and the draft matters most |
| `scheduling` | who owes the next move — **no** sentiment, no history |
| `opportunity` | history + account, what decides whether to lean in |
| `working` | commitments and unanswered questions |
| `fyi` | one line — "Nothing needed from you" — and stop |

`fyi` short-circuits the deep read entirely, so the most common kind of mail is
answered in under a second instead of paying ~2s to conclude nothing was needed.

**Measured, not asserted.** 118 real threads from the emails DB, labelled
independently by Haiku judges: agreement went 64% → 78% → 89% across three
prompt revisions. Harness in `apps/addon/eval/`, re-runnable.

### The reply is a choice of stance, not a draft

```
HOW TO ANSWER
  Own it  · recommended  — third time raised
  "I understand this is the third time you've raised this…"    [Use this]
  Ask first — scope is unclear                                 [Write this]
```

The stance is where the expertise lives: a good CSM knows whether a thread wants
ownership, a question, or escalation. The median user gets one draft and makes
that call alone.

Every stance arrives immediately; only the recommended one arrives *written*,
because writing all three cost ~7s and the user sends exactly one. Choosing a
different stance writes it on demand.

### Commitments carry an action that isn't an email

```
Sean Barrett — send over the reconciliation log
"I'll send over the reconciliation log by Friday…"
by Friday                                          [Remind me]
```

A promise made in a thread gets dropped because nobody wrote it down, and no
draft prevents that.

- date resolves → Google Calendar reminder (plain template URL, **no OAuth
  scope**, so it ships without security review)
- no date, known account → tracked task against the customer
- neither → **no button**, rather than a control that lies

Dates resolve deterministically (`services/when.ts`), never by the model, always
forward. `soon` and `when the migration lands` get nothing.

### Account history — the part Gemini cannot know

How long this customer has been writing, what they complained about before,
what's still open. Viewer-scoped: admins see their tenant, everyone else sees
only `user_accessible_customers`, and an inaccessible customer returns
`found:false` — identical to an unknown domain, so the response never discloses
that the customer exists.

### Grounding: every claim carries its quote

The sentiment reason *is* the verbatim sentence. Commitments carry the sentence
they came from. A paraphrase is a claim you must trust; a quote is one you can
check against the thread on screen in two seconds.

### Other

- **Loop in** — people who were on the chain but are *off* the latest reply.
  Only that; listing everyone reproduces Gmail's own header.
- **Find related emails** — boolean search string, opens a pre-filled tab.
- **Connector spec** (`services/connectors.ts`) — Canopy, QBO, Streak, Google
  Chat, Calendar. One fact each, mode-gated, and until connected the card shows
  the *question* it would answer, never a sample value.
- **Analysis cache** — content-keyed on message count + latest message id, so a
  new reply re-analyses. Optional disk backing (off by default).

---

## Performance

| | |
|---|---|
| first paint | 0.26s |
| classify | ~0.6s |
| deep read + reply options | ~1.1s (concurrent) |
| repeat open | cached |

Extraction and prose run on separate models concurrently. Runtime is
`gemini-3.1-flash-lite` — flash-lite not flash, because this runs on every
thread a user opens and per-call cost is the economics of the feature.

---

## Bugs found in existing code

- **`tasks.status <> 2` counted every task ever created as open.** `TaskStatus`
  is `OPEN: 0, DONE: 1`; there is no 2. Across the 348 customers with any
  completed task the card would have shown 964 open where 145 are — 6.6x,
  rendered as a flat number with nothing to indicate it was wrong.
- **Churn fired on `low`** — including rows whose own reasoning said "no signs
  of churn". 87% of churn flags were noise.
- **`z.coerce.boolean()`** made a config flag permanently true —
  `Boolean("false") === true`.

---

## Known gaps — please read before merging

1. **`crm-addon` is not in the deploy pipeline.** It has a Dockerfile, but CI
   deploys six services and this is not one of them. The Gemini path is verified
   against the live API; there is no production instance running it.
2. **`opportunity` mode has never been observed firing.** Zero threads in 169
   across every model tested. There is a card variant built for a mode that may
   not occur, or that this corpus cannot see.
3. **`apps/addon/eval/` reads the production database** and sends redacted
   thread text to an external API. Fine as a local tool; it should be a
   deliberate decision that it lives in a shared branch. The README documents
   residual leaks — a customer name survived redaction during development
   because both its words are in the dictionary.
4. **`packages/shared/DEFAULT_LLM_MODEL` is still `gemini-2.5-flash`** and
   drives the analysis service. If flash is too expensive for the add-on it is
   likely too expensive there; that is a platform-wide change, deliberately not
   made here.
5. **Compose is URL-based**, so a reply opens a *new* message — a URL cannot set
   `References` headers, so it will not thread into the conversation.

## SQL / schema

No migrations. One query fix in `apps/api/src/addon/account-context.ts`
(`status <> 2` → `status = 0`). The connector spec would need
`integrations.source` enum values added before anything can be persisted; that
migration is **not** included.

## Docs

ADR-015 (connector spec, one fact per system), ADR-016 (tasks.status),
ADR-017 (local model choice). `apps/addon/eval/README.md` for the classifier
methodology and its caveats.
