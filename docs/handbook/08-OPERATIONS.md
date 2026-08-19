# Running it

*Everything needed to deploy, debug and not break production. Written for someone
who has never touched this project.*

## Where it runs

**GCP project `project-y-email-sentiment`, region `us-central1`.** All services
are Cloud Run.

> **`health-474623` is retired.** It is still named in
> `docs/GMAIL-OAUTH-SETUP.md`, and the OAuth client id beginning `505023465535-`
> belongs to it. The live client is `crm-oauth` (`203731638840-…`). Pointing
> gcloud at the old project fails as a **permission** error rather than "no such
> project", because the account can only see the live one — so the symptom reads
> like missing IAM when the id is simply wrong.

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

**Check which host a surface calls before changing code.** A `crm-api-clone`
reading a separate `CLONE_DATABASE_URL` existed until 2026-08-18 and caused
exactly this confusion; `crm-web-clone` still does. A page showing unexpected
data may be reading a different database, not a different code path.

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

**`ADDON_AUDIENCE` must be blank.** A post-deploy step used to set it to the
service's own Cloud Run URL. Google does not mint `event.userIdToken` for that
audience, so every request failed verification with `Wrong recipient, payload
audience != requiredAudience`. With no verified caller there is no viewer, so the
entitlement-scoped sections vanished and the card fell back to *"Preview mode.
Not connected to the InboxPulse API. Set SERVICE_API_KEY"* — naming a problem
that did not exist. `auth/verify.ts` treats blank as "verify Google's signature
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

**Symptom: a panel row's link shows nothing.** Attribution mismatch — see
principle 6 in `07-DESIGN-PRINCIPLES.md`.

## Timeouts

The add-on gives every API call **6 seconds** (`apps/addon/src/services/api-client.ts`).
It was 2s, chosen when every call was a lookup. The management queries are not:
the fires query aggregates 90 days of negative threads per client, computes a
monthly rate for each, and resolves an owner. At 2s it timed out on **every**
request and the panel simply had no fires section.

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
