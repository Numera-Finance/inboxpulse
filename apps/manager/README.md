# @crm/manager — InboxPulse manager API

The aggregate queries behind the extension's **Dashboard**, **AI Analysis**,
**Customers** and **Users** tabs. Ported from the standalone dashboard's local
`server.js` and deployed to Cloud Run as `crm-manager`.

Plain `node:http` + [`postgres`](https://github.com/porsager/postgres) — no
framework, no build step, no dependency on anything in `packages/`.

## How access works

This service has **no login of its own**. Anyone who can reach it can read the
whole CRM, so it is deployed `--no-allow-unauthenticated` and gated entirely by
IAM. Callers reach it through a local authenticated proxy:

```
Chrome extension (Gmail origin)
   │  fetch http://localhost:8080/api/dashboard/summary
   ▼
background service worker            ← bypasses Private Network Access
   ▼
gcloud run services proxy            ← local; attaches your identity token
   │  Authorization: Bearer <ID token>
   ▼
Cloud Run crm-manager                ← IAM check: roles/run.invoker
   ▼
Cloud SQL
```

**Start the proxy before opening Gmail:**

```bash
gcloud auth login                              # once
gcloud components install cloud-run-proxy      # once — see below
gcloud run services proxy crm-manager --region us-central1 --port 8080
```

`gcloud run services proxy` needs the **`cloud-run-proxy`** component, which is
not part of a default Cloud SDK install. Without it the command stops on an
interactive "would you like to install?" prompt rather than starting.

Leave the proxy running. If it isn't up, the manager tabs surface a message
naming this exact command rather than a bare network error.

The proxy binds `127.0.0.1`, while the extension fetches `http://localhost:8080`
(the manifest grants `http://localhost/*`). Both resolve to the same listener on
Windows and macOS — verified — but on a host where `localhost` prefers IPv6
`::1`, point `WXT_MANAGER_URL` at `http://127.0.0.1:8080` instead.

**Grant someone access:**

```bash
gcloud run services add-iam-policy-binding crm-manager \
  --region us-central1 \
  --member "user:someone@mystartupcfo.com" \
  --role roles/run.invoker
```

Revoke with `remove-iam-policy-binding`. This is the whole permission model —
there is no in-app role check, so the IAM binding *is* the manager entitlement.

## Run locally against the database directly

```bash
cp .env.example .env      # set DATABASE_URL and the cert paths
node src/server.js        # listens on PORT, default 3000
```

Point the extension at it with `WXT_MANAGER_URL=http://localhost:3000`.

## Configuration

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | yes | Cloud SQL connection string |
| `PORT` | no | Default 3000; Cloud Run injects 8080 |
| `TENANT_ID` | no | Scope all queries to one tenant. Unset = all tenants |
| `TEAM_EMAIL_DOMAINS` | no | Internal domains for reply-time math. Default `mytaxfiler.com,mystartupcfo.com` |
| `CLOUDSQL_SERVER_CA` / `_CLIENT_CERT` / `_CLIENT_KEY` | no | Inline PEM (Cloud Run, via Secret Manager) |
| `CLOUDSQL_SERVER_CA_PATH` / `_CLIENT_CERT_PATH` / `_CLIENT_KEY_PATH` | no | File paths (local dev) |
| `DB_POOL_MAX` | no | Default 5 |

Certificate resolution prefers inline PEM over file paths, matching
`packages/database/src/db.ts`. mTLS engages only when all three are present.

## Endpoints

`GET /api/health` plus:

| Group | Paths |
|---|---|
| Dashboard | `/api/dashboard/{summary,sentiment-distribution,sentiment-trend,volume-trend,tat-metrics,recent-escalations,important-escalations,most-escalated-customers,churn-levels,team-responsiveness,resolution-time}` |
| Emails | `POST /api/emails/analyzed/search`, `GET /api/emails/analyzed/stats`, `GET /api/emails/analyzed/:emailId`, `GET /api/emails/threads/:threadId` |
| Customers | `POST /api/customers/search` |
| Users | `POST /api/users/search`, `GET|PATCH /api/users/:id`, `GET /api/roles`, `GET /api/team-roles` |
| Tasks | `PATCH /api/tasks/:id` |

### Overlap with crm-api

Roughly eleven of these have equivalents on `crm-api`
(`/api/emails/analyzed/search`, `/api/emails/sentiment-trend`,
`/api/emails/volume-trend`, `/api/emails/tat-metrics`,
`/api/customers/search`, `/api/roles`, `/api/tasks/:id`, the users routes…).
They are duplicated here rather than shared because the two services
authenticate differently — `crm-api` scopes every query to a better-auth
session and the caller's `user_accessible_customers` rows, while this one is
tenant-scoped only and relies on IAM to decide who gets in.

The genuinely unique surface is the seven dashboard aggregates:
`summary`, `recent-escalations`, `important-escalations`,
`most-escalated-customers`, `churn-levels`, `team-responsiveness`,
`resolution-time`.

**If you ever want to drop this service**, those seven are what would need to
move to `crm-api`; everything else already exists there. That would trade IAM
gating for `crm-api`'s application-layer auth — worth doing if the manager view
should follow per-user customer access rather than being all-or-nothing.

## Deployment

Deployed by `.github/workflows/deploy.yml` (job `deploy-manager`) on changes to
`apps/manager/**`, or manually:

```bash
gh workflow run deploy.yml -f services=manager
```

Unlike the other services it is deliberately **not** triggered by the
`deploy-all` flag, which fires on `packages/**` changes — nothing here depends
on `packages/`.

Requires a `crm-manager-sa` service account and the existing
`DATABASE_URL` / `CLOUDSQL_*` Secret Manager entries.
