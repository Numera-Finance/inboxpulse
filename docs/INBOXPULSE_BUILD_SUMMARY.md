# InboxPulse Gmail Add-on — Build Summary & Roadblock Log

**Session:** 2026-07-21 → 2026-07-23 · **Working copy:** `7-21-inboxpulse` (clone of `inboxpulse 6-16-2026`)
**Outcome:** A Google Workspace Add-on rendering live InboxPulse cards inside real Gmail, backed by a clone-isolated API on Cloud Run — plus a real product fix (cross-mailbox message resolution).

---

## 1. What we built

### New: `apps/addon` — the Google Workspace Add-on (HTTP/alternate runtime)
A Bun + Hono service (port **4005**) matching repo conventions (`catalog:` deps, zod `getEnv`, dotenv-first bootstrap, pino, multi-stage Node→Bun Dockerfile).

| File | Purpose |
|---|---|
| `src/index.ts` | Hono bootstrap; `GET /health`, `POST /homepage`, `POST /gmail/contextual` |
| `src/env.ts` | Zod env schema (API URL/key, verification, dev tenant) |
| `src/cards/widgets.ts` | Typed **Cards v2** builders + the trigger-response envelope |
| `src/cards/homepage.ts` | Homepage card (workspace stats) |
| `src/cards/thread.ts` | Contextual card: Account / Flags / Escalation / Message, with `preview`, `unverified`, `unidentified`, `untracked`, `resolved` states |
| `src/cards/signals.ts` | Signal-code → design label map (At risk, Upsell signal, Churn risk, …) |
| `src/gmail/event.ts` | Add-on event typing (`gmail.messageId`, tokens) |
| `src/gmail/gmail-api.ts` | Reads the open message's **RFC `Message-ID`** from Gmail (best-effort, graceful fallback) |
| `src/auth/verify.ts` | Verifies the request genuinely came from Google (`google-auth-library`); extracts the signed-in user's email |
| `src/services/api-client.ts` | Internal API client: stats, email→tenant lookup, resolve-by-messages, analyzed hydration |
| `src/cards/cards.test.ts` · `src/gmail/gmail-api.test.ts` | **14 tests** (card rendering, envelope shape, RFC header extraction) |
| `Dockerfile` · `cloudbuild.yaml` · `deployment.json` · `README.md` · `.env.example` | Build + Workspace add-on manifest + docs |

### Changed: `apps/api` — the real product fix (87 insertions, 6 deletions)
| File | Change |
|---|---|
| `src/emails/repository.ts` | `findByMessageIdsScoped` now matches the provider message-id **OR** the stable **RFC `Message-ID`** (`emails.rfcMessageId`, indexed) |
| `src/emails/service.ts` | `resolveByMessageIds` accepts/forwards `rfcMessageIds` |
| `src/emails/routes.ts` | `resolve-by-messages` accepts optional `rfcMessageIds[]` (+ a temporary debug log — **remove before prod**) |
| `src/index.ts` | **Crash-guard**: a dropped DB connection (`CONNECTION_CLOSED` / null `socket.write`) is now non-fatal instead of killing the service |
| `cloudbuild.yaml` *(new)* | Cloud Build config for the API image |

### Docs
- `docs/INBOXPULSE_ADDON_PLAN.md` — gap analysis (design handoff vs. reality) + dependency-ordered phase plan + progress log.
- `docs/INBOXPULSE_BUILD_SUMMARY.md` — this file.

---

## 2. The roadblocks (the actual path)

1. **The "codebase" was a mock.** The design handoff was an interactive HTML prototype, not code. The real system turned out to be a full pnpm/Turborepo monorepo, scattered across three Downloads folders at different dates. We identified the canonical one and copied it before touching anything.
2. **The backend already existed.** The starting assumption ("we need to build the backend") was wrong. Four parallel analysis agents mapped it: Gmail sync, Pub/Sub, Gemini classification, keyword-rules-over-AI, auto-escalation (Controller→AM), business-day SLA math, and the 8am digest were all already built and matched the design closely. The real gaps were narrower: labels, Q&A, action items, Chat share, and the add-on itself.
3. **Clone DB certs.** The prod certs failed against the clone — it requires **client-cert mTLS with its own CA**. Needed the clone's own three PEMs (`UNABLE_TO_VERIFY_LEAF_SIGNATURE` / `TLSV1_ALERT_UNKNOWN_CA` diagnosed it).
4. **Local dev-auth is broken.** `ALLOW_DEV_AUTH` is **dead code** (computes a flag, then throws unconditionally), and the legacy `test-token` route is **shadowed** by better-auth's `/api/auth/*` catch-all (registered earlier). Worked around via the internal service-key path.
5. **Bun entrypoint gotcha.** `bun dist/index.js` **auto-serves the module's DEFAULT export**. A named `export { app }` made Bun call `Bun.serve()` on an object with no `fetch` → boot crash. Fixed with `export default { port, fetch }` (and no `@hono/node-server` serve call).
6. **Cloud Run IAM.** `--allow-unauthenticated` silently failed — deploy rights aren't enough; setting the invoker policy needs `run.admin`. Symptom was a 403 on every request.
7. **Wrong card envelope.** Google rejected `{"renderActions": {...}}`. The correct response is a **bare RenderActions**: `{"action":{"navigations":[{"pushCard":{…}}]}}`. Docs were ambiguous; the runtime parser error settled it.
8. **Add-on deployment quirks.** `deployments create` fails if the name exists → use `deployments replace`. A 404 `logoUrl` renders an **invisible icon** (why the add-on seemed missing at first).
9. **Stale OAuth client → dead sync.** The Gmail sync failed with `unauthorized_client`. Root cause: the local `.env` carried an OAuth client from the **retired project** (`505023465535-…`); the live one is **`crm-oauth`** (`203731638840-…`) in `project-y-email-sentiment`. With the right creds the stored refresh token worked immediately — no re-auth needed.
10. **PowerShell config mangling.** `Set-Content -Encoding utf8` wrote a **UTF-8 BOM** and blanked the values, breaking env validation. Switched to writing config from Node (no BOM, exact bytes).
11. **The sync inserted 0 emails** — which led to the biggest discovery below.
12. **⭐ The per-mailbox Message-ID problem (product-level).** Gmail message-ids are **per-mailbox**: the same email has a different id in every participant's mailbox. Since `resolve-by-messages` matched only the provider id, the add-on **only ever worked for the one mailbox that was ingested** — a colleague opening the same client thread saw "not tracked." This is the design doc's flagged "Message-ID stability" open question, confirmed in the wild. **Fixed** by resolving on the stable RFC `Message-ID` (populated on **88,912 / 88,913** clone emails) and having the add-on read that header off the open message.
13. **API crashed under sync load.** A dropped clone-DB connection surfaced as an uncaught postgres exception (`null is not an object (socket.write)`) that tore down the whole service. Added a targeted crash-guard.
14. **The honest one: this mailbox has no client email.** InboxPulse deliberately tracks only **external customer** threads. An internal-only inbox will *correctly* never show a card — a user-profile mismatch, not a bug. (Worth telling the team: the add-on is for client-facing staff.)
15. **Tunnel hell.** Free `trycloudflare` quick tunnels collapsed **three times**, twice within seconds, despite passing cloudflared's own connectivity prechecks. Abandoned as unviable.
16. **The proper fix for #15.** Discovered the clone has a **private IP (`10.1.0.13`) on the same `crm-vpc`** the prod services already use. Deployed **`crm-api-clone`** to Cloud Run with VPC egress → private IP. Stable, no tunnel, no public DB exposure.
17. **The last one-liner.** After all that, the card still showed "not tracked" — because the add-on's `SERVICE_API_URL` update hadn't applied (still on the dead tunnel, still revision `-00005`). Clone-API logs showing **zero inbound calls** pinpointed it instantly.

---

## 3. What's live

- **`crm-api-clone`** (Cloud Run, `us-central1`) → VPC egress → clone's private IP. Verified: resolves emails against the clone.
- **`crm-addon`** (Cloud Run, rev `crm-addon-00006-8ng`) → points at `crm-api-clone`; request verification on; installed as a Workspace add-on and rendering in real Gmail.
- Secret Manager: `CLONE_DATABASE_URL`, `CLONE_CLOUDSQL_SERVER_CA`, `CLONE_CLOUDSQL_CLIENT_CERT`, `CLONE_CLOUDSQL_CLIENT_KEY`.

**Proven end-to-end:** direct-insert → Gemini analysis → signals (Negative/Upsell/Churn) + **auto-escalation task** → `resolve-by-messages` → `analyzed/:id` → rendered card. Plus RFC-id resolution proven with a bogus provider id.

---

## 4. Porting to the real repo — read this first

- **Port these:** the 4 `apps/api` edits, `apps/api/cloudbuild.yaml`, all of `apps/addon/`, and the two docs. That's the whole product change.
- **Remove before prod:** the `resolve-by-messages debug` `logger.info` in `apps/api/src/emails/routes.ts`.
- **Won't travel (gitignored):** `apps/*/.env.local`, `certs/clone/`. Recreate as needed.
- **Demo data is clone-only:** the `msg-f:1871293816951050858` record, the `Acmefinance (Auto)` customer, and the hand-created contact/participant were fabricated **for the demo** (an internal thread has no real customer). Do not treat as real analysis.
- **Rotate the secrets that passed through chat:** `crm_app` DB password, Gemini API key, `SERVICE_API_KEY`, and the `crm-oauth` client secret.
- **Add `crm-addon` to `.github/workflows/deploy.yml`** — it's currently deployed by hand only.
- **Before any public/prod add-on deploy:** tighten `ADDON_AUDIENCE` (currently signature+issuer only), and wire real Gmail-user→tenant resolution (the pinned `ADDON_DEV_TENANT_ID` fallback is a demo shortcut).

---

## 5. What's left (from the original handoff)

**Sidebar sections not yet built:** Q&A found in thread · Action items & dates · Went-cold alert · Sentiment trend chart · Connected systems (Jira) · Data-quality prompts · Suggested search · Provenance ("Keyword rule match" vs "AI · N%") · interactive Close/Reopen, "Not an escalation", Assign.

**Scope-gated:** native **Gmail labels** (needs `gmail.labels`/`gmail.modify` + admin consent) · **Share to Google Chat** (Chat scopes; deferred).

**Known data-integrity smells** (align with the "Sandeep" open question): TAT buckets are **non-cumulative** despite `N+` naming, and escalation-aging uses **calendar days** while TAT uses **business days**.

**Also missing at the API layer:** provenance (`model_used`/`confidence`/`reasoning` are stored in `email_analyses` but exposed by no endpoint) and task mutations on `/api/internal` (needed for interactive Close/Reopen/Assign).
