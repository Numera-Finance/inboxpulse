<!--
Produced by a multi-perspective design workflow on 2026-08-12: four analytical
lenses (commitment, friction, re-entry, closing-loop) plus nemotron-3.5-lightning
as an outside model family, each adversarially critiqued before synthesis.

The grok CLI leg was BLOCKED by the safety classifier for data exfiltration: the
prompt embedded schema, RBAC scoping and unreleased product strategy, and xAI is
not a trusted destination. The block was correct — see the session notes. Only
the local model ran as an outside voice.
-->

# Recommendation: the panel leads with the ball, not the summary

## The decision

**The first row of the card stops describing the thread and starts making a claim about the viewer's obligation — whose turn it is, what they owe, and whether the promise they already made has been kept — with one docked control that files it; everything that merely describes the thread is deleted or collapsed beneath it.**

One row, one primary button, two collapsed sections. The analysed card goes from nine top-level sections to four, and the first paint goes from three widgets to one.

This is the intersection of what all four lenses independently reached for and what their critiques left standing: ball-in-court at first paint (free, no model, no storage), a single named move after the read, and the promise being re-checked on re-open. It is also the only combination in the pack that Gemini cannot copy from three inches to the left — Gemini summarises the thread you are looking at; it does not know whose turn it is, and it does not remember what you said last week and check.

---

## What the card becomes

Every element below is in the real widget set. No new widget types, no HTML outside the bold/italic/font-color/link subset, nothing that touches Gmail's own UI.

### First paint (0.2s, no model call) — `thread.ts:355-379`

**Section 1, no header — one `DecoratedText`:**
- `topLabel` (plain): `Read locally · nothing stored`
- `text` (HTML): `<b><font color="#c5221f">Your turn — Priya wrote 4 days ago</font></b>` / `<b>Waiting on them — you replied Tue</b>` (`#5f6368`)
- `bottomLabel` (plain): `No reply from you seen on this thread since 8 Aug`
- accessory: `TextButton` FILLED — **Read this thread** (the existing action to `/gmail/analyse`, unchanged)

Ball-in-court is "is the newest message from someone who isn't me". Pure metadata. `input.viewerEmail` is already on the card input; `participants.ts:72` already computes `external`. **No watermark, no stored row, no new table, no new scope.** Switch the first-paint thread fetch from `format=full` (`gmail-api.ts:255`) to `format=metadata` — the header set already exists at `gmail-api.ts:203` — which is a strict speedup, since that branch throws every body away today.

Copy discipline: **"no reply seen on this thread"**, never "you have not replied". Aliases, send-on-behalf and off-thread replies all read as silence and we do not fetch send-as addresses.

### After the read

**Section 1 — "Your move", no header, one `DecoratedText`** (occupies the position the state headline holds today):
- `topLabel` (plain): `Priya asked 11 Aug · unanswered` — or, on re-open of a promise past its stated date, `You said Mon 11 Aug — 3 days ago`
- `text` (HTML): `<b>Send the revised migration timeline</b>` — overdue variant `<b><font color="#c5221f">Still not sent: revised migration timeline</font></b>`
- `bottomLabel` (plain): `Vestra Health · 2 open tasks · 3 negative messages before` (the account payload rides here; the standalone "This account" section dies)
- accessory: `TextButton` OUTLINED — **Track · due Fri** when the thread *stated* a date, plain **Track** otherwise, with the resolved internal due date named in the existing toast (`index.ts:298`). Two literal labels, never a fabricated date in the same typography as an extracted one.

Rendered **only** on a hard match of the obligation to the viewer. If attribution is uncertain, this section is omitted and the state headline takes the lead instead. Silence beats a confident wrong instruction — but see the measurement gate in Build order step 2.

**Section 2 — the reply, no header:**
- One `DecoratedText`, `wrapText`, escaped: the draft text itself, visible without pressing anything. Today it is invisible behind a `linkButton` (`thread.ts:485`), so clicking is a leap of faith and the median user goes back to Gmail's reply box.
- `bottomLabel` (plain), honest about the current limitation: `Opens a new Gmail message · adds Priya Raman back to Cc · does not thread yet`
- One `buttons()` row, one `TextButton` FILLED — **Reply with this**. The only full-width button on the card.

Dropped recipients are **pre-filled into the compose URL's `cc`**, not offered as a "Drop" accessory. Removing a Cc in Gmail's own compose is one click and zero round-trips; adding one back is a hunt. Default is re-included.

**Section 3 — "Waiting on them (2)", collapsible `CardSection`, collapsed:** commitments where the obligation resolves to the other side, each keeping today's Track accessory; unanswered questions the draft did not absorb, as plain `DecoratedText` rows.

**Section 4 — "Detail", collapsible `CardSection`, collapsed:** the state reason sentence, account counts and first-seen, prior-concern dates, the `Find related emails` linkButton, `Share to Chat`, and the "How this was read" provenance line.

`collapsible?: boolean` is declared at `widgets.ts:81` and used nowhere in the codebase — verified. Cards v2 pairs it with `uncollapsibleWidgetsCount`; add the field and **render-check it in Gmail before designing two sections around it**. Also note `separated()` (`widgets.ts:130`) appends a spacer to every section — wasted inside a collapsed one.

---

## Kill list

| Deleted | Why |
|---|---|
| **Trend sparkline** (`thread.ts:442`, `trend.ts`) | Sits directly under a reason line that says the same thing in words. Its source is a model-emitted array of unverifiable length. On internal threads it is a row of identical squares — the code says so. Most screenshot-friendly, least actionable thing on the card. Deleted, not demoted. |
| **"Unanswered" as its own section** (`thread.ts:473-478`) | Not deleted as *content* — the one question the viewer owes becomes "Your move"; the rest move into "Waiting on them". It stops owning a section. |
| **"Who owes what" as a flat both-sides list** (`thread.ts:454-471`) | A list that weights your obligations and theirs equally is exactly the ambiguity that stops follow-through. Split by direction: yours leads, theirs collapses. |
| **"Loop in" section** (`thread.ts:316`), including the "already on the latest reply" roster (`thread.ts:306-314`) | The roster restates Gmail's own recipient list, larger, inches left. Dropped recipients become a Cc pre-fill, which is the thing you were going to do about them anyway. |
| **"Do next" explainer deco + three-button row** (`thread.ts:500-507`) | Three buttons in a row means no default. `Find related emails` is a guess at a query Gmail's search bar does better; `Share to Chat` duplicates Gmail's native share. Both to Detail. |
| **"Open message" envelope** (`thread.ts:125-143`, call sites `:544`, `:609`) | Pure duplication of Gmail's header. **Note the honest accounting: it is already off the analysed card** — deleting it shortens the untracked and legacy paths only, so the analysed card must pay for its new top row out of the sparkline and Loop in, which it does. |
| **Homepage vanity counters** (`homepage.ts:28-35`) | "Emails ingested / analyzed" is a number nobody can act on. Free deletion; do it regardless of everything above. |

Net on the analysed card: **+1 section (Your move), −5 sections, 2 of the remaining 4 collapsed.** The panel gets materially shorter.

---

## The median-user test, applied as a veto

The rule: *anything that only pays off for someone who is already pressing Track, already pressing the 6s button, or already keeping a follow-up list is a rejection.* Casualties, named:

- **The visit watermark and `thread-visit` table** (re-entry lens). Its central rule is that the watermark only advances on a *processing act* — but the design's own premise is that the 6s Read button is expensive enough to hide behind a click, and the median user never presses it. So the diff never resets and visit four says "9 new since your last look" to someone who read all nine in Gmail. The lie grows with every passive visit. It is also the only reason the design needs a works-council conversation. Cut. Gmail's own `UNREAD` labelId comes back in the same `format=metadata` response — free, and ground truth about reading rather than a proxy we admit we cannot verify.
- **"You promised"** (re-entry lens) and the **homepage Owed list / digest email / `InboxPulse/Owed` label** (closing-loop lens). All back-loaded onto Track adoption, and the label needs `gmail.modify` re-consent, which collides head-on with trivial install.
- **The "Add Thu 20 Aug" and "Drop" accessory buttons** (friction lens). Making the best behaviour cost a press contradicts that proposal's own thesis, and there is no session store to re-render against — grepped, zero cache/Map/redis in `apps/addon/src`. Splice server-side before first render instead.
- **The "Undo" accessory** on auto-written tasks. `createTask` returns a boolean (`api-client.ts:352`) though `createTaskForViewer` already has the `taskId` (`account-context.ts:155`), and there is no task-mutation endpoint. Not buildable; therefore the silent auto-write on Reply does not ship either.
- **The forced-decision gate** (nemotron). See below.

---

## What the outside voices saw, and where they were wrong

**nemotron** got the diagnosis right and the design wrong, and its critique produced the single most useful factual correction in the pack.

*Saw what the lenses did not:* that the only state-changing control on the card sits below three sections of prose, and that hoisting it above the fold is the whole game. That instinct is adopted directly — "Your move" occupies the headline's position with Track already docked as its accessory. nemotron also correctly refused to let "Unanswered" be deleted outright, on the grounds that a missed buried question buys a whole extra round trip, which is the worst possible latency outcome. That argument is why the questions survive inside "Waiting on them" rather than dying with the section.

*Wrong, and load-bearingly so:* the forced-decision gate ("must pick a pill before they can scroll or close") does not exist on the platform — no modal, no focus trap, no scroll lock, and the close X is Gmail chrome the sandbox cannot touch. Strip the coercion and the proposal is "one button that expands into three buttons", which adds a round-trip to the metric it claims to move. Worse, it deletes "Who owes what" — the source of Track's `{customerId, title}` payload — so the surviving pill has nothing to file; and it deletes "This account", the *only* content on the card that does not exist inside the thread. Keeping the sparkline and the state headline (which Gemini duplicates) while deleting the account history (which Gemini structurally cannot produce) inverts the brief's own differentiation test. A mandatory decision on every open is a tax the median user pays dozens of times a day, and the escape hatch they learn is to stop opening the panel.

*The correction worth more than the proposal:* nemotron's reviewer verified that `buildOpenMessageSection` is already off the analysed card — its only call sites are `:544` and `:609`, and the live branch returns at `:532`. Three separate proposals claimed that removal as their headline subtraction. It had already happened. Every "the panel gets shorter" claim in this pack needed re-costing against that, and this recommendation does.

**grok:** no grok proposal was present in the material I received — the pack contains four lenses plus nemotron. Nothing has been attributed to it and nothing has been invented on its behalf. If a grok proposal exists, it has not been read.

---

## Build order

**0. Wire real viewer identity. Ship this week, independent of everything else.**
`index.ts:198` and `:291` both pass `getEnv().ADDON_DEV_USER_ID ?? ''` and hardcode `isAdmin: false`. `GET /api/internal/addon/viewer` already exists (`routes.ts:50` → `account-context.ts:174`) and returns `userId` plus a real `isAdmin` from the permissions bitmask; the add-on has never called it. Verified. Until this lands, account scope, Track entitlement and every "strictly better than Gemini" claim are evaluating against a dev env var, and `getAccountContext` returns null on an empty userId — meaning in any real multi-user deployment there is no account, no customerId, no Track. ~10 lines in `api-client.ts`. This is ticket zero.

**1. First paint: ball-in-court + `format=metadata` + the whole kill list.** Add-on only. No new scope, no backend, no deploy boundary, no privacy conversation. Lands on the paint every user sees, including the one who never presses anything. This is the largest floor-raise per line of code in the pack.

**2. Obligation direction, and measure it before writing card code.** Add `owedBy: "us" | "them"` to the digest JSON (`live-analysis.ts:342`, `:471`), resolved by matching `who` against the participant list — `participants.ts:72` already carries `external` per address — with the model's answer as tiebreak only. This is a prerequisite for everything after it: without it, "Your move" can hand you the customer's promise as your own debt, which is strictly worse than a vague summary. **Then run the digest over 50 real threads and count the owner-resolution rate.** Under ~50%, "Your move" is absent on most threads and the state headline must stay as the fallback lead rather than the section falling silent into a blank.

**3. "Your move" + the visible reply, with two non-negotiable constraints.**
   - **No invented date leaves in an email.** Slot 3 of the draft carries a date only when the thread states one. Otherwise it stays specific and owned but undated — *"I'll come back to you on the revised migration timeline today."* The internal task may carry a suggested due date; internal dates are cheap, promised dates are not. The disclosure line sits on the *card*; the promise leaves in the *email*. That asymmetry is the fatal flaw in the commitment lens and it is removed here, not mitigated.
   - **Token budget.** `MAX_TOKENS = 1200` (`live-analysis.ts:45`) under an 8s ceiling (`env.ts:64`) with the read already measured at ~6s. Adding `owedBy` per commitment lengthens output, and truncation is not a graceful degradation: unbalanced JSON throws, `parseReading` returns null, and the entire card falls back to pending — no sentiment, no commitments, no draft. Raise the cap, and add truncated-JSON salvage (trim to the last complete object) before ship.
   - Prior-concern acknowledgement in the draft: **pass only the date as a fact and template the clause** — *"you raised it on 14 March"*. Never let the model paraphrase the stored `reasoning` (`account-context.ts:247`), which is model-authored prose about a different email, derived from customer-written text. That path runs untrusted inbound content into an outbound reply under the user's name. And say "3 negative messages", not "3rd complaint" — `negativeCount` is raw rows capped at 40, deduplicated only for the recent three.

**4. `due_date`, then "Held to it".** Zero hits for `due_date` / `dueDate` anywhere outside docs — confirmed gap. `assigned_to_id = viewer.userId` is *already* the behaviour (`account-context.ts:150`), so Commit is one migration plus two small edits, a day's work, not a phase. It must come **before** the supposedly-zero-write "Held to it", because "Sent already" cannot exist without state: with nothing stored, the round-trip re-derives the identical overdue row and it returns in the same second, in front of the user who just said they sent it. That is a worse trust failure than the false accusation it exists to fix.

**5. Compose spike — start it now, ship it whenever it lands.** Before assuming `drafts.create` + `gmail.compose` + CASA + B-1, verify `gmail.addons.current.action.compose` with a Gmail `composeTrigger`. That is an add-on scope, not a restricted Gmail scope, and it inserts content into the draft the user opened with Gmail's *own* Reply button — threads natively, zero latency, maximally familiar. If it works, the entire threading dependency evaporates. If neither route works, **"Reply with this" must never carry a dated promise**: a dated commitment landing as an unconnected new email is confusing and invites a duplicate send.

**Deliberately deferred, with reasons on the record:** the visit watermark and its table; "You promised"; the daily digest email (one already exists — `tasks/service.ts:741` fires at local hour 8 via `escalation-batch.tsx`, so a second sender means two InboxPulse emails at 08:00 for anyone who is both manager and CSM; fold rows into the existing template when it ships); the `InboxPulse/Owed` label and its cron auto-close (gated on the viewer having a connected mailbox integration, which `integrations` cannot express today — it is tenant-scoped with no user FK, and internal mailboxes are excluded from ingestion by design); and "Overdue elsewhere" cross-thread.

---

## What this is being measured on

Two numbers, both about the median user, neither about the expert:

1. **Owner-resolution rate** on real threads (step 2). If the panel cannot tell whose turn it is more than half the time, the lead row is a blank and this design is wrong — better to know that before the card code exists.
2. **Time from panel open to a sent reply**, split by whether "Your move" rendered. The honest claim is post-read: fewer scrolls, one obvious button, less editing, and a reply that names a specific thing — which shortens the *next* round trip too. It is **not** a first-paint improvement to the 6s gate, and it should not be sold as one; first paint is still the pending branch, and nothing here touches the model call.

Install cost is unchanged for steps 0–3: same sidebar card, same scopes, no new consent screen. That is deliberate. Friction is a product failure, and every idea in this pack that required a new scope has been pushed behind everything that does not.