# Getting the add-on to users

## The difference from the Chrome extension

| | Chrome extension (`apps/chrome-extension`) | Workspace Add-on (`apps/addon`) |
|---|---|---|
| how a user gets it | someone sends them a zip; they open `chrome://extensions`, enable Developer mode, "Load unpacked" | a Workspace admin installs it once for the domain; it appears in Gmail for everyone |
| user action to install | ~6 steps, per person, per machine | none |
| shipping a change | rebuild, re-zip, redistribute, every user reinstalls | `git push` to main — the card is rendered server-side, so every user is updated at once |
| works on | Chrome desktop only | Gmail web **and** the Gmail mobile apps |
| breaks when | the user rebuilds, the folder moves, Chrome updates | — |

That third row is the real argument. The add-on's UI is not code on the user's
machine: Gmail asks our Cloud Run service what to render, every time. There is
no artefact to redistribute and no version skew between users.

This is also what makes the two "trivial install / feels native" constraints
achievable at all. A zip that each person loads unpacked is neither.

## Measured against the shipped zip

`InboxPulse-extension.zip` (749 KB, manifest `InboxPulse — Thread (read-only)`
v0.1.0) with a well-written INSTALL.md. What a user actually does:

1. unzip, and **move the folder somewhere permanent** — Chrome reads it from
   that path forever, so clearing Downloads breaks the extension
2. open `chrome://extensions`
3. turn on **Developer mode**
4. **Load unpacked**, select the folder
5. reload Gmail (a tab open during install does not pick it up)
6. sign in through a popup

Then, from the guide's own "things worth knowing": *"Chrome will nag you on
every restart — you'll see 'Disable developer mode extensions' each time you
open Chrome. Dismiss it; don't click Disable."*

Uninstalling is two steps and includes deleting the folder by hand.

None of that is a criticism of the build — it is what unpacked distribution
costs, and the guide is honest about it. It is the reason "trivial install"
cannot be met this way. The add-on's equivalent list is: *an admin installs it;
the user does nothing.*

### Two defects in the shipped zip

- **The name in the guide is not the name Chrome shows.** INSTALL.md tells users
  to look for "CRM Sidebar for Gmail" (twice — in step 2 and in uninstall); the
  manifest says `InboxPulse — Thread (read-only)`. A user following the guide
  looks for a row that is not there.
- **It points at the clone, not production.** Both `host_permissions` and the
  code call `crm-api-clone-…run.app` / `crm-web-clone-…run.app`, while
  `.env.production` has `inboxpulse-api.mystartupcfo.com`. Fine for a pilot, but
  this zip must not be handed to real users as-is — it would send their traffic
  to the clone environment.

## What has to be true before a user can see it

Current state: one deployment registered, `inboxpulse-live`, pointing at a
**cloudflared tunnel on a laptop**. That is a development setup — the add-on
stops working when the tunnel dies.

1. **Deploy `crm-addon` to Cloud Run.** The CI job now exists
   (`deploy-addon` in `.github/workflows/deploy.yml`) and fires on changes under
   `apps/addon/**` once this branch is on `main`.

   It needs three things created first, which the job does *not* create:
   - service account `crm-addon-sa@` with `roles/secretmanager.secretAccessor`
   - secret `ADDON_GOOGLE_CLIENT_ID` — the add-on's **own** OAuth client from
     Marketplace SDK > Credentials. Not `crm-oauth`: Google mints
     `event.userIdToken` for the add-on's client, so verifying against the CRM
     client checks the wrong audience and every request fails.
   - secret `ADDON_SERVICE_API_URL` — the crm-api base URL

2. **Repoint the deployment at the Cloud Run URL.**
   ```
   gcloud workspace-add-ons deployments replace inboxpulse-live \
     --deployment-file=apps/addon/deployment.json
   ```
   `apps/addon/deployment.json` is a template — `REPLACE_ADDON_URL` must be the
   Cloud Run URL. The deployment holds only URLs and scopes; it is not a build
   artefact.

3. **Register OAuth scopes.** The live deployment currently has **zero** scopes
   registered, which is why Gmail reads returned 403 during development. They go
   in the Marketplace SDK's *App Configuration*, not just `deployment.json`, and
   a duplicate entry there silently prevents the whole list from saving.

4. **Publish as an Internal app** in the Marketplace SDK (visibility: internal
   to the organisation), then a Workspace admin installs it domain-wide.

   Internal + an org-owned GCP project is what exempts this from CASA security
   review. See ADR-006.

5. **Revoke and re-consent when scopes change.** `gcloud workspace-add-ons
   deployments install` does **not** revoke an existing grant. A user who
   consented under the old scope list keeps it until they revoke at
   myaccount.google.com/permissions. This cost a full debugging cycle.

## Rolling back

The deployment points at a URL, so a rollback is a Cloud Run revision
rollback — no user action, no reinstall:

```
gcloud run services update-traffic crm-addon --region us-central1 --to-revisions <REVISION>=100
```

## What still argues for the extension

The add-on cannot touch Gmail's own UI: no highlighting messages, no injecting
into the compose window, no reading the search box. It renders in a sandboxed
side panel with a fixed widget set. Anything that needs to *change* Gmail rather
than sit beside it still needs the extension.
