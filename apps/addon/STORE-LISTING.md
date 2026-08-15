# Google Workspace Marketplace — store listing copy

Paste into **APIs & Services → Google Workspace Marketplace SDK → Store Listing**
for **`inboxpulse-addon-listing`** — NOT `project-y-email-sentiment`.

`project-y-email-sentiment` cannot host this listing. Its App Visibility was
saved as **Public** and that setting is permanent, so publishing there requires
full OAuth verification and a CASA security assessment for
`gmail.addons.current.message.readonly` and `gmail.modify` — weeks of process
for an app only staff will install. A **Private** listing is exempt.

So the listing lives in a second project, created for this purpose:

    project id     inboxpulse-addon-listing
    project number 369372211306
    deployment     inboxpulse (already created, points at the same Cloud Run URLs)

Nothing else moves. The add-on service, the database and both original
deployments stay where they are — `ADDON_AUDIENCE` is blank and `verifyRequest`
accepts any Google-signed token, so tokens minted for this project's deployment
verify against the existing service.

**DONE (2026-08-15):** App Visibility is saved as **Private + Unlisted** on
`inboxpulse-addon-listing`, and both radios are now greyed out — locked, and
locked to the right value. App Integrations points at deployment `inboxpulse`
and all five scopes are entered.

That setting is irreversible per project. It is why `project-y-email-sentiment`
can never host this listing, and it is the one field to check before saving on
any future project.

Tick **Unlisted** as well. Private restricts installation to the domain;
Unlisted additionally keeps the listing out of Marketplace browse and search,
so it is reachable only by direct link. Also confirm the OAuth consent screen
on this project is **Internal**.

Every field below is required — the listing will not publish while any is blank.

The direct link, once published:

    https://workspace.google.com/marketplace/app/inboxpulse/369372211306

---

## Application name

    InboxPulse

## Short description
*(max 80 characters — shown on the card in browse results)*

    See which clients are unhappy and waiting, without leaving Gmail.

## Detailed description

    InboxPulse is an internal tool for MyStartupCFO. It puts the firm's client
    sentiment data in a side panel next to your mail, so the question "is a
    client waiting on us?" can be answered without opening another tab.

    The panel shows three things:

    Where the fires are — clients with unanswered negative mail, ordered by how
    many are waiting and how long the oldest has waited, with the account
    manager named so you know who to call.

    Unhappy clients left waiting — how many clients waited more than five days
    for a first reply, with the firm-wide median beside it for context.

    Slowest to answer angry mail — reply times per account manager against the
    firm median, shown only for people genuinely slower than the firm.

    Below that, tools for your own mailbox: order the top of your inbox by what
    each thread costs you to leave, and mark threads with temporary labels that
    clear themselves.

    Reading your mail is off by default. Nothing is read until you turn it on
    from the panel, and turning it off removes the label that records your
    consent. The client figures come from a shared mailbox the firm already
    analyzes — not from your inbox.

## Category

    Productivity

## Graphics

All three are generated and sitting on the Desktop, sized exactly as Google
requires — a wrong dimension is a rejected listing.

    ~/Desktop/inboxpulse-icon.png                  128x128   app icon
    ~/Desktop/inboxpulse-banner-220x140.png        220x140   listing banner
    ~/Desktop/inboxpulse-screenshot-1280x800.png   1280x800  screenshot

The icon and banner are the same mark: a white bolt on deep blue, matching the
`⚡/` namespace the add-on writes into the mailbox, so the listing art and the
labels a user sees in Gmail agree. Neither carries a wordmark — Google renders
the app name beside them, and text inside would print it twice.

**The screenshot contains no real data.** Every client and colleague in it is
invented: Harbourline Group, Vantage Robotics, Meridian Labs, Brightfold Inc,
and staff named Priya Raghavan, Daniel Okafor, Aiko Tanaka. The layout, bands
and copy are the shipped card. Real client names cannot go in a listing image —
it leaves the building, and a screenshot is the sort of thing that gets pasted
into a deck a year later.

Source for the render: `scratchpad/listing-shot.html`, rasterized with headless
Chrome at exactly 1280x800.


## Support links

Required, and they must resolve — Google checks. Point them at internal pages
rather than inventing external ones:

  * Terms of Service — the internal permissions note
  * Privacy Policy — same
  * Support / Help — an internal doc or a mailto for whoever fields questions

## OAuth scopes

Must match the deployment exactly, or installs fail with a scope mismatch.

For the full add-on (`inboxpulse-live`, includes the ⚡ instant labels):

    https://www.googleapis.com/auth/gmail.addons.execute
    https://www.googleapis.com/auth/gmail.addons.current.message.readonly
    https://www.googleapis.com/auth/gmail.modify
    https://www.googleapis.com/auth/userinfo.email

For the reduced-scope build (`inboxpulse-ceo`, panel only, no mailbox writes):

    https://www.googleapis.com/auth/gmail.addons.execute
    https://www.googleapis.com/auth/gmail.addons.current.message.readonly
    https://www.googleapis.com/auth/userinfo.email

`gmail.modify` is what produces the consent line "Read, compose, and send emails
from your Gmail account". It is required only for attaching labels to threads —
`users.threads.modify` is the only API that does it, and `gmail.labels` manages
label definitions rather than attachments. There is no narrower option.

## App Configuration → HTTP deployment

Point the listing at whichever deployment matches the scopes above:
`inboxpulse-live` or `inboxpulse-ceo`.
