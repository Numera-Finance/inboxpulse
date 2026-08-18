# How it fits together

*Every claim here carries a `file:line` so you can check it. Where a subsystem is
dead or duplicated, that is stated rather than tidied away.*

## What runs

**Ten Cloud Run services**, project `project-y-email-sentiment`, region
`us-central1`, verified 2026-08-18:

`crm-api` · `crm-addon` · `crm-web` · `crm-gmail` · `crm-analysis` ·
`crm-notifications` · `crm-manager` · `crm-embeddings` · `crm-addon-design` ·
`crm-web-clone`

**The Chrome extension is not one of them** — it is a browser extension,
installed rather than deployed, and it appears in the diagram below only because
it is a caller.

> A `crm-api-clone` service reading a separate `CLONE_DATABASE_URL` existed
> earlier on 2026-08-18 and **has since been deleted**. If you find a reference
> to it, that is why. `crm-web-clone` still exists.

```
                        ┌──────────────────────────┐
   Gmail sidebar ──────►│ crm-addon    apps/addon   │──┐
   (Workspace add-on)   └──────────────────────────┘  │
                                                       │  x-internal-api-key
   Gmail right rail ───►┌──────────────────────────┐  │
   (Chrome extension)   │ apps/chrome-extension     │──┤  session cookie
                        └──────────────────────────┘  │
                                                       ▼
   Browser ────────────►┌──────────────────────────┐ ┌──────────────────────┐
   inboxpulse.myst…com  │ crm-web      apps/web     │►│ crm-api   apps/api   │
                        └──────────────────────────┘ └──────────┬───────────┘
                                                                 │
   Gmail push ─────────►┌──────────────────────────┐            │
   (Pub/Sub)            │ crm-gmail    apps/gmail   │────────────┤
                        └──────────────────────────┘            │
                        ┌──────────────────────────┐            │
                        │ crm-analysis apps/analysis│───────────┤
                        └──────────────────────────┘            │
                        ┌──────────────────────────┐            ▼
                        │ crm-notifications         │      ┌──────────┐
                        └──────────────────────────┘      │ Postgres │
                        ┌──────────────────────────┐      │  (Neon)  │
                        │ crm-manager  apps/manager │─────►└──────────┘
                        └──────────────────────────┘
```

**`crm-api` is the only service that matters for most questions.** 125 files,
33,292 lines. Everything else either feeds it or reads from it.

## Four surfaces, and telling them apart

This is the single most common source of confusion, and it has caused real bugs.
**Four different things put "InboxPulse" in front of a user.**

| If someone says… | They mean | Code |
|---|---|---|
| "the panel in Gmail" with sections *Where the fires are* | **Workspace add-on** (Cards v2, Google-styled) | `apps/addon` |
| "the sidebar" with tabs *Thread / Dashboard / AI Analysis / Customers / Users* | **Chrome extension** (InboxSDK rail) | `apps/chrome-extension` |
| "the dashboard", "the website", "AI Analysis" | **Web SPA**, branded *Email Intelligence / Customer Insights* | `apps/web` |
| "Settings" | **web app only** — the extension has none | `apps/web/app/settings/` |

The add-on and the extension are **independent products that both render in
Gmail**. Two Marketplace deployments are registered: `inboxpulse-live` and
`inboxpulse-ceo`.

> `apps/addon/README.md:44` claims the add-on is "Currently UNREGISTERED". **That
> is stale.** Only `inboxpulse-dev` was deleted.

**"AI Analysis" names three different screens**, and one bug had to be fixed in
all three:

- web app → route `/escalations` (`apps/web/components/app-sidebar.tsx:42`)
- extension tab → `manager/inbox-ui.js:295`
- customer detail → `findByCustomerScoped`

## Two authentication paths

Everything hinges on which one a request takes.

**Session path** — all `/api/*` except `/api/internal/*`:

1. `betterAuthSessionMiddleware` (`middleware/better-auth-session.ts:9`) resolves
   the better-auth cookie.
2. `tenantResolutionMiddleware` (`middleware/tenant-resolution.ts:17`) derives
   `tenantId`, and **asserts the session's tenant matches the user's row**
   (`:51`).
3. `userContextMiddleware` (`middleware/user-context.ts:12`) loads role
   permissions and builds `RequestHeader`.
4. Handlers read it only via `getRequestHeader(c)`, which throws if the
   middleware did not run.

**Internal path** — `/api/internal/*`, used by the add-on and background
services. `requireInternalAuth` (`packages/shared/src/middleware/service-auth.ts:83`)
compares `x-internal-api-key` against `SERVICE_API_KEY` and, if `x-tenant-id` is
present, **synthesizes a request header carrying `ALL_PERMISSIONS`** (`:113`).

> **A valid service key is a tenant-wide admin.** That is why the add-on
> endpoints re-do authorization from query parameters instead of trusting the
> header, and why `isAdmin` arrives as `?isAdmin=true` — the caller asserts it,
> the API does not verify it. The add-on is expected to call `/viewer` first to
> get a real answer (`apps/addon/src/index.ts:1013`).

## Tracing one request end to end

`GET /api/internal/addon/fires` — the "Where the fires are" section.

| step | file:line |
|---|---|
| add-on calls it, 6s timeout, returns `[]` on any failure | `apps/addon/src/services/api-client.ts:602` |
| internal auth | `packages/shared/src/middleware/service-auth.ts:83` |
| route: reads query params, clamps `days` to 1–180, no Zod | `apps/api/src/addon/routes.ts:179` |
| service: hand-written CTE, not Drizzle | `apps/api/src/addon/account-context.ts:1261` |
| entitlement filter, admins bypass | `account-context.ts:1284` |
| owner resolution, a **second** bounded query | `account-context.ts:1554` |

**`addon/` has no repository file.** Its SQL lives directly in
`account-context.ts`, which holds seven services in 1,905 lines. That is a
deliberate exception to the module shape, not an oversight.

## The panel's endpoints

All under `/api/internal/addon`, defined in `apps/api/src/addon/routes.ts`.

| route | feeds | viewer-scoped? |
|---|---|---|
| `/viewer` | resolves who is asking | it *is* the resolver |
| `/fires` | Where the fires are | **yes** |
| `/waiting` | Unhappy clients left waiting | **yes** |
| `/pulse` | reply-time medians and trend | no — tenant-wide aggregate |
| `/slow-responders` | Slowest to answer unhappy clients | no — aggregate of people |
| `/stirring` | Talking more than usual | **no, and it names customers** |
| `/account-context` | thread card history | yes, dual-mode |
| `/task` | the only write | **yes** |
| `/owner-load` | **nothing — dead** | no |

> **`/stirring` is a known inconsistency.** It names customers without scoping to
> the viewer, where `/fires` and `/waiting` withhold them. The route comment
> concedes it: if scoping ever tightens for `/fires`, it must tighten here in the
> same change (`addon/routes.ts:202`).

## The manager endpoints

`/api/manager/*` was **ported from a standalone Node service** that still exists
at `apps/manager/src/server.js`. The provenance and the rules are in
`apps/api/src/manager/repository.ts:8` and `manager/routes.ts:95`.

Why it moved: crm-manager had no concept of a user. Its only gate was Cloud Run
IAM, so every operator had to run `gcloud run services proxy`. It was
single-tenant by an env var, and **unset, it returned rows across every tenant**.

What changed: SQL bodies carried over near-verbatim so the numbers would not
move; tenant scoping always applied; per-user access control added. Non-admins
now see *smaller* numbers than crm-manager showed. **That is the fix, not a
regression.**

> **The reads are not ADMIN-gated.** Only the two writes are. crm-manager had no
> role check at all, and adding one would have taken the dashboard away from
> whoever has it today (`manager/routes.ts:110`). If a user reports "I can see
> the manager dashboard and probably shouldn't" — that is current intended
> behaviour.

**The transport trap:** `apps/chrome-extension/lib/manager-client.ts:105`
rewrites any path matching `PORTED_PREFIXES` (`:60`) from `/api/foo` to
`/api/manager/foo`. **The string in the extension's source is not the endpoint it
hits.** On a 404 it falls back to the old gcloud proxy for the rest of the
session, and that decision is cached — so after deploying crm-api, **reload the
Gmail tab**.

## Where entitlement scoping is deliberately absent

`user_accessible_customers` is a denormalized cache rebuilt asynchronously from
`user_customers` + `user_managers` (`users/repository.ts:765`). The canonical
predicate is `ScopedRepository.customerAccessFilter`
(`packages/database/src/scoped-repository.ts:47`) — **admins bypass it entirely**.

Deliberately not applied on `/pulse`, `/owner-load`, `/slow-responders` (all
aggregates with no per-customer detail), on `/stirring` (the outlier above), and
on all `/api/manager/*` reads.

## What is dead

Verified by grep, with no importers outside their own tests:

| thing | file | note |
|---|---|---|
| `better-auth-hooks.ts` | `auth/` | tombstone comment at `di/container.ts:128` |
| `better-auth-routes.ts` | `auth/` | imported at `index.ts:55`, never mounted |
| `labels/policy.ts` | 183 lines | only its own test |
| `prefilter/berne-whiskers.ts` | | the replacement, also never wired in |

`/owner-load` with its service, and `prefilter/score.ts` with its 3.7 MB
`model.json`, were deleted in August 2026. The tests that used `OwnerLoadService`
as a vehicle for shared predicates — the `customer_relationships` probe, the
`is_auto_created` filter — now run against `SlowRespondersService`, which applies
the same ones.
| `getEmailStats` | `apps/addon/src/services/api-client.ts:110` | homepage hardcodes `stats = null` |

**Two auth systems and two OAuth implementations run simultaneously**:
better-auth alongside a legacy HMAC session (`/api/auth/legacy`), and
better-auth's Google provider alongside a hand-rolled OAuth flow
(`oauth/routes.ts:41`) whose state lives in an in-memory Map that will not
survive a restart or a second instance.

**Ten `@deprecated` methods are still called**, each pointing at a `…Scoped`
replacement.

## A privacy gap worth knowing

The consent gate — "no consent, no read" — is checked at
`apps/addon/src/index.ts:426` and `:1051`. **Four model call sites do not check
it**: `classifyThreadMode` (`:404`, before the gate), `/gmail/triage` (`:791`),
`/gmail/stance` (`:641`), and `liveForOpenMessage` (`:1111`).

The card says "Analysed live. Not stored", which remains true. But a user who has
not turned reading on can still have thread text sent to a model by those paths.
