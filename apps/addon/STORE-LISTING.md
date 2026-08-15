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

**Set App Visibility to Private BEFORE the first save.** It cannot be changed
afterwards, which is exactly how the first project became unusable. Every field below is required; the listing will
not publish while any is blank.

Set **App Visibility → Unlisted** on the App Configuration tab first. Combined
with the Internal OAuth user type, that keeps the listing out of Marketplace
browse and search while remaining installable by anyone at `mystartupcfo.com`
who has the direct link. The direct link is:

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

  * **Application icon** — 128×128 PNG, no transparency, no rounded corners
    (Google rounds them). Use the existing rail icon:
    `apps/addon/src/assets/logo.ts` (base64 PNG) — decode and resize to 128×128.
  * **Screenshot** — 1280×800 PNG, at least one required. The Gmail window with
    the panel open on "Where the fires are" is the right frame: it shows the
    product doing its job in its actual context.

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
