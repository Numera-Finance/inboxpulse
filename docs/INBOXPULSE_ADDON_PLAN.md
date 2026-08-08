# InboxPulse Workspace Add-on — Gap Analysis & Phased Plan

**Status:** Draft for review · **Date:** 2026-07-21 · **Target delivery:** Google Workspace Add-on (CardService/HTTP), private distribution
**Sources:** design handoff (`design_handoff_inboxpulse/`), reverse-engineered PRD, and a read-only audit of `apps/*` + `packages/*` in this monorepo (`7-21-inboxpulse`, copied from `inboxpulse 6-16-2026`).

---

## 1. Executive summary

The InboxPulse design spec is *mostly already implemented* as backend, but delivered today through two Chrome extensions rather than the Workspace Add-on we're targeting. The genuine build work is:

1. **A new Workspace Add-on frontend** (greenfield — neither existing extension is CardService).
2. **Three missing backend capabilities**: Gmail **label writing + a label-sync job**, **Q&A extraction**, and **action-items extraction** — plus **Google Chat "Share to Chat."**
3. **Getting it running end-to-end, then hardening + deploying.**

Two hard external dependencies gate the visible-in-Gmail features: **new OAuth scopes (`gmail.labels`/`gmail.modify`, Chat) with Workspace-admin re-consent**, and a **data-retention/PII sign-off**. Everything else can proceed in parallel now.

---

## 2. What already exists (asset inventory)

| Capability | State | Location |
|---|---|---|
| Multi-tenant API (Hono/Bun, Drizzle/Neon Postgres), Cloud Run, GCP `health-474623` | ✅ Mature | `apps/api` |
| Gmail **read** sync: list/get/batch/history/profile | ✅ Mature | `apps/gmail/src/services/gmail.ts` |
| Gmail **Pub/Sub** watch + 4h renewal cron + push handler | ✅ Mature | `sync.ts`, `watch-renewal.ts`, `webhooks.ts` |
| OAuth flow + **AES-256-GCM** encrypted token storage/refresh (Secret Manager) | ✅ Mature (read-only scope) | `apps/api/src/oauth`, `packages/encryption` |
| AI classification (Gemini 2.5 Flash via AI SDK; multi-provider) | ✅ Mature | `apps/analysis` |
| 7 signals: sentiment, escalation, upsell, churn, kudos, competitor, signature | ✅ | `apps/analysis/src/analyses/*` |
| Domain + contact regex extraction | ✅ | `apps/analysis/src/services/*` |
| **Keyword rules authoritative over AI** (short-circuits LLM) + provenance stored | ✅ (data), ⚠️ (no UI) | `apps/api/src/emails/analysis-service.ts` |
| **Auto-escalation task** on negative external email → Controller→AM assignment (TSK-2/6) | ✅ Exactly per spec | `analysis-service.ts:1136`, `tasks/service.ts:327` |
| **SLA/TAT business-day buckets** (Mon–Fri, tenant holidays, AM timezone) | ✅ Exactly per spec | `emails/repository.ts:2174` |
| **Daily 8am (local tz) manager escalation digest** (NOT-2/3) | ✅ (email) | `apps/notifications/.../escalation-summary.ts` |
| Data-quality: add domain (customer PATCH), add/upsert contact + signature enrich | ✅ | `customers/routes.ts`, `contacts/service.ts` |
| Escalation **resolve/reopen** + task status/assignee UX | ✅ (in standalone extension) | `gmail inboxpulse - 7-16-2026/src/inbox-ui.js` |
| Web CRM app (React 19) | ✅ | `apps/web` |

**Frontend reference material (two separate lineages, not a merge):**
- **Folder A** = `apps/chrome-extension` — WXT/React thread sidebar with **real Google OAuth**, tenant isolation, authoritative **thread→customer resolution from message-ids**. Closest architecture to a contextual Add-on. Narrow features (customer card only).
- **Folder B** = `gmail inboxpulse - 7-16-2026` — vanilla-JS full SPA (Dashboard/Inbox/Customers/Users + resolve/reopen), edited through 2026-07-20; its `server.js` is a no-auth dev backend. Richest **copy/logic/UX** reference. Point the rebuild at the real `apps/api`, **not** B's `server.js`.

---

## 3. Gap analysis (design requirement → status → work)

| # | Design requirement | Status | Work needed |
|---|---|---|---|
| 1 | **Signals as real Gmail labels** ("At risk/Went cold/Needs response/Upsell" + elapsed buckets) | ❌ **Absent** (no `labels.create`/`messages.modify`; blocked by read-only scope) | New scope + desired-label model + idempotent **label-sync job** (batchModify, `InboxPulse/` namespace, fixed palette mapping, discrete elapsed-bucket labels) |
| 2 | **Q&A found in thread** — exact-quote answer + message-level citation, never paraphrase; cross-thread badge; "Not answered" state | ❌ **Absent** (no schema/module/endpoint) | New analysis module + table + endpoint; capture message-id + **exact quoted span** (today none is persisted; prompts even encourage paraphrase) |
| 3 | **Action items & dates** — checklist + due + assignee (Gmail/Chat) | ❌ **Absent** | New extraction + table + endpoints; reuse existing task-assign for the assignee flow |
| 4 | **Share to Google Chat** (target picker, preview, send) | ❌ **Absent** (only inert `gchat` enum) | Chat API client + scopes + add-on picker/preview action |
| 5 | **Provenance per flag** ("Keyword rule match" vs "AI classification · N%") | ⚠️ **Data exists, no UI** | Surface `model_used`/`confidence` in the add-on card |
| 6 | **Upsell cites a specific service line, only if not delivered** | ⚠️ **Partial** (prompt-only; schema doesn't enforce enum) | Enforce service-line enum in schema; keep "not delivered" guard |
| 7 | **Went-cold alert** ("no reply in Xd") | ⚠️ **Derivable, not built** | Derive from `first_reply_at`/last customer `received_at`; add threshold + card (sidebar-only live text, per spec) |
| 8 | **Connected systems** (Jira only, read-only KV) | ⚠️ **Partial** (integrations = gmail/outlook/slack/other) | Add Jira integration read + KV card (confirm Jira is actually in use) |
| 9 | **Sentiment trend** (small bar chart) | ✅ (data) / ⚠️ (widget) | Data exists; render as image widget (CardService can't do live charts) |
| 10 | **"Not an escalation"** dismiss (separate from resolve, with Undo) | ⚠️ **Partial** | Tasks are binary open/done — add a distinct "dismissed/mis-flagged" state |
| 11 | **Suggested search** (one-off Gmail query) | ❌ **Absent** | Add-on card + Gmail search deep-link |
| 12 | **The sidebar itself as a CardService Add-on** | ❌ **Greenfield** | Build `apps/addon` (see §5); reuse A's OAuth + thread→customer, B's copy/logic |

**Minor / notes:** model is Gemini **2.5 Flash** not Flash Lite (design's cost assumption — revisit); tasks have **no `due_date`**; **TAT buckets are non-cumulative** despite `N+` naming; **escalation-aging uses calendar days while TAT uses business days** (two day-models — reconcile).

---

## 4. Cross-cutting blockers & decisions

- **B-1 (long pole): Restricted-scope approval.** `gmail.labels`/`gmail.modify` and Chat scopes require Workspace-admin re-consent and — for restricted scopes on an external-published app — likely a **CASA security assessment**. Gates gap #1 and #4. *You are requesting these from your team.*
- **B-2: Data-retention/PII sign-off.** Storing client email bodies needs a documented retention window + redaction rule before production. Org decision.
- **D-1: Add-on runtime — DECIDED (2026-07-21).** Build an HTTP-based Workspace Add-on as a new Cloud Run service `apps/addon`, reusing `@crm/clients` and the existing TypeScript/Bun/Cloud Run infra (not Apps Script/GAS).
- **D-2: Chat "Share to Chat" — DECIDED (2026-07-21): DEFERRED** to a later release. Phase 4 drops off the v1 critical path.
- **D-3: GCP project.** Confirm `health-474623` (project number `505023465535`) is "Project Y – Email Sentiment." *(pending)*

---

## 5. Phased plan (dependency-ordered)

### Phase 0 — Foundations & run it end-to-end  *(no new scopes)*
- `pnpm install`; wire env for `apps/api`, `apps/analysis` (drop Gemini key in as `GOOGLE_GENERATIVE_AI_API_KEY`), `apps/gmail`; confirm Cloud SQL/Neon reachability with the provided certs.
- Verify the read-only pipeline end-to-end on a test tenant (ingest → analyze → signals in DB).
- Fix doc drift (`oauth/README.md` wrongly says `gmail.modify`); decide Flash vs Flash-Lite.
- Scaffold `apps/addon` (HTTP add-on skeleton, contextual "message open" trigger, calls `apps/api`).

### Phase 1 — Add-on sidebar MVP against existing data  *(no new scopes)*
Rebuild the sidebar sections that map to data we already have: header, account card, sentiment trend (image), flagged messages + **provenance**, went-cold alert (derive), connected systems, data-quality prompts, escalation **resolve/reopen**, **assign-to-teammate**. Reuse A's OAuth + thread→customer resolution and B's copy/UX.

### Phase 2 — Missing backend analysis  *(no new scopes)*
- **Q&A extraction** module + table + endpoint, with **exact quoted span + message-id/thread citation** (stop paraphrasing; persist quotes).
- **Action-items** extraction + table + endpoints.
- Enforce **upsell service-line enum**; add **"Not an escalation"** task state; add **due dates**.
- Surface Phase 2 data in the Phase 1 add-on (Q&A + action-items sections).

### Phase 3 — Gmail labels  *(BLOCKED on B-1: `gmail.labels`/`gmail.modify` + admin consent)*
Desired-label model (category + elapsed bucket) → idempotent **label-sync reconciliation job** (`batchModify`, `InboxPulse/` namespace, fixed-palette color mapping, discrete elapsed-bucket label family that the job moves threads between).

### Phase 4 — Share to Google Chat  *(BLOCKED on B-1: Chat scopes + Chat API)* — *candidate to defer (D-2)*
Chat API client + target/space picker + preview card + send; optionally back the notifications `gchat` channel.

### Phase 5 — Hardening & deploy
CSRF state → Redis; Pub/Sub verification hardening; **data-retention/PII** implementation (B-2); fix TAT bucket labeling + unify day-models; tests; **Workspace Marketplace private listing** + OAuth verification/**CASA**; deploy `apps/addon` to Cloud Run.

---

## 6. Open questions to resolve before/within the build
From the design doc (still unresolved, flagged to eng):
- Controller-only escalation assumption — confirm before relying on it (code already does Controller→AM fallback).
- Message-ID stability on **forwarded** email — affects Q&A citations + label targeting (repo dedups via `content_hash`/`rfc_message_id`, worth validating).
- SLA/TAT bucket math "not final" (Sandeep) — and we independently found **non-cumulative buckets + mixed calendar/business-day models**; treat as unfinished.

Newly raised:
- Is **Jira** actually connected for this tenant (gap #8)?
- Went-cold threshold value (gap #7)?
- Keep or defer **Chat share** for v1 (D-2)?

---

## 7. What is NOT in scope of the mock (design-flagged future work)
Cross-mailbox digest/rollup; flag-accuracy feedback loop (👍/👎); language-detection gate before scoring. Note in backlog, not v1.

---

## 8. Progress log

### 2026-07-21 — Phase 0 (get it running end-to-end): ✅ backend verified against the clone
- Toolchain OK (node 24, pnpm 11, **bun 1.3.14**, gcloud). `pnpm install` + `pnpm lint` (typecheck all) both clean.
- Test DB = **prod clone `crm-db-prod-clone-2`** (`35.224.145.214/crm`), reachable from authorized IP `76.226.65.239`.
- Clone requires **client-cert mTLS with its own CA**; prod certs don't work. Clone certs placed in `certs/clone/` (gitignored). Strict mTLS (`rejectUnauthorized:true`) verified — `apps/api` connects unchanged.
- Dev config: `apps/api/.env.local` + `apps/analysis/.env.local` override `DATABASE_URL`→clone, point mTLS at `certs/clone/`, blank Inngest keys (no cloud jobs/digest). Prod `.env` files left intact (they supply other required secrets; `.env.local` wins via dotenv order).
- **End-to-end proof:** `apps/api` boots, connects via mTLS, serves HTTP; authenticated read through `/api/internal/emails/*` (internal key + `x-tenant-id`) returned real data for tenant **MyStartupCFO**: `stats {total:174109, analyzed:54477}`, `analyzed/search total=81480`.

**Findings (local dev-auth is rough — fix before add-on auth work):**
- `tenant-resolution.ts:22-26` — `ALLOW_DEV_AUTH` branch is **dead code** (computes the flag, then throws unconditionally). No header-based dev bypass exists.
- Legacy `POST /api/auth/legacy/test-token` is **unreachable**: the better-auth catch-all `app.on('/api/auth/*')` (`index.ts:135`) is registered before the legacy mount (`index.ts:260`) and shadows it → 404. Reads currently require either a real better-auth Google session or the internal-key path.
- Working local read path for dev/testing: `/api/internal/emails/*` with `x-internal-api-key: $SERVICE_API_KEY` + `x-tenant-id` + `x-user-id`.

**Open (unblocked, pending you):** rotate `crm_app` DB password + Gemini key (both hit chat); confirm `project-y-email-sentiment` vs `health-474623` (gcloud default vs app env); provide restricted scopes when ready (Phase 3).

### 2026-07-21 — Phase 1 start: `apps/addon` scaffold ✅
- New Bun+Hono service `apps/addon` (port **4005**), matching repo conventions (`catalog:` deps, zod `getEnv`, dotenv-first bootstrap, pino, multi-stage Node→Bun Dockerfile). Delivery per **D-1** (HTTP add-on in the monorepo, not Apps Script).
- Endpoints: `GET /health`, `POST /homepage`, `POST /gmail/contextual`. Response envelope verified against Google docs: `renderActions → action → navigations → pushCard(Card)` (Cards v2).
- Typed Cards-v2 builders (`src/cards/widgets.ts`), design-labelled signal map (`signals.ts`), live-data client over the Phase-0 internal path (`services/api-client.ts`), Gmail event typing (`gmail/event.ts`). **Preview mode** when unconfigured so it boots with zero secrets.
- `deployment.json` (Workspace add-on manifest template), `.env.example`, `README.md`, `cards.test.ts`.
- Verified: `pnpm --filter @crm/addon lint` ✅, `test` ✅ (7/7), and live `curl` of all three endpoints returned valid card JSON.
- **Next in Phase 1:** (a) connected-mode demo (set `SERVICE_API_KEY` + `ADDON_DEV_TENANT_ID` → cards show real clone flags); (b) resolve the OPEN thread's customer via `POST /api/internal/emails/resolve-by-messages` and build the real account/flags/went-cold card; (c) fix local dev-auth (dead `ALLOW_DEV_AUTH`, shadowed test-token route) before wiring the add-on's Gmail-user→tenant resolution; (d) implement `ADDON_VERIFY_ID_TOKEN` + add a `crm-addon` deploy job before any public deploy.

### 2026-07-21 — Add-on LIVE in Gmail (Cloud Run) + connected/verified thread card
- **Deployed `crm-addon` to Cloud Run** in project **`project-y-email-sentiment`** (us-central1) — confirmed this is the live project (deploy.yml + gcloud), not the stale `health-474623`. Card **renders inside real Gmail** for `npradhan@mystartupcfo.com`.
- Deploy gotchas (all fixed): (1) `--allow-unauthenticated` needs `run.admin`, not just deploy rights; (2) **Bun entrypoint** — `bun dist/index.js` auto-serves the module's DEFAULT export, so use `export default { port, fetch }` (a named export / `@hono/node-server` serve() crashes on boot); (3) trigger response is a **bare RenderActions** `{ action: { navigations: [{ pushCard }] } }` — NO outer `renderActions` key; (4) add-on `deployments create` fails if the name exists → use `deployments replace`; (5) `logoUrl` must be a reachable image.
- **Connected + verified thread card built:** request verification (`auth/verify.ts`, google-auth-library — proves caller is Google, extracts user email, dev bypass); Gmail-user→tenant via `GET /api/internal/integrations/lookup/by-email` (dev fallback `ADDON_DEV_TENANT_ID`); open message → `resolve-by-messages` → `analyzed/:emailId`. Card shows **account name, this message's flags, escalation/task state, subject/from/date**. Verified locally vs clone: real msg `19f83ae139637a2c` → "Elio Technologies FlexCo", flags "Neutral, Upsell signal, Churn risk". 10 tests pass.
- **Honest gaps (need new internal endpoints / not stored):** provenance % (keyword-vs-AI — in `email_analyses`, exposed by no route); interactive Close/Reopen + Assign (task mutations not on `/api/internal`); plan/ARR/renewal (not stored — only name/domains/labels/industry + aggregate stats).
- **To show live data in Gmail:** redeploy connected — `SERVICE_API_KEY` (secret), `SERVICE_API_URL`=deployed crm-api (⇒ real **prod** tenant data, read-only), `ADDON_VERIFY_ID_TOKEN=true`, `ADDON_AUDIENCE`, `GOOGLE_CLIENT_ID`. Verification audience may need one log-driven tuning pass (caller claims are logged); no data leaks while tuning (unverified/unresolved → info card, never data).

### 2026-07-22 — RFC Message-ID resolution (the "cards for any viewer, not just the ingested mailbox" fix)
- **Problem uncovered by the real sync:** syncing `npradhan@`'s mailbox inserted **0** emails — his client threads were already in the clone, ingested via **teammates' (account managers') mailboxes** and stored under *their* per-mailbox Gmail message-ids. `resolve-by-messages` matched only the provider message-id, so npradhan opening the same email (his own per-mailbox id) got "not tracked." This is the design doc's flagged "Message-ID stability" open question, and it means the add-on only worked for the *specific ingested mailbox*, not colleagues on the same thread. Confirmed **88,912 / 88,913** clone emails have `rfc_message_id` populated (indexed) — so the RFC header is a reliable cross-mailbox key.
- **OAuth root cause (separate, now fixed):** the local `.env` had a **stale client id** (`505023465535-…`, from the retired `health-474623` project). The current client is **`crm-oauth`** (`203731638840-…`) in `project-y-email-sentiment`; with its creds the token refreshes fine (no re-auth needed — the token was valid, the client was wrong).
- **The fix (3 parts — all typecheck ✅, 14 addon tests ✅):**
  1. **api** `resolve-by-messages` now matches provider message-id **OR** the stable RFC 2822 `Message-ID` (`emails.rfcMessageId`). `findByMessageIdsScoped` + service + route gained an optional `rfcMessageIds[]`. **Proven** locally: resolves with a *bogus* provider id + a *real* RFC id.
  2. **add-on** reads the open message's `Message-ID` header from Gmail (`apps/addon/src/gmail/gmail-api.ts`, using the current-message token) and passes it along. Best-effort with graceful fallback → provider-id resolution never regresses (verified). 4 unit tests on header extraction.
  3. **api crash-guard**: dropped-DB-connection uncaught errors (`CONNECTION_CLOSED` / null `socket.write`) are now non-fatal (pool reconnects) instead of tearing the service down — fixes the crash seen under sync load (`index.ts` `uncaughtException`/`unhandledRejection` guard).
- **Only validatable in real Gmail:** the live Gmail `Message-ID` fetch (has a fallback + the exact auth-header combo may need one tweak against a real add-on request). Seeing it end-to-end on your inbox still needs deploying the updated api + add-on against the clone (Stage 2).
