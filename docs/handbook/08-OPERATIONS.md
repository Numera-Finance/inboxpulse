# Running it

## Where it runs

**GCP project `project-y-email-sentiment`, region `us-central1`.** All services
are Cloud Run.

> **Check the project id before debugging IAM.** gcloud pointed at any project
> other than `project-y-email-sentiment` fails as a **permission** error rather
> than "no such project", because the account can only see the live one. A wrong
> id therefore reads like a missing role. The live OAuth client is `crm-oauth`
> (`203731638840-…`).

| service | package | what it does |
|---|---|---|
| `crm-api` | `apps/api` | the main backend, Hono on Bun |
| `crm-addon` | `apps/addon` | the Gmail sidebar (Workspace Add-on) |
| `crm-web` | `apps/web` | React SPA |
| `crm-gmail` | `apps/gmail` | Gmail sync via Pub/Sub |
| `crm-analysis` | `apps/analysis` | model calls |
| `crm-notifications` | `apps/notifications` | email notifications |
| `crm-manager` | `apps/manager` | ported manager endpoints |
| `crm-embeddings` | — | nomic-embed-text behind an auth'd endpoint |

**Check which host a surface calls before changing code.** `crm-web-clone` reads
the clone database, so a page showing unexpected data may be reading a different
database, not running different code.

## Deploying

CI is `.github/workflows/deploy.yml`, triggered on push to `main` for changes
under `apps/` or `packages/`. It builds each service with its own Dockerfile and
the repo root as build context.

**To deploy without merging**, dispatch the workflow on a branch:

```bash
gh workflow run deploy.yml --ref my-branch -f services=api,addon
```

Two things about that command:

- **`services=` is often ignored.** The job conditions also fire on path filters,
  so a branch that differs from main across many files deploys everything.
- **Deploying from a branch puts production ahead of main.** If you then merge
  something else, main's build can regress production. This happened: PR #156
  merged after only its first commit was pushed, leaving the working fix live but
  absent from main.

**Never use `gcloud run deploy --source`.** It builds with buildpacks, ignores
`apps/*/Dockerfile`, and produces a container that never listens on 8080.

To deploy a specific image by hand (preserves existing env and secrets):

```bash
gcloud run services update crm-addon \
  --image us-central1-docker.pkg.dev/project-y-email-sentiment/crm/crm-addon:<sha> \
  --region us-central1 --project project-y-email-sentiment
```

## The add-on's configuration traps

Three separate settings on `crm-addon` have taken the whole panel down.

**`ADDON_AUDIENCE` must be blank.** Set to the service's own Cloud Run URL,
verification fails with `Wrong recipient, payload audience != requiredAudience`,
because Google does not mint `event.userIdToken` for that audience. With no
verified caller there is no viewer, so every entitlement-scoped section
disappears and the card reports *"Preview mode. Not connected to the InboxPulse
API. Set SERVICE_API_KEY"*, which names the wrong cause. Check this variable
before the key. `auth/verify.ts` treats blank as "verify Google's signature
and issuer, skip the `aud` claim", which is the intended state.

**`GOOGLE_CLIENT_ID` is not read by the add-on.** It is declared in
`apps/addon/src/env.ts` with a default of `''` and referenced nowhere else;
verification uses `ADDON_AUDIENCE`. It was bound to a secret the project owner
cannot see or grant on, which blocked every deploy of the service for hours in
exchange for a value nothing consumes.

**`crm-addon` runs as `crm-api-sa`.** It is the only service without its own
identity, and it holds Gmail scopes crm-api does not need. Giving it one is the
right end state and is a deliberate migration, not a line to change.

## Reading a broken panel

**Symptom: a section is missing.** That is almost never "no data".

```bash
# 1. Is the API answering at all?
curl -s -H "x-internal-api-key: $KEY" -H "x-tenant-id: $TENANT" \
  "$API/api/internal/addon/fires?tenantId=$TENANT&userId=$USER&isAdmin=true&days=90"

# 2. Try it as a NON-admin. Entitlement bugs only appear on that branch,
#    and admins cannot reproduce them.
#    ...&isAdmin=false

# 3. Which image is actually serving?
gcloud run services describe crm-api --region us-central1 \
  --project project-y-email-sentiment \
  --format='value(status.traffic[0].revisionName,spec.template.spec.containers[0].image)'

# 4. Errors in the last 15 minutes
gcloud logging read \
  'resource.type=cloud_run_revision AND resource.labels.service_name=crm-api AND severity>=ERROR' \
  --project project-y-email-sentiment --limit 10
```

**Symptom: the panel says "Preview mode".** The viewer could not be resolved.
Check `ADDON_AUDIENCE` is unset, then check the signed-in Gmail address is a user
row in the tenant:

```bash
curl -s -H "x-internal-api-key: $KEY" -H "x-tenant-id: $TENANT" \
  "$API/api/internal/addon/viewer?tenantId=$TENANT&email=someone@example.com"
```

**Symptom: a panel row's link shows nothing.** Two causes, in order of how often
they bite. First, the destination cannot display the row: the AI Analysis page
lists analyzed mail only, so a section that counts unanalyzed mail will link to
"No analyzed emails found". Second, attribution mismatch: see principle 6 in
`07-DESIGN-PRINCIPLES.md`.

**Symptom: a panel row's link shows TOO MUCH.** The filter is being dropped, not
applied. `getSignalFilterCondition` returns `null` for a value it does not
handle, and null means no condition, so the page returns everything for that
client under a filter chip that still displays the filter. Check the chip against
the rows: if the chip says "Capital E" and row one is an AWS invoice, the query
never received the filter.

**Symptom: the panel is unchanged after a deploy.** Usually not a failed deploy.
Three caches sit in the way: the rollout, the `panel_snapshots` cron (every 5
minutes, and `read` serves rows up to 15 minutes old), and the add-on's 180s
in-memory TTL. Worst case is about twenty minutes.

**No route clears a snapshot.** Wait the cron out; there is no lever.

Two rules for any script that checks a deploy here, because **`curl` exits 0 on a
404 or a 500** and will report success against a route that does not exist:

```bash
# WRONG: succeeds on 404, 500, anything that completes a round trip
curl -s -X POST "$API/some/route" > /dev/null && echo "cleared"

# RIGHT: check the status you actually got
CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API/some/route")
[ "$CODE" = "200" ] && echo "cleared (200)" || echo "NOT cleared ($CODE)"
```

And when polling for a change to appear, **match exactly**. A poll that broke on
a substring of a 46-character truncation reported success while the run-on tail
it was waiting to see disappear was still there.

To tell a stale snapshot from a broken fix, compare the output against what the
PREVIOUS revision would have produced for the same input. If every row matches
the old behavior exactly, the code is fine and the cache is old.

## Timeouts

The add-on gives every API call **6 seconds**
(`apps/addon/src/services/api-client.ts`), and returns `[]` rather than an error
when it expires. The budget is sized for management queries, not lookups: the
fires query aggregates 90 days of negative threads per client, computes a monthly
rate for each, and resolves an owner. A section whose query exceeds the budget
renders as absent, not as failed.

If you add a heavy query to the panel, measure it against that budget first.

## Databases

Two Postgres instances, same password, told apart by row count:

- **`:5434` is production.**
- **`:5433` is a colleague's clone.**

`DATABASE_URL` in `apps/api/.env.local` may point at either. Check before you
trust a number.

## Secrets

Secret Manager in the same project. Note two things:

- **`NOT_FOUND` means "not visible to you"**, not "does not exist". A 404 from
  `gcloud secrets describe` proves nothing about whether a secret was created.
- **`ADDON_LOG_SALT`** exists so that logged identifiers are salted, namespaced
  and non-reversible. Cloud Logging is readable by every project owner, so a log
  of which mailbox opened which panel is a record of behaviour nobody consented
  to share. Do not defeat it.

## The Chrome extension

Build it with **`pnpm --filter @crm/chrome-extension build:clone`**, never plain
`build`. `wxt.config.ts` sets `outDir: 'output'`, so every mode writes to the
same `output/chrome-mv3` directory Chrome loads unpacked, and a plain build
silently replaces a working one.

Only `.env.clone` carries `WXT_SERVICE_API_KEY`, `WXT_TENANT_ID` and
`WXT_FLAGS_API_URL`. Without them every internal fetch returns
`internal auth not configured` — and the sidebar still renders and still looks
signed in. Treat "everything thread-scoped vanished at once" as a build problem,
not a data one.
