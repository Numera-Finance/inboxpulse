# Cutover: mystartupcfo.com → numerafinance.com

All company accounts migrate to `numerafinance.com` within about six months of
**2026-08-15**. This is what breaks, in the order it bites.

Nothing here is urgent today. It is written now because two of the items cannot
be fixed after the fact — they are set-once, and the day they matter is the day
it is too late.

## 1. App Visibility cannot be re-scoped (set-once)

The Marketplace listing on `inboxpulse-addon-listing` is saved **Private +
Unlisted**, and Private means *installable by the Workspace domain that owns the
listing*. That radio **locks permanently on first save** — it is why the listing
could not live on `project-y-email-sentiment`, which had been saved Public.

So it cannot be re-pointed at a new primary domain. If the Workspace tenant
changes rather than gaining a domain alias, the listing has to be **recreated in
a third project**, with a new app id, a new URL, and a re-install by every user.

**Do first:** confirm with whoever runs Workspace whether this is a *domain
alias added to the existing tenant* or a *new tenant*. An alias costs nothing
here. A new tenant costs the listing.

## 2. OAuth consent screen: Internal user type

`Internal` restricts consent to users of the project's own organization, and it
is what exempts this app from OAuth verification and CASA — not the Marketplace
visibility radio. If the org changes, that exemption has to be re-established in
the new org, or the app becomes External and inherits the full verification
path for `gmail.modify`.

## 3. Authorized domains — already fine

`Google Auth Platform → Branding` lists both `mystartupcfo.com` and
`numerafinance.com`. The branding URLs (`inboxpulse.mystartupcfo.com/privacy`
and the home page) must stay on a listed domain, and both are listed, so the
consent screen survives the move. If the web app also moves to
`inboxpulse.numerafinance.com`, that host must resolve **before** the branding
URLs change — `inboxpulse.numerafinance.com` had no DNS record at all on
2026-08-15, and pointing the consent screen at it produced three dead links.

## 4. Users are keyed by email, and the failure is silent

`AccountContextService.resolveViewer` matches on `lower(u.email)`. On the day an
address changes, that lookup returns nothing, `tenantId` resolves to null, and
the panel renders the **preview card** — which looks like a normal, working,
empty state rather than an error. Same family as every other failure this
system has produced.

Rows to migrate as of 2026-08-15:

| domain | users |
|--------|-------|
| mystartupcfo.com | 1,398 |
| numerafinance.com | 57 |
| (blank) | 208 |
| mytaxfiler.com | 5 |

Also keyed by address, and easy to miss:

- `user_accessible_customers` — joined by `user_id`, so it follows the user row
  rather than the address. Safe if the row is **updated**, lost if a new row is
  **created** for the new address.
- `customer_domains` — tenant domains used to attribute mail to clients. Adding
  `numerafinance.com` here would make internal mail look like client mail.
- `⚡/Reading on` — consent is a Gmail label in the user's own mailbox, so it
  survives the address change untouched. Nothing to migrate.

**Do:** update the existing `users` rows in place. Do not create new rows, or
every viewer silently loses their customer access and the panel goes quiet.

## 5. The internal-mail filter must learn the new domain

Any rule that treats `@mystartupcfo.com` as internal has to accept
`@numerafinance.com` too, and during the overlap both are internal
simultaneously. A filter that skips internal mail (see the cost benchmark) would
otherwise start analyzing — or labeling — colleague mail as client mail on
cutover day.

## Order of operations

1. Establish whether this is a domain alias or a new Workspace tenant. Everything
   above depends on that answer.
2. If new tenant: create the third GCP project and its listing **before** any
   mailbox moves, and save App Visibility as Private + Unlisted on first save.
3. Point DNS for the new web host, verify it serves, and only then change the
   branding URLs.
4. Update `users.email` in place, in one transaction, and re-run the viewer
   check (`resolveViewer`) for a sample of accounts before announcing.
5. Add `numerafinance.com` wherever `mystartupcfo.com` appears as an internal
   domain.
