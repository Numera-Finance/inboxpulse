# InboxPulse Add-on — the choices, and what they cost

Each of these was decided against a real alternative. The alternative is stated,
because a decision without one is just a description.

## Workspace Add-on, not a Chrome extension

| | extension | add-on |
|---|---|---|
| install | unzip, Developer mode, Load unpacked — 6 steps, per machine | admin installs once |
| shipping a change | rebuild, re-zip, redistribute, everyone reinstalls | `git push` |
| works on | Chrome desktop | Gmail web **and mobile** |

**Cost:** the add-on cannot touch Gmail's UI — no highlighting rows, no compose
injection, no reading the search box, and **no access to which rows you selected**.
Anything that changes Gmail rather than sitting beside it still needs the
extension.

## One focused model call per job, not one big one

**Alternative:** ask for everything in a single call. Tried; it fails. Mode as
instruction 0 of 7 returned the fallback on every thread, and `historyPoints`
came back empty with the history sitting in the prompt.

**Cost:** more round trips. Mitigated by running independent calls concurrently.

## flash-lite, not flash

Measured on the real extraction prompt, three runs each:

```
gemini-3.1-flash-lite   0.86-1.07s   115 output tokens
gemini-2.5-flash        1.04-1.44s   149 output tokens
```

Cheaper *and* faster. **Cost:** lite found 2 commitments where flash found 3.
Accepted, because this runs on every thread a user opens.

Which lite matters and only the live API could say: `gemini-2.5-flash-lite`
404s ("no longer available to new users"), `gemini-3.5-flash-lite` and
`gemini-flash-lite-latest` reject `reasoning_effort`. `3.1` accepts everything.

## JSON-schema constrained decoding for extraction

Every failure had been a **shape** failure, not comprehension: gemma3:27b
understood every thread and still dropped the `when` field 3 runs out of 3 — and
`when` is what the calendar reminder is built on, so losing it silently removes
the button.

`when` is **required but emptyable** on purpose. Optional is how it goes missing;
required-and-non-empty is how it gets invented.

**Cost:** not applied to prose, because Ollama's MLX runner silently ignores
`format` — which once emptied the entire reply section with no error.

## Deterministic where a model is unnecessary

Dates, participants, history points and the commitment gate are code, not
prompts. A model asked to do arithmetic produces a reminder for last Tuesday.

The commitment gate **fails closed**: it requires a positive undertaking rather
than the absence of a suggestion. The first version accepted anything that was
not obviously a suggestion, and filed *"we look forward to carrying this momentum
forward"* as a debt owed by the person who wrote it.

**Cost:** real commitments phrased unusually are missed. Correct trade — this
section names a person and asserts they owe something, and feeds a reminder and a
task. A missed commitment costs one glance at a thread already on screen; an
invented one sends the user to chase a colleague over a pleasantry.

## URL actions, not API writes

Calendar events, Meet links and Docs are **template URLs**. A real Calendar event
needs `calendar.events` — RESTRICTED tier, security review, and a scarier consent
screen.

**Cost:** the user lands on a pre-filled form and presses save themselves. Which
is also the honest default for anything writing to a personal calendar.

## `gmail.modify`, paid deliberately

The in-panel working set was built first and shipped as a lesser thing under the
same name. A working set invisible in the inbox **list** is not a working set —
the value is seeing the tag while scanning.

Consent reads *"Read, compose, and send emails from your Gmail account."*
Internal distribution from an org-owned project is CASA-exempt, so the cost is
the sentence, not a review.

*(An earlier version of this doc quoted "…and permanently delete all your email".
That is the string for `https://mail.google.com/`, full access. Verified against
the live screen; the real text is milder.)*

## Labels: precision over coverage

The pre-existing sweep would have written **129,607 labels across 125,685
emails**. Four rules now govern it:

1. Over 5% of mail carries no information — enforced at run time against the
   actual mailbox, not asserted. `Automated` was 51.7%.
2. Never duplicate what Gmail already does.
3. A label that has never fired is not a label. Kudos and Escalation: 0 rows.
4. One label per message.

The deeper test, applied to anything new: **would seeing this change what the
user does?**

## Instant labels, and why they escape all of that

They describe the **user's session**, not the email. A label the user chose
cannot be a false positive — which removes the precision problem rather than
managing it. And they expire, which inverts accretion.

**Cost:** expiry depends on a process staying alive. It is a strong default, not
a guarantee.
