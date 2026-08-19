# Manual Signal Override (Sentiment / Churn / Tag Correction)

**Status:** Accepted (2026-07-16)

## Context

Analyzed emails carry a denormalized `emails.signals` integer array (see the
`Signal` constants in `@crm/shared`). The analysis pipeline (LLM + tenant keyword
matching) is the only writer, and the inbox UI reads sentiment and the churn/tag
badges almost entirely from this array.

Customers reported that the analysis sometimes mislabels an email — e.g. it shows
**"Churn Risk"** when the email is really just **negative sentiment** — and there
was no way to correct it. The only mutation path was re-running the LLM, which
would produce the same (wrong) result.

We also want these corrections to feed back into improving the analysis prompts.

## Decision

Add a user-facing **manual override** of an email's signals, with two properties:

1. **Locked against re-analysis.** A new `emails.signals_overridden` boolean flag.
   The single pipeline choke point (`EmailAnalysisService.updateEmailSignalsInTransaction`)
   returns early when the flag is set, so a human correction is never silently
   reverted by a later re-analysis (LLM or keyword).

2. **Logged for learning.** A new append-only `email_signal_overrides` table
   captures, per edit: `previous_signals` (what the model said), `new_signals`
   (what the human chose), an optional free-text `reason`, an `analysis_snapshot`
   (the model's confidence/reasoning at edit time), and `edited_by_user_id`. This
   is the labelled dataset used to measure and improve the analysis prompts:
   *email content + model verdict + human correction + why*.

The original `email_analyses` rows are **intentionally left untouched** — they
remain the immutable record of what the model produced, which is what makes the
learning log meaningful. `emails.signals` + the lock flag are the display source
of truth.

### Validation

Manual selections go through `validateSignalSelection()` (in `@crm/shared`),
mirroring the invariants the pipeline produces: known signals only, no duplicates,
at most one sentiment, at most one churn level, at most one classification. Boolean
tags (upsell / escalation / kudos / competitor) may be combined freely.

### Access & UX

- Available to **any user with email access** (authed `/api/emails` mount).
- Surfaced as an **"Edit tags"** popover in the AI Analysis (escalations) inbox
  detail panel: radios for sentiment / churn / classification, checkboxes for the
  boolean tags, and an optional reason field.
- The `reason` field is **optional** to keep corrections low-friction.

## API

`PATCH /api/emails/:emailId/signals`
Body: `{ signals: number[]; reason?: string }` (full desired signal set — replaces
the existing set). Response: `{ emailId, signals, signalsOverridden }`.

## Consequences

- **Auto-task respects the lock.** The negative-sentiment auto-task
  (`maybeCreateTaskForNegativeEmail`) fires only from the analysis pipeline and is
  **skipped when `signals_overridden` is set** — otherwise re-analyzing an email a
  user had corrected to non-negative would still spawn an escalation off the stale
  model verdict, contradicting the corrected signals. Manually setting negative
  sentiment does **not** create a task, and manually clearing it does **not** close
  an existing task; this is deliberate (safer) and can be revisited if product
  wants manual edits to drive tasks.
- The signal lock is enforced by a single conditional write
  (`updateSignalsUnlessOverridden`: `UPDATE ... WHERE signals_overridden = false`)
  at the pipeline's one signal-writing choke point — no extra read on the hot path.
- Re-analysis of an overridden email is effectively a no-op for signals until the
  lock is cleared. There is currently no UI to "unlock" / revert to the model's
  value; the override table retains the history if we need to build one.
- Migration: `apps/api/sql/migrations/016_email_signal_overrides.sql`
  (adds `emails.signals_overridden`; creates `email_signal_overrides`).
