# InboxPulse handbook

*Written for someone who has never seen this codebase and is now responsible for
it. Assumes no context.*

**Verified against the live system on 2026-08-18.** Line numbers and counts drift;
treat them as pointers, not guarantees. Where a number matters, the query that
produced it is given so you can re-run it.

**Internal only.** This handbook names real clients and gives reply-time figures
for named employees.

## Read in this order

| # | Document | What it answers | Read it when |
|---|---|---|---|
| 0 | **[00-GLOSSARY.md](00-GLOSSARY.md)** | Every term this handbook uses without explaining | Keep it open beside the others |
| 1 | **[01-WHY.md](01-WHY.md)** | Why this product exists and what it claims | First. Nothing else makes sense without it. |
| 2 | **[02-WHAT-IT-DOES.md](02-WHAT-IT-DOES.md)** | Every panel section, what each number means | A user asks what something means |
| 3 | **[03-ARCHITECTURE.md](03-ARCHITECTURE.md)** | Services, surfaces, request paths, what is dead | Before changing any code |
| 4 | **[04-DATA-MODEL.md](04-DATA-MODEL.md)** | Tables, the two attribution paths, misleading columns | Before writing a query |
| 5 | **[05-PIPELINE.md](05-PIPELINE.md)** | How an email becomes a verdict | "Why did this email get no sentiment?" |
| 6 | **[06-SIGNALS.md](06-SIGNALS.md)** | What predicts trouble, measured, and how to re-derive it | Before quoting a number to anyone |
| 7 | **[07-DESIGN-PRINCIPLES.md](07-DESIGN-PRINCIPLES.md)** | Eleven rules, each with the incident behind it | Before your first change |
| 8 | **[08-OPERATIONS.md](08-OPERATIONS.md)** | Deploy, debug, the configuration traps | Something is broken |
| 9 | **[09-DEAD-ENDS.md](09-DEAD-ENDS.md)** | What was tried and failed, with numbers | Before proposing an improvement |
| 10 | **[10-NEXT-INTEGRATIONS.md](10-NEXT-INTEGRATIONS.md)** | The design brief for making this a shared surface | Planning the next phase |
| 11 | **[11-ACCESS-AND-FIRST-RESPONSE.md](11-ACCESS-AND-FIRST-RESPONSE.md)** | How to get credentials, and what order to check things in | **Your first day, and every incident** |

## The five-minute version

**The problem.** An outsourced finance firm serves 790 clients. Clients get
unhappy by email, and they do it *quietly* — of 20 human-judged complaints, only
5 used explicit failure wording. The rest read like *"could you provide an update
on the expected timeline?"*. An American reader hears a chase; a bookkeeper in
Pune reading 100 emails before lunch hears a status request. **That gap is the
product.**

**The answer.** A model reads every client email (19 of 20 complaints caught,
~$7/month). Then *counting*, not inference, says which client to talk to today:
given a client complained in the last four weeks **and** we are in a live
back-and-forth with them, the chance they complain again next week is **24.7%**
against a **5.7%** base rate.

**The surface.** A Gmail sidebar, because that is where the work already happens.

**The constraint.** Labels are the only mailbox write, namespaced and removable
in one operation.

## Three things that will confuse you first

**1. Four different things put "InboxPulse" in Gmail.** A Workspace add-on, a
Chrome extension, a web app, and the manager API. "AI Analysis" names three
different screens. See `03-ARCHITECTURE.md`.

**2. An email links to a customer two ways** — the participant link and the
sender's domain — and they disagree. Of 1,484 participant rows in one population,
**275** were cases where the customer actually wrote. See `04-DATA-MODEL.md`.

**3. A broken thing looks like good news.** The characteristic failure here is a
section that renders empty and reads as calm. It has happened at least five
times. **Curl the endpoint; never trust the card.** See `07-DESIGN-PRINCIPLES.md`.

## Known defects, recorded rather than tidied away

| what | where |
|---|---|
| `first_reply_by_id` is computed and then discarded — 16,290 rows have a reply time, 2,065 an author | `05-PIPELINE.md` |
| `/stirring` names customers without viewer scoping, where `/fires` withholds them | `03-ARCHITECTURE.md` |
| Drizzle and SQL disagree about several columns and indexes | `04-DATA-MODEL.md` |
| Hammerhead's six allocated people are unreachable via `hammerheadco.ai` | `09-DEAD-ENDS.md` |

## The other documents in `docs/`

There are 73 files beside this handbook in `docs/`, most of them planning
artifacts from earlier work. Twenty-six others were deleted in August 2026
because they documented subsystems the code no longer contains: JWT session
tokens, which were never implemented (see ADR-028), and a separate `employees`
entity, since merged into `users`. Two of what remains are worth your time:

- **`docs/decisions.md`** — the ADR log, append-only. Read ADR-005 and ADR-020.
- **`docs/EXPERIMENTS.md`** — every approach tried, with its measured result.
- **`docs/RETIRED-BRANCHES.md`** — the ten branches deleted in August 2026,
  each with the evidence for deleting it and the SHA to restore it from. Read
  this before concluding a half-built feature was never started.

Treat the rest as archaeology unless something points you at one. Specifically,
**`docs/GMAIL-OAUTH-SETUP.md` names a retired GCP project** (`health-474623`) and
a dead OAuth client id beginning `505023465535-`.
