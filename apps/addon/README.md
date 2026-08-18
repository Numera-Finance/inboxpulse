# crm-addon — InboxPulse Google Workspace Add-on (HTTP runtime)

An HTTP-based Google Workspace Add-on that renders the InboxPulse sidebar inside
Gmail. Google calls this service's HTTPS endpoints when triggers fire; the
endpoints return Cards-v2 JSON. Data comes from `apps/api` via the internal
service path (`/api/internal/*`).

- **Runtime:** Bun + Hono (port **4005**), matching the other services.
- **Response schema:** `renderActions → action → navigations → pushCard(Card)`
  ([Google docs](https://developers.google.com/workspace/add-ons/guides/alternate-runtimes)).

## Endpoints
| Method | Path | Trigger |
|---|---|---|
| `GET`  | `/health` | health check |
| `POST` | `/homepage` | add-on homepage |
| `POST` | `/gmail/contextual` | Gmail message open |

## Run locally
```bash
cp apps/addon/.env.example apps/addon/.env.local
# (optional) set SERVICE_API_KEY + ADDON_DEV_TENANT_ID to show live clone data
pnpm --filter @crm/api dev      # terminal 1 (data source)
pnpm --filter @crm/addon dev    # terminal 2

# Homepage card
curl -s -XPOST http://localhost:4005/homepage | jq
# Contextual card (simulate a Gmail message-open event)
curl -s -XPOST http://localhost:4005/gmail/contextual \
  -H 'content-type: application/json' \
  -d '{"gmail":{"messageId":"msg-f:123","threadId":"thread-f:1"}}' | jq
```
With no `SERVICE_API_KEY`/`ADDON_DEV_TENANT_ID` the cards render in **preview
mode** (valid JSON, no live data), so the service boots with zero config.

## See it inside real Gmail (dev)
Google must reach this endpoint over HTTPS, so expose it with a tunnel:
```bash
cloudflared tunnel --url http://localhost:4005   # or: ngrok http 4005
```
Put the tunnel URL into `apps/addon/deployment.json` (`REPLACE_ADDON_URL`) and
register the deployment via the Google Workspace Marketplace SDK in project
`health-474623` (see that file's `_comment`).

## ⚠️ Currently UNREGISTERED (2026-08-03)

The `inboxpulse-dev` deployment was uninstalled and deleted when the sidebar
consolidated onto the Chrome extension — running both put two identically-titled
"InboxPulse" panels in Gmail's rail.

Note this was **not** done by deleting the Cloud Run service. The Marketplace
*deployment* is what makes the add-on appear in Gmail; deleting only the service
would have left the deployment registered and pointing at a dead URL, so the
icon would stay in the rail and render an error. The `crm-addon` Cloud Run
service is still deployed and healthy — it just has nothing calling it.

**To restore it**, `deployment.live.json` still holds the exact config that was
registered (verified byte-for-byte against the live deployment before deletion):

```bash
gcloud workspace-add-ons deployments create inboxpulse-dev \
  --deployment-file=apps/addon/deployment.live.json \
  --project project-y-email-sentiment
gcloud workspace-add-ons deployments install inboxpulse-dev \
  --project project-y-email-sentiment
```

Check state any time with `deployments list` and
`deployments install-status inboxpulse-dev`. Before restoring, decide what
should happen to the extension's own sidebar panel — otherwise the duplicate
comes back.

## Status (scaffold)
- ✅ Service skeleton, both triggers, typed Cards-v2 builders, live-data client, tests.
- ⏳ **Next:** resolve the OPEN thread's customer via
  `POST /api/internal/emails/resolve-by-messages` and render the full design
  (account card, went-cold alert, per-thread flags + provenance, Q&A, action items).
- ⏳ **Before deploy:** implement `ADDON_VERIFY_ID_TOKEN` (verify Google's signed
  request), wire real Gmail-user → tenant resolution, add a `crm-addon` job to
  `.github/workflows/deploy.yml`.
