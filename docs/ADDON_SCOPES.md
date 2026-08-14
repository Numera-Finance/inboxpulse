# The scope problem for labels

## What we ask for today

```
gmail.addons.execute                        non-sensitive
gmail.addons.current.message.readonly       non-sensitive, per-message
userinfo.email                              non-sensitive
```

All three are non-sensitive: no verification, no security review, and a consent
screen that reads unremarkably. This is the whole reason the add-on can be
installed trivially, which is one of the two product constraints.

(The **live** deployment currently registers **zero** scopes — that is a
separate misconfiguration, and the cause of the 403s on Gmail reads during
development. It is not the scope problem; it is a bug.)

## What labels need

| operation | scope | tier |
|---|---|---|
| create the label | `gmail.labels` | **non-sensitive** |
| **attach it to a thread** (`users.threads.modify`) | `gmail.modify` | **RESTRICTED** |

That split is the crux. `gmail.labels` lets you create, rename and delete label
*definitions* — it does not let you put one on a message. `threads.modify`
accepts `addLabelIds` and requires `gmail.modify` or `https://mail.google.com/`.

So you can create a label you are not permitted to use. There is no narrower
scope; this is not a matter of finding the right one.

## Why that is a problem, in order of severity

**1. The consent string, not the review.**

`gmail.modify` renders to the user as **"Read, compose, and send emails from
your Gmail account."** Every user sees that at install.

(An earlier version of this document quoted *"…and permanently delete all your
email"*. That is the string for `https://mail.google.com/`, full access — not
this scope. Verified against the live consent screen; the real text is milder,
which weakens the case against asking for it.)

For a feature whose value is a coloured tag that removes itself after thirty
minutes, that is a wildly disproportionate ask, and it lands squarely on the
"trivial install / feels familiar" constraint. People decline at that screen —
and reasonably so.

**2. Re-consent, and the fact that installing does not revoke.**

The runtime hands us `event.gmail.accessToken` (per-message, read-only) and
`authorizationEventObject.userOAuthToken`. Both carry only the scopes the
deployment declares. Adding `gmail.modify` means every existing user must
re-consent — and `gcloud workspace-add-ons deployments install` does **not**
revoke an existing grant. A user who consented under the old list keeps it until
they revoke manually at myaccount.google.com/permissions. This cost a full
debugging cycle already.

**3. Security review — mostly not our problem.**

RESTRICTED scopes normally require a CASA assessment. Internal distribution from
an org-owned GCP project is exempt (ADR-006), so the review burden does not
apply to MyStartupCFO users. It would apply immediately to any external
customer, which is a decision to take deliberately rather than discover.

## The options, honestly

**A. Ask for `gmail.modify`.** Labels work, including instant labels. Every user
sees the full-mailbox-access consent screen. Internally survivable; externally a
real adoption cost.

**B. Do not label from the add-on.** Keep the panel non-sensitive, and apply
labels from the *ingestion* path instead — `apps/gmail` already holds full OAuth
grants with refresh tokens for connected mailboxes. This is how the existing
sweep script works. The user experience is worse for instant labels: a working
set you toggle from the panel is the point, and a cron cannot toggle.

**C. Ship instant labels without Gmail.** Keep the working set in the panel
only — a section listing what you flagged, expiring the same way. No mailbox
write, no scope, no consent change. The cost is that the labels are invisible in
the inbox list, which is where they would have done their work.

**D. Two deployments.** A non-sensitive default, and an opt-in "labels" variant
for users who want it. Doubles the deployment surface and the consent confusion.

**Recommendation: C now, A when there is a reason to pay for it.** The value of
instant labels is the discipline of a self-expiring working set, and most of
that survives in-panel. Trading the install constraint — the thing that decides
whether anyone uses this at all — for coloured tags is the wrong order.
