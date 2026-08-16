# Google Workspace Marketplace — store listing

**PUBLISHED 2026-08-15** on `inboxpulse-addon-listing`, Private + Unlisted.

Everything below is the record of what was published and why. Edits go through
the same form: **APIs & Services → Google Workspace Marketplace SDK → Store
Listing** on **`inboxpulse-addon-listing`** — NOT `project-y-email-sentiment`.

## Publishing the form: two traps

Both cost several hours on 2026-08-15.

1. **The Edit Language card commits on `Done`, not on `Save Draft`.** Paste all
   three fields, press **Done**, then **Save Draft**.
2. **After a successful save the card re-renders blank with "Input is
   required".** This is a display bug, not data loss. Read the buttons instead
   of the fields: `Save Draft` greyed = nothing unsaved, `Publish` blue = the
   server considers the listing complete. Hard-reload to see the stored values.

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

## The install link

Unlisted means the listing is not in browse or search, so this is the only way in:

    https://workspace.google.com/marketplace/app/inboxpulse_sidebar/369372211306

The slug is generated from the Application Name — `InboxPulse Sidebar` became
`inboxpulse_sidebar`. Renaming the app changes the slug and breaks any link
already sent.

**Send that URL, not the one in your address bar.** Google inserts a `/u/N/`
segment naming the account index of whoever is browsing. Copying
`workspace.google.com/u/6/marketplace/...` sends the reader to *their* account
number 6, which is somebody else. Strip it.

A 400 from that URL means the wrong account, not a broken listing: Private
restricts it to the domain, and `workspace.google.com` defaults to browser
profile index 0 even when the Cloud console session is index 6. Force the right
one with `?authuser=grastogi@mystartupcfo.com`.

---

## Application name

    InboxPulse Sidebar

Deliberate, and not to be "corrected" to `InboxPulse`. InboxPulse is the product
— the web app at `inboxpulse.mystartupcfo.com`. The add-on is one surface onto
it, so the listing names the surface.

The two names come from different files and appear in different places:

  * `InboxPulse Sidebar` — the listing. Shows on the Marketplace page and on the
    consent screen: *"InboxPulse Sidebar wants access to your Google Account."*
  * `InboxPulse` — `addOns.common.name` in `deployment.json`. Shows in the Gmail
    rail and as the card header.

Renaming the app regenerates the URL slug (`InboxPulse Sidebar` →
`inboxpulse_sidebar`) and breaks every link already sent.

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

Set on **Google Auth Platform → Branding**, not in the Store Listing form, and
they must resolve — the consent screen links straight to them.

    Application home page    https://inboxpulse.mystartupcfo.com
    Privacy policy link      https://inboxpulse.mystartupcfo.com/privacy
    Terms of service link    https://inboxpulse.mystartupcfo.com/privacy

They were first saved as `https://inboxpulse.numerafinance.com`, which has no
DNS record at all — three dead links on the consent screen, which is worse than
the blank fields they replaced. The host must also be one of the **Authorized
domains** listed on that page (`mystartupcfo.com`, `numerafinance.com`), so the
Cloud Run URL cannot be used.

`/privacy` is `apps/web/public/privacy.html` — a static file, deliberately not a
React route. Everything in the SPA except `/login` sits behind `ProtectedRoute`,
and a privacy policy that requires signing in is useless to the one reader who
matters: someone deciding whether to approve the consent screen, who therefore
cannot sign in yet. `nginx.conf` maps `/privacy` to it ahead of the SPA
fallback.

The page carries no `<script>` and no external URL — the diagrams are hand-built
in CSS rather than rendered by mermaid, because a page about not sending your
data anywhere should not fetch a library from a CDN when a suspicious reader
opens devtools.

## App logo

The consent screen and the Store Listing draw from **different uploads**. The
bolt on the Marketplace page comes from Store Listing graphics; the consent
screen takes its icon from **Branding → App logo**, and an empty field there is
why "InboxPulse Sidebar wants access to your Google Account" appeared with no
icon. Upload `~/Desktop/inboxpulse-icon.png` there too.

Changing an app logo normally forces re-verification. Not here — the Internal
user type exempts it, as the Verification status panel states.

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
