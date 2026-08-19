# Getting access, and what to do when it breaks

*The runbook in `08-OPERATIONS.md` assumes you already have credentials. This is
where they come from, and what order to check things in.*

## Everything you need, and where it comes from

### 1. gcloud

```bash
gcloud auth login <you>@mystartupcfo.com
gcloud config set project project-y-email-sentiment
```

You need a Google account in the org with at least `roles/run.viewer` and
`roles/logging.viewer`. **Ask whoever administers the GCP org** — the same person
who owns `project-y-email-sentiment`.

Your token expires and fails **silently**: `gcloud secrets versions access`
returns an empty string rather than an error, which then looks like a missing
secret. If a command that worked an hour ago returns nothing, re-run
`gcloud auth login` first.

### 2. The service key, the tenant, and a user id

These are the four values `08-OPERATIONS.md` uses and does not source:

```bash
# $KEY — the internal API key
KEY=$(gcloud secrets versions access latest --secret=SERVICE_API_KEY \
      --project project-y-email-sentiment)

# $API — the production API. Both hostnames reach the same service.
API=https://crm-api-yn7zwaf2za-uc.a.run.app
#   or https://inboxpulse-api.mystartupcfo.com

# $TENANT — there is effectively one live tenant
TENANT=$(psql "$DATABASE_URL" -tAc "SELECT id FROM tenants ORDER BY created_at LIMIT 1")

# $USER — any real user; use the person who reported the problem
USER=$(psql "$DATABASE_URL" -tAc \
  "SELECT id FROM users WHERE email='someone@mystartupcfo.com' LIMIT 1")
```

> **`$USER` is a shell builtin on some systems.** Assigning it can behave oddly;
> `$UID` definitely will (it is read-only in zsh). Use `USERID=` instead.

### 3. The database

Connection strings are in `apps/api/.env.local` (git-ignored, so you need it from
a colleague or from Secret Manager):

```bash
DATABASE_URL=$(grep -oE 'DATABASE_URL=.*' apps/api/.env.local | cut -d= -f2-)
```

**Two instances, same credentials, different ports:**

| port | which |
|---|---|
| **5434** | **production** |
| 5433 | a colleague's clone |

Both are reached through a **tunnel or proxy that must already be running** — a
closed port means the tunnel is down, not that the database is. Tell them apart
before trusting any number:

```sql
SELECT count(*) FROM emails;   -- production is ~138,000 and growing
```

### 4. The other surfaces

- **Web app**: `https://inboxpulse.mystartupcfo.com`, sign in with Google SSO.
- **Add-on**: appears in Gmail for users whose Marketplace deployment is
  installed. Two are registered: `inboxpulse-live` and `inboxpulse-ceo`.
- **Chrome extension**: installed unpacked from `output/chrome-mv3`, built with
  `build:clone` and an `.env.clone` file that is **not in the repo**.

## "The panel is blank" — in order

**First, one question to the reporter: does yours have tabs?**
Tabs → Chrome extension. No tabs → Workspace add-on. They fail differently.

### Step 1 — is it one person or everyone?

```bash
curl -s -o /dev/null -w "%{http_code}\n" $API/health
curl -s -o /dev/null -w "%{http_code}\n" https://crm-addon-yn7zwaf2za-uc.a.run.app/health
```

Both 200 and it is one person, or one section. Anything else and it is everyone.

### Step 2 — the whole panel, or one section?

**Whole panel, saying "Preview mode. Not connected"** → the viewer could not be
resolved. That message names `SERVICE_API_KEY` and is usually lying about the
cause. Check in this order:

```bash
# a) ADDON_AUDIENCE must be ABSENT. Set to anything, every token fails
#    verification and there is no viewer.
gcloud run services describe crm-addon --region us-central1 \
  --project project-y-email-sentiment --format=json \
  | python3 -c "import json,sys; c=json.load(sys.stdin)['spec']['template']['spec']['containers'][0]; \
    print('ADDON_AUDIENCE:', [e for e in c['env'] if e['name']=='ADDON_AUDIENCE'] or 'absent (correct)')"

# b) verification failures in the add-on log
gcloud logging read 'resource.labels.service_name="crm-addon" AND
  jsonPayload.msg:"failed verification"' --project project-y-email-sentiment --limit 5

# c) is the reporter a user in this tenant at all?
curl -s -H "x-internal-api-key: $KEY" -H "x-tenant-id: $TENANT" \
  "$API/api/internal/addon/viewer?tenantId=$TENANT&email=THEIR@ADDRESS"
```

**One section missing, the rest fine** → that section's endpoint is failing, and
the card renders a failed fetch identically to an empty list.

```bash
# Try the endpoint AS A NON-ADMIN. Admins bypass the entitlement filter, so an
# admin cannot reproduce the most common class of failure.
curl -s -H "x-internal-api-key: $KEY" -H "x-tenant-id: $TENANT" \
  "$API/api/internal/addon/fires?tenantId=$TENANT&userId=$USERID&isAdmin=false&days=90"
```

Empty array from a *non-admin* and rows from an admin means an entitlement
problem. A 500 from either means a broken query — check the API log.

**All the thread-scoped things vanished at once, in the Chrome extension** →
a build problem, not data. It was built with plain `build` instead of
`build:clone`, so `WXT_SERVICE_API_KEY` is empty and every internal fetch returns
`internal auth not configured`. The sidebar still renders and still looks signed
in.

**A manager tab shows zeros while the row above shows real numbers** → a shape
mismatch at the `/api/manager/*` seam, not empty data. Diff the crm-api handler
against `apps/manager/src/server.js`.

**A manager tab says the proxy is down, or `Request failed: 404`** → the fallback
decision is cached for the whole session. **Reload the Gmail tab.**

### Step 3 — is it slow rather than broken?

The add-on gives every call **6 seconds**. Over that, the section renders empty.

```bash
curl -s -o /dev/null -w "%{time_total}s\n" -H "x-internal-api-key: $KEY" \
  -H "x-tenant-id: $TENANT" \
  "$API/api/internal/addon/fires?tenantId=$TENANT&userId=$USERID&isAdmin=true&days=90"
```

Around 3s is normal for `/fires`. Anything near 6 is about to start failing.

### Step 4 — errors

```bash
for s in crm-api crm-addon; do
  echo "--- $s"
  gcloud logging read "resource.type=cloud_run_revision AND
    resource.labels.service_name=$s AND severity>=ERROR" \
    --project project-y-email-sentiment --limit 5 --format="value(textPayload,jsonPayload.msg)"
done
```

**Errors during a rollout window are normal** — "malformed response or connection
error" for a minute after a deploy is traffic shifting off old instances.

## Rolling back

Cloud Run keeps old revisions. A rollback is a **traffic switch, not a build**:

```bash
# what is serving, and what else exists
gcloud run services describe crm-api --region us-central1 \
  --project project-y-email-sentiment --format='value(status.traffic[0].revisionName)'
gcloud run revisions list --service crm-api --region us-central1 \
  --project project-y-email-sentiment --limit 5

# switch back
gcloud run services update-traffic crm-api --region us-central1 \
  --project project-y-email-sentiment --to-revisions crm-api-00133-abc=100

# and afterwards, return it to tracking the newest revision
gcloud run services update-traffic crm-api --region us-central1 \
  --project project-y-email-sentiment --to-latest
```

> **Pinning a revision stops auto-promotion.** A service pinned with
> `--to-revisions` will not pick up the next deploy until you run `--to-latest`.
> This has already caused a "why didn't my fix land" hour.

## What is NOT set up

State this plainly rather than let someone assume otherwise:

- **There is no alerting.** Nothing pages. Every failure in this system has been
  found by a person looking at the panel.
- **There is no uptime monitoring** beyond Cloud Run's own health checks.
- **There is no on-call rotation** and no documented escalation path.

Given that the characteristic failure mode here is *a broken thing that looks
like good news*, that absence is the largest operational risk in the product. The
first monitor worth building is one that calls `/api/internal/addon/fires` as a
**non-admin** on a schedule and alerts on an empty array or a non-200.
