# How it fits together

InboxPulse reads a finance firm's client email, scores it, and surfaces the
clients who need attention today. Ten Cloud Run services do that work, and
`crm-api` does most of it.

Claims below carry a `file:line`.

## System context

| Outside the system | Direction | What crosses |
|---|---|---|
| Gmail (Workspace) | in | message bodies and headers, via Pub/Sub push and the Gmail API |
| Gmail (Workspace) | out | label writes under `InboxPulse/`, the only mailbox write |
| Google Gemini | out | thread text for classification, on paid tier |
| The browser | in | session-authenticated requests from the web SPA and the Chrome extension |
| Neon Postgres | both | all persistent state |
| GCP Secret Manager | in | credentials at boot |

The tenant boundary is the firm. Every persisted row carries `tenantId`, and
every read path scopes to it.

## Services

Ten Cloud Run services, project `project-y-email-sentiment`, region
`us-central1`. **`crm-api` is the only one that matters for most questions**:
125 files, 33,292 lines. Everything else feeds it or reads from it.

| service | package | owns | called by |
|---|---|---|---|
| `crm-api` | `apps/api` | all business logic, all database access | every surface |
| `crm-addon` | `apps/addon` | the Gmail sidebar (Workspace Add-on, Cards v2) | Gmail |
| `crm-web` | `apps/web` | the React SPA | the browser |
| `crm-gmail` | `apps/gmail` | Gmail sync | Pub/Sub push |
| `crm-analysis` | `apps/analysis` | model calls | `crm-api` |
| `crm-notifications` | `apps/notifications` | outbound email, Inngest jobs | `crm-api` |
| `crm-manager` | `apps/manager` | the manager endpoints' reference implementation | nothing in production |
| `crm-embeddings` | container only | `nomic-embed-text` behind an authenticated endpoint | `crm-analysis` |
| `crm-addon-design` | `apps/addon` | a second add-on deployment for design review | Gmail |
| `crm-web-clone` | `apps/web` | the SPA pointed at the clone database | the browser |

The **Chrome extension** is a browser extension, built to
`apps/chrome-extension/output` and loaded unpacked. It is installed rather than
deployed, and appears below only as a caller.

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

### Four surfaces that share a name

**Four things put "InboxPulse" in front of a user.** Establish which one someone
means before anything else: they share a name and almost no code, so a fix to one
is not a fix to the feature.

| If someone says… | They mean | Code |
|---|---|---|
| "the panel in Gmail", sections *Where the fires are* | **Workspace add-on** (Cards v2) | `apps/addon` |
| "the sidebar", tabs *Thread / Dashboard / AI Analysis / Customers / Users* | **Chrome extension** (InboxSDK rail) | `apps/chrome-extension` |
| "the dashboard", "the website" | **Web SPA**, branded *Email Intelligence* | `apps/web` |
| "Settings" | the web app | `apps/web/app/settings/` |

The add-on and the extension are independent products that both render inside
Gmail. Two Marketplace deployments are registered: `inboxpulse-live` and
`inboxpulse-ceo`.

**"AI Analysis" names three screens**, so a change to one leaves the other two
alone:

- web app → route `/escalations` (`apps/web/components/app-sidebar.tsx:42`)
- extension tab → `manager/inbox-ui.js:295`
- customer detail → `findByCustomerScoped`

## Data

Postgres on Neon, Drizzle ORM with the postgres.js driver. `crm-api` owns every
table; no other service holds a connection for business reads.

| group | tables | notes |
|---|---|---|
| Auth | `better_auth_*` | session, account, verification |
| Core | `users`, `tenants`, `roles` | |
| Customers | `customers`, `contacts`, `customer_domains`, `customer_allocations` | |
| Email | `emails`, `email_threads`, `email_participants`, `email_analyses`, `thread_analyses` | `emails.body` holds raw HTML and the full quoted chain |
| Panel | `panel_snapshots` | precomputed section payloads, keyed `(tenant_id, kind, window_days)` |
| Access | `user_accessible_customers` | denormalized cache, rebuilt asynchronously from `user_customers` + `user_managers` (`users/repository.ts:765`) |

**Schema changes are files, not commands.** Drizzle schemas live in
`apps/api/src/{module}/schema.ts` and every change ships a matching idempotent
SQL file in `apps/api/sql/`. Migrations are applied by hand and nothing detects
drift, so a merged migration has not necessarily run.

**`addon/` has no repository file.** Its SQL sits directly in
`account-context.ts`, which holds seven services. This is a deliberate exception
to the module shape in `CLAUDE.md`: these are hand-written CTEs tuned to the
panel's six-second budget, and routing them through Drizzle would hide the shape
that makes them fast.

## Key flows

### A panel section renders

`GET /api/internal/addon/fires`, the "Where the fires are" section:

| step | file:line |
|---|---|
| add-on calls it, 6s timeout, returns `[]` on any failure | `apps/addon/src/services/api-client.ts:602` |
| internal auth | `packages/shared/src/middleware/service-auth.ts:83` |
| route reads query params, clamps `days` to 1–180 | `apps/api/src/addon/routes.ts:179` |
| service runs a hand-written CTE | `apps/api/src/addon/account-context.ts:1261` |
| entitlement filter applies; admins bypass | `account-context.ts:1284` |
| owner resolution, a second bounded query | `account-context.ts:1554` |

The panel's endpoints, all under `/api/internal/addon` in
`apps/api/src/addon/routes.ts`:

| route | feeds | viewer-scoped |
|---|---|---|
| `/viewer` | resolves who is asking | it *is* the resolver |
| `/fires` | Where the fires are | **yes** |
| `/waiting` | Unhappy clients left waiting | **yes** |
| `/capital-events` | Capital events | **yes** |
| `/account-context` | thread card history | yes, dual-mode |
| `/task` | the only write | **yes** |
| `/pulse` | reply-time medians | no, tenant-wide aggregate |
| `/slow-responders` | Slowest to answer | no, aggregate of people |
| `/stirring` | Talking more than usual | no, and it names customers |

Scoping is per route because the sections differ in what they expose: an
aggregate that names nobody needs none, a section that names a client needs it.

### The manager dashboard

`/api/manager/*` serves the extension's manager dashboard.
`apps/manager/src/server.js` is the reference implementation and its SQL bodies
are carried over near-verbatim, so a rewrite that changes a number is a bug. The
rules for changing them are in `apps/api/src/manager/repository.ts:8` and
`manager/routes.ts:95`. Three things differ from the reference by design: every
query is tenant-scoped, per-user access control applies, and non-admins see
correspondingly smaller numbers.

**The reads are not ADMIN-gated; only the two writes are**
(`manager/routes.ts:110`).

**Path rewriting:** `apps/chrome-extension/lib/manager-client.ts:105` rewrites
any path matching `PORTED_PREFIXES` (`:60`) from `/api/foo` to
`/api/manager/foo`, so **the string in the extension's source is not the endpoint
it hits**. On a 404 it falls back to the gcloud proxy for the rest of the session
and caches that choice, so reload the Gmail tab after deploying `crm-api`.

## Cross-cutting rules

Each of these holds everywhere, and each has one enforcement point.

### Authentication: two paths

**Session path**, all `/api/*` except `/api/internal/*`:

1. `betterAuthSessionMiddleware` (`middleware/better-auth-session.ts:9`) resolves
   the better-auth cookie.
2. `tenantResolutionMiddleware` (`middleware/tenant-resolution.ts:17`) derives
   `tenantId` and asserts the session's tenant matches the user's row (`:51`).
3. `userContextMiddleware` (`middleware/user-context.ts:12`) loads role
   permissions and builds `RequestHeader`.
4. Handlers read it only through `getRequestHeader(c)`, which throws if the
   middleware did not run.

**Internal path**, `/api/internal/*`, used by the add-on and background services.
`requireInternalAuth` (`packages/shared/src/middleware/service-auth.ts:83`)
compares `x-internal-api-key` against `SERVICE_API_KEY` and, when `x-tenant-id`
is present, synthesizes a header carrying `ALL_PERMISSIONS` (`:113`).

**A valid service key is therefore a tenant-wide admin.** This shapes the whole
add-on surface: the key proves the *caller* is trusted, never *which person* is
looking. So add-on endpoints re-derive authorization from query parameters rather
than trusting the header, and the add-on calls `/viewer` first to learn who the
viewer is (`apps/addon/src/index.ts:1013`).

### Tenancy and entitlement

Every query scopes by `tenantId` from `RequestHeader`. Per-user customer access
uses `ScopedRepository.customerAccessFilter`
(`packages/database/src/scoped-repository.ts:47`); **admins bypass it entirely**.

It is deliberately not applied to `/pulse` and `/slow-responders`, which are
aggregates carrying no per-customer detail, nor to `/api/manager/*` reads.

### Consent

"No consent, no read" is enforced by `hasConsent`, which asks Gmail whether the
`⚡/Reading on` label exists. **The label is the record.** It lives in the user's
mailbox, is visible in their label list, and deleting it turns reading off
whether or not this code cooperates. No database row can contradict it.

The invariant is about **order, not presence**: within any handler, no model call
may appear above the consent check. `consent-gate.test.ts` enforces it by
comparing source offsets and derives its list of model functions from the async
exports of `live-analysis.ts`, so a function added later is governed without
being registered anywhere.

### Mailbox writes

Labels are the only sanctioned write (ADR-005). All of them sit under
`InboxPulse/` so the set is removable in one operation, and
`remove-gmail-labels.ts` is the remover. `apps/api/src/labels/policy.ts` decides
what may be written; the call site does not.

### Errors

Every response uses `ApiResponse<T>`, and refusals carry the same envelope:
`error` is a `StructuredError`, never a bare string. Build refusals through the
helper typed `ApiResponse<never>` so the compiler rejects the alternative.

### Signal filtering

A signal filter reaches the database by one of **three paths that do not share
code**:

| path | used by |
|---|---|
| `options?.signal` in `EmailRepository` | the list query |
| `filters?.signal` in `EmailRepository` | the count query |
| `getSignalFilterCondition` | `searchAnalyzedEmails`, which the AI Analysis page calls |

The first two must move together: a filter present in one and absent from the
other yields a list of rows under a total that contradicts it.

The third returns `SQL | null`, and the contract is that **null means "this value
asks for no filter", never "I do not recognise this value"**. The two are
identical in the generated SQL and opposite in meaning, so the parameter is typed
`AnalyzedEmailSignalFilter` rather than `string` and the `default` branch assigns
to `never` and throws. An unhandled value is a compile error.

`signal-filter-parity.test.ts` derives both sides from source: accepted values
from the Zod request enum, handled values from the `case` labels.

### The capital-event rule

`apps/api/src/emails/capital-event.ts` detects that a client is raising, being
acquired, or borrowing. It runs inside `runKeywordAnalysis` but sits **outside
the tenant keyword map**: the keyword map is configuration a tenant can edit, and
this is a fixed rule set derived from measuring 80,114 threads. It makes no model
call, so a backfill costs database time and nothing else.

Three properties to preserve when extending it:

- **Word boundaries, never substrings.** The vocabulary collides with ordinary
  English and with hex identifiers: `409a` occurs inside GUID fragments such as
  `4ab083e2409a`, and `warrant` matches "warranty" in 274 of 278 threads.
- **The sender is checked before any phrase.** Numera's own domains, the LMS,
  internal Google Chat and Notes, and newsletter domains are excluded first.
- **A vendor in the FROM line is not evidence.** It says which tools we and our
  partners use, not what the client is doing (ADR-031a).

Its result flows into `updateEmailSignalsInTransaction` as
`Signal.CAPITAL_EVENT` (70). `capitalEvent` is not in `ANALYSIS_TYPES`, so it
cannot shadow an LLM analysis through `excludeTypes`, and `labelFor` returns null
for it, so it writes no Gmail label.

## Deployment, and the caches a change passes through

`.github/workflows/deploy.yml` runs on push to `main` when `apps/` or `packages/`
change: detect which services changed, build, push to Artifact Registry, deploy
to Cloud Run. A change under `packages/` deploys everything.

A **panel** change passes through three caches before it renders:

1. **The Cloud Run rollout**, a few minutes.
2. **`panel_snapshots`**, recomputed by an Inngest cron every 5 minutes.
   `PanelSnapshotService.read` serves any row up to **15 minutes old** before
   falling back to live compute.
3. **The add-on's in-memory cache**, 180s TTL, stale-while-revalidate.

Worst case is about twenty minutes, and **no route clears a snapshot**. The
precompute exists because the panel's queries cost seconds against a six-second
budget; serving a slightly old answer is what makes the sections render at all.
`08-OPERATIONS.md` carries the commands for telling a stale snapshot from a bad
deploy.

## Known inconsistencies

Present-tense, and each one a reader can trip over:

- **`/stirring` names customers tenant-wide** while `/fires` and `/waiting`
  withhold them. If scoping tightens for `/fires`, it must tighten here in the
  same change (`addon/routes.ts:202`).
- **`crm-web-clone` reads a different database.** A page showing unexpected data
  may be a different database, not a different code path. Check which host the
  surface calls.
- **The signal union is hand-copied in fourteen places** across the web app, the
  API, the repository and the clients package. Consolidating on
  `SignalFilterType` is open.
- **Migrations are applied by hand and nothing detects drift.** Merging a
  migration does not run it.
- **Two auth systems and two OAuth implementations run at once**: better-auth
  alongside a legacy HMAC session (`/api/auth/legacy`), and better-auth's Google
  provider alongside a hand-rolled flow (`oauth/routes.ts:41`) whose state lives
  in an in-memory Map that does not survive a restart or a second instance.
- **Ten `@deprecated` methods are still called**, each pointing at a `…Scoped`
  replacement.
- **One leaked transaction holding `pg_advisory_xact_lock` hangs every panel
  endpoint.**

### Code with no callers

Listed so you do not read it looking for behavior. No importers outside their own
tests:

| thing | file | note |
|---|---|---|
| `better-auth-hooks.ts` | `auth/` | tombstone comment at `di/container.ts:128` |
| `better-auth-routes.ts` | `auth/` | imported at `index.ts:55`, never mounted |
| `labels/policy.ts` | 183 lines | only its own test |
| `prefilter/berne-whiskers.ts` | | not wired in |
| `getEmailStats` | `apps/addon/src/services/api-client.ts:110` | homepage hardcodes `stats = null` |

## Where to look next

| Question | Document |
|---|---|
| Why was it built this way? | `docs/decisions.md` (ADR log) |
| What changed, and when? | `CHANGELOG.md` |
| Something is broken | `08-OPERATIONS.md` |
| What did we try that failed? | `09-DEAD-ENDS.md` |
| What does this number mean? | `06-SIGNALS.md` |
