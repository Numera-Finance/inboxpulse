# What changed, and when

*Behavior and structure changes to the deployed system, newest first. The other
handbook documents describe the system as it is now and carry no history; this is
where the dates live.*

**What belongs here:** a component added or removed, a number whose meaning
changed, an interface that moved, a default that flipped. One line each.

**What does not:** why a choice was made (`docs/decisions.md`), what to do when
something breaks (`08-OPERATIONS.md`), what was tried and abandoned
(`09-DEAD-ENDS.md`), or routine bug fixes that left behavior unchanged.

## 2026-09

**Capital events section added to the Gmail panel.** A rule-based signal,
`Signal.CAPITAL_EVENT` (70), detecting that a client is raising, being acquired,
or borrowing. Three phrase groups, no model call, no Gmail label. 130 historical
emails backfilled. ADR-031, amended by ADR-031a when the vendor-domain trigger
was removed.

**Capital events rows became clickable**, opening the AI Analysis page filtered
to that client's capital-event mail. Required `capital-event` in the signal
filter union across the web app, API, repository and clients package.

**`getSignalFilterCondition` now throws on an unhandled value** rather than
returning `null`. `null` had meant both "no filter wanted" and "value not
recognised", which generate identical SQL and opposite results. ADR-032.

**Capital events requires `analysis_status = 3`.** Clients whose flagged mail was
never analyzed no longer appear, because the page the row links to lists analyzed
mail only. 90 of 130 flagged emails qualify. ADR-034.

**Panel quotes replaced subject lines** in the Capital events section, extracted
by phrase priority and bounded by the phrase offset. ADR-033.

**`crm-api` given burst capacity**, `minScale=3`.

## 2026-08

**`crm-api-clone` removed.** It read a separate `CLONE_DATABASE_URL`.
`crm-web-clone` remains and still points at the clone database.

**`health-474623` retired** as a GCP project. The live project is
`project-y-email-sentiment` (`203731638840`) and the live OAuth client is
`crm-oauth`.

**Consent gate ordering fixed across four model call sites.** `/gmail/analyse`
computed the gate below `classifyThreadMode`; `/gmail/stance`, `/gmail/triage`
and the contextual live path had none. `consent-gate.test.ts` now enforces
ordering by source offset. ADR-029.

**Refusals carry the `ApiResponse` envelope.** The auth middlewares had returned
`error` as a bare string, so `error.message` was undefined on every 401.

**`isAdmin` removed as a request input.** Authorization is derived, never
asserted by the caller. ADR-030.

**`/owner-load` and its service deleted**, along with `prefilter/score.ts` and
its 3.7 MB `model.json`. Tests that used `OwnerLoadService` as a vehicle for
shared predicates now run against `SlowRespondersService`.

**Session auth settled on better-auth over Postgres**; the JWT comparison
document describes a subsystem that was never implemented. ADR-028.

**Panel snapshot precompute added.** `panel_snapshots` plus an Inngest cron every
5 minutes, because the panel's queries cost seconds against a six-second budget.

**Escalation risk restated as a posterior.** Signals are measured forward from
every client-week, against a 5.7% base rate, replacing backward-selected figures.
ADR-027.

**Twenty-six documents deleted from `docs/`** describing subsystems the code no
longer contains: JWT session tokens, and a separate `employees` entity since
merged into `users`.

## Re-deriving any of this

`git log --oneline` is the raw record. This file is the curated one: it keeps
changes a reader of the handbook would otherwise have to infer by noticing that
two documents disagree.
