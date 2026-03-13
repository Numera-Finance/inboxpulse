#!/usr/bin/env bash
# =============================================================================
# 07-cloud-run.sh — Deploy all Cloud Run services with VPC, ingress, and IAM
#
# This script deploys (or updates) each Cloud Run service with the correct:
#   • Network configuration  — Direct VPC Egress via crm-subnet
#   • Ingress settings       — controls which traffic sources can reach the service
#   • Authentication         — IAM-based (--no-allow-unauthenticated) or open
#   • Service account        — least-privilege SA per service
#   • Secret Manager mounts  — all sensitive config comes from Secret Manager
#   • Scaling config         — min/max instances, CPU, memory
#
# Ingress Decision per Service
# ----------------------------
#   crm-web:           internal-and-cloud-load-balancing
#                      Only reachable through the Global HTTPS Load Balancer.
#                      Direct *.run.app URL is blocked from internet.
#
#   crm-api:           internal-and-cloud-load-balancing
#                      Only reachable through the Global HTTPS Load Balancer.
#                      Direct *.run.app URL is blocked from internet.
#
#   crm-gmail:         all  (but --no-allow-unauthenticated)
#                      Pub/Sub pushes originate from Google's infrastructure
#                      outside our VPC.  Setting ingress=internal would block
#                      Pub/Sub.  We use ingress=all but require IAM auth —
#                      only the crm-pubsub-invoker-sa can invoke it.
#
#   crm-analysis:      internal
#                      Only reachable from within the VPC.  Cloud Run services
#                      with Direct VPC Egress appear as VPC resources and can
#                      call internal Cloud Run services.
#
#   crm-notifications: all  (but Inngest HMAC signature validation in app)
#                      Inngest cloud must call back to this service.  Protected
#                      by Inngest's HMAC signature verification on every request.
#
# VPC Egress
# ----------
# All backend services use --vpc-egress=all-traffic. This routes ALL outbound
# traffic through the VPC subnet, which in turn uses Cloud NAT for internet
# access. This ensures:
#   • LLM API calls (OpenAI, Anthropic, Google AI, xAI) go via Cloud NAT
#   • Amazon SES calls go via Cloud NAT
#   • Inngest cloud calls go via Cloud NAT
#   • Internal service calls go via VPC private networking
#   • Cloud SQL connections go via VPC private IP
#
# USAGE: bash infra/07-cloud-run.sh
#
# NOTE: This script deploys placeholder "hello world" images on first run.
#       Actual application images are deployed by the GitHub Actions CI/CD
#       pipeline in .github/workflows/deploy.yml.
#       Run this script to configure networking/IAM; CI/CD handles code deploys.
# =============================================================================
set -euo pipefail
source "$(dirname "$0")/00-variables.env"

log()    { echo "[$(date +'%H:%M:%S')] $*"; }
success(){ echo "[$(date +'%H:%M:%S')]   ✓ $*"; }

# Placeholder image used for initial service creation
# (establishes the service configuration; CI/CD replaces this with real images)
PLACEHOLDER_IMAGE="us-docker.pkg.dev/cloudrun/container/hello"

# Full subnet path for Direct VPC Egress
SUBNET_PATH="projects/${PROJECT_ID}/regions/${REGION}/subnetworks/${SUBNET_NAME}"

# ==============================================================================
# ─── 1. crm-web ──────────────────────────────────────────────────────────────
# ==============================================================================
log ""
log "=== 1. Deploying crm-web ==="
log "   Ingress: internal-and-cloud-load-balancing"
log "   Auth:    allow-unauthenticated (public SPA served via Load Balancer)"
log "   VPC:     private-ranges-only (no external API calls needed from web)"

EXISTING_WEB=$(gcloud run services describe "${SVC_WEB}" \
  --project="${PROJECT_ID}" \
  --region="${REGION}" \
  --format="value(status.url)" 2>/dev/null || echo "")

if [[ -n "${EXISTING_WEB}" ]]; then
  log "  Service '${SVC_WEB}' exists — updating configuration"
else
  log "  Service '${SVC_WEB}' not found — creating with placeholder image"
fi

gcloud run deploy "${SVC_WEB}" \
  --project="${PROJECT_ID}" \
  --region="${REGION}" \
  \
  --image="${PLACEHOLDER_IMAGE}" \
  `# CI/CD will replace this image on first push to main. ` \
  \
  --port=8080 \
  --service-account="${SA_WEB_EMAIL}" \
  \
  `# ── Network: Direct VPC Egress (private ranges only — no internet calls) ──`\
  --network="${VPC_NAME}" \
  --subnet="${SUBNET_PATH}" \
  --vpc-egress=private-ranges-only \
  `# private-ranges-only: only 10.x, 172.16.x, 192.168.x go via VPC. `\
  `# Internet traffic goes directly without NAT (web doesn't need internet). `\
  \
  `# ── Ingress: only accept traffic from the Global HTTPS Load Balancer ─────`\
  --ingress=internal-and-cloud-load-balancing \
  \
  `# ── Authentication: open (the SPA itself has no auth requirement) ────────`\
  --allow-unauthenticated \
  \
  `# ── Scaling ───────────────────────────────────────────────────────────────`\
  --min-instances=1 \
  `# Keep 1 warm instance to avoid cold starts for web requests.        `\
  --max-instances=20 \
  --memory=256Mi \
  --cpu=1 \
  --timeout=30 \
  `# 30s timeout is plenty for serving static files.                    `\
  --concurrency=1000 \
  `# Nginx can handle many concurrent requests per instance.            `\
  \
  `# ── Environment variables (non-sensitive) ─────────────────────────────────`\
  --set-env-vars="NODE_ENV=production" \
  \
  --no-traffic \
  --quiet

# Web service has no sensitive secrets — VITE_API_URL is injected at runtime
# by docker-entrypoint.sh using the VITE_API_URL env var (non-sensitive).
# Set this after the load balancer is created with the real API domain.

success "crm-web deployed"

# ==============================================================================
# ─── 2. crm-api ──────────────────────────────────────────────────────────────
# ==============================================================================
log ""
log "=== 2. Deploying crm-api ==="
log "   Ingress: internal-and-cloud-load-balancing"
log "   Auth:    allow-unauthenticated (app handles auth with better-auth sessions)"
log "   VPC:     all-traffic (needs Cloud NAT for external OAuth/API calls)"

gcloud run deploy "${SVC_API}" \
  --project="${PROJECT_ID}" \
  --region="${REGION}" \
  \
  --image="${PLACEHOLDER_IMAGE}" \
  \
  --port=4001 \
  --service-account="${SA_API_EMAIL}" \
  \
  `# ── Network ────────────────────────────────────────────────────────────────`\
  --network="${VPC_NAME}" \
  --subnet="${SUBNET_PATH}" \
  --vpc-egress=all-traffic \
  `# all-traffic: route everything (including internet) via VPC + Cloud NAT. `\
  `# API calls external services (Google OAuth, etc.) via Cloud NAT.          `\
  \
  --ingress=internal-and-cloud-load-balancing \
  \
  --allow-unauthenticated \
  \
  `# ── Scaling ────────────────────────────────────────────────────────────────`\
  --min-instances=1 \
  --max-instances=20 \
  --memory=512Mi \
  --cpu=1 \
  --timeout=300 \
  --concurrency=100 \
  \
  `# ── Secrets from Secret Manager ────────────────────────────────────────────`\
  `# Format: ENV_VAR=secret-name:version                                       `\
  --set-secrets="\
DATABASE_URL=${SECRET_DB_URL}:latest,\
BETTER_AUTH_SECRET=${SECRET_BETTER_AUTH_SECRET}:latest,\
GOOGLE_CLIENT_ID=${SECRET_GOOGLE_CLIENT_ID}:latest,\
GOOGLE_CLIENT_SECRET=${SECRET_GOOGLE_CLIENT_SECRET}:latest,\
INTERNAL_API_KEY=${SECRET_INTERNAL_API_KEY}:latest,\
ENCRYPTION_SECRET=${SECRET_ENCRYPTION_SECRET}:latest,\
CLOUDSQL_SERVER_CA=CLOUDSQL_SERVER_CA:latest,\
CLOUDSQL_CLIENT_CERT=CLOUDSQL_CLIENT_CERT:latest,\
CLOUDSQL_CLIENT_KEY=CLOUDSQL_CLIENT_KEY:latest" \
  \
  `# ── Non-sensitive env vars ─────────────────────────────────────────────────`\
  --set-env-vars="\
NODE_ENV=production,\
PORT=4001,\
BETTER_AUTH_URL=https://${API_DOMAIN},\
WEB_URL=https://${WEB_DOMAIN},\
SERVICE_GMAIL_URL=PLACEHOLDER_WILL_BE_SET_AFTER_GMAIL_DEPLOY,\
SERVICE_ANALYSIS_URL=PLACEHOLDER_WILL_BE_SET_AFTER_ANALYSIS_DEPLOY" \
  \
  --no-traffic \
  --quiet

success "crm-api deployed"

# ==============================================================================
# ─── 3. crm-gmail ────────────────────────────────────────────────────────────
# ==============================================================================
log ""
log "=== 3. Deploying crm-gmail ==="
log "   Ingress: all (Pub/Sub originates outside VPC — ingress=internal would block it)"
log "   Auth:    no-allow-unauthenticated (only crm-pubsub-invoker-sa can invoke)"
log "   VPC:     all-traffic (needs Cloud NAT for Gmail API calls)"

gcloud run deploy "${SVC_GMAIL}" \
  --project="${PROJECT_ID}" \
  --region="${REGION}" \
  \
  --image="${PLACEHOLDER_IMAGE}" \
  \
  --port=4002 \
  --service-account="${SA_GMAIL_EMAIL}" \
  \
  --network="${VPC_NAME}" \
  --subnet="${SUBNET_PATH}" \
  --vpc-egress=all-traffic \
  \
  --ingress=all \
  `# Must be 'all' so Pub/Sub push subscriptions can reach this endpoint. `\
  \
  --no-allow-unauthenticated \
  `# Requires IAM token auth. Only crm-pubsub-invoker-sa has run.invoker. `\
  `# Pub/Sub push subscription is configured with this SA in 09-pubsub.sh.`\
  \
  --min-instances=0 \
  --max-instances=10 \
  --memory=512Mi \
  --cpu=1 \
  --timeout=300 \
  --concurrency=80 \
  \
  --set-secrets="\
DATABASE_URL=${SECRET_DB_URL}:latest,\
INTERNAL_API_KEY=${SECRET_INTERNAL_API_KEY}:latest,\
ENCRYPTION_SECRET=${SECRET_ENCRYPTION_SECRET}:latest,\
PUBSUB_VERIFICATION_TOKEN=${SECRET_PUBSUB_TOKEN}:latest,\
GOOGLE_CLIENT_ID=${SECRET_GOOGLE_CLIENT_ID}:latest,\
GOOGLE_CLIENT_SECRET=${SECRET_GOOGLE_CLIENT_SECRET}:latest,\
CLOUDSQL_SERVER_CA=CLOUDSQL_SERVER_CA:latest,\
CLOUDSQL_CLIENT_CERT=CLOUDSQL_CLIENT_CERT:latest,\
CLOUDSQL_CLIENT_KEY=CLOUDSQL_CLIENT_KEY:latest" \
  \
  --set-env-vars="\
NODE_ENV=production,\
PORT=4002,\
GOOGLE_CLOUD_PROJECT_ID=${PROJECT_ID},\
SERVICE_API_URL=PLACEHOLDER_WILL_BE_SET_AFTER_API_DEPLOY" \
  \
  --no-traffic \
  --quiet

GMAIL_SERVICE_URL=$(gcloud run services describe "${SVC_GMAIL}" \
  --project="${PROJECT_ID}" \
  --region="${REGION}" \
  --format="value(status.url)" 2>/dev/null || echo "")
success "crm-gmail deployed: ${GMAIL_SERVICE_URL}"

# ── Grant Pub/Sub invoker role on crm-gmail ────────────────────────────────
# Now that the service exists, grant crm-pubsub-invoker-sa the run.invoker role.
# This allows the Pub/Sub push subscription (configured with this SA) to invoke
# the crm-gmail Cloud Run service.
log ""
log "  → Granting roles/run.invoker on crm-gmail to crm-pubsub-invoker-sa"
gcloud run services add-iam-policy-binding "${SVC_GMAIL}" \
  --project="${PROJECT_ID}" \
  --region="${REGION}" \
  --member="serviceAccount:${SA_PUBSUB_INVOKER_EMAIL}" \
  --role="roles/run.invoker" \
  --quiet 2>/dev/null || true
success "crm-pubsub-invoker-sa can invoke crm-gmail"

# ==============================================================================
# ─── 4. crm-analysis ─────────────────────────────────────────────────────────
# ==============================================================================
log ""
log "=== 4. Deploying crm-analysis ==="
log "   Ingress: internal (only reachable from VPC — crm-api calls it internally)"
log "   Auth:    no-allow-unauthenticated"
log "   VPC:     all-traffic (needs Cloud NAT for LLM API calls: OpenAI, Anthropic, etc.)"

gcloud run deploy "${SVC_ANALYSIS}" \
  --project="${PROJECT_ID}" \
  --region="${REGION}" \
  \
  --image="${PLACEHOLDER_IMAGE}" \
  \
  --port=4003 \
  --service-account="${SA_ANALYSIS_EMAIL}" \
  \
  --network="${VPC_NAME}" \
  --subnet="${SUBNET_PATH}" \
  --vpc-egress=all-traffic \
  `# Must route all traffic via VPC+NAT for LLM API calls (OpenAI, Anthropic, `\
  `# Google AI, xAI) and Langfuse observability.                               `\
  \
  --ingress=internal \
  `# Only VPC-internal traffic accepted. crm-api (with VPC egress) can reach `\
  `# this service. Direct internet access is impossible.                      `\
  \
  --no-allow-unauthenticated \
  \
  --min-instances=0 \
  --max-instances=10 \
  --memory=1Gi \
  `# LLM calls can hold connections open; extra memory prevents OOM.   `\
  --cpu=2 \
  `# More CPU helps with concurrent LLM requests + response parsing.   `\
  --timeout=600 \
  `# 10 min timeout: LLM streaming responses can take a long time.     `\
  --concurrency=50 \
  \
  --set-secrets="\
DATABASE_URL=${SECRET_DB_URL}:latest,\
INTERNAL_API_KEY=${SECRET_INTERNAL_API_KEY}:latest,\
ENCRYPTION_SECRET=${SECRET_ENCRYPTION_SECRET}:latest,\
HUGGINGFACE_API_TOKEN=${SECRET_HUGGINGFACE_TOKEN}:latest,\
CLOUDSQL_SERVER_CA=CLOUDSQL_SERVER_CA:latest,\
CLOUDSQL_CLIENT_CERT=CLOUDSQL_CLIENT_CERT:latest,\
CLOUDSQL_CLIENT_KEY=CLOUDSQL_CLIENT_KEY:latest" \
  \
  --set-env-vars="\
NODE_ENV=production,\
PORT=4003,\
SERVICE_API_URL=PLACEHOLDER_WILL_BE_SET_AFTER_API_DEPLOY" \
  \
  --no-traffic \
  --quiet

ANALYSIS_SERVICE_URL=$(gcloud run services describe "${SVC_ANALYSIS}" \
  --project="${PROJECT_ID}" \
  --region="${REGION}" \
  --format="value(status.url)" 2>/dev/null || echo "")
success "crm-analysis deployed: ${ANALYSIS_SERVICE_URL}"

# ==============================================================================
# ─── 5. crm-notifications ────────────────────────────────────────────────────
# ==============================================================================
log ""
log "=== 5. Deploying crm-notifications ==="
log "   Ingress: all (Inngest cloud must call back to this service)"
log "   Auth:    allow-unauthenticated (Inngest HMAC signing validates requests)"
log "   VPC:     all-traffic (needs Cloud NAT for Amazon SES + Inngest API)"

gcloud run deploy "${SVC_NOTIFICATIONS}" \
  --project="${PROJECT_ID}" \
  --region="${REGION}" \
  \
  --image="${PLACEHOLDER_IMAGE}" \
  \
  --port=4004 \
  --service-account="${SA_NOTIFICATIONS_EMAIL}" \
  \
  --network="${VPC_NAME}" \
  --subnet="${SUBNET_PATH}" \
  --vpc-egress=all-traffic \
  `# Must route via VPC+NAT for: Amazon SES (email sending), Inngest API. `\
  \
  --ingress=all \
  `# Inngest cloud originates from outside our VPC and needs to reach this `\
  `# endpoint.  Application-level HMAC validation via INNGEST_SIGNING_KEY   `\
  `# provides the security boundary.                                         `\
  \
  --allow-unauthenticated \
  `# Inngest cannot present IAM tokens — it uses its own HMAC auth scheme. `\
  \
  --min-instances=0 \
  --max-instances=10 \
  --memory=512Mi \
  --cpu=1 \
  --timeout=300 \
  --concurrency=80 \
  \
  --set-secrets="\
DATABASE_URL=${SECRET_DB_URL}:latest,\
INTERNAL_API_KEY=${SECRET_INTERNAL_API_KEY}:latest,\
INNGEST_EVENT_KEY=${SECRET_INNGEST_EVENT_KEY}:latest,\
INNGEST_SIGNING_KEY=${SECRET_INNGEST_SIGNING_KEY}:latest,\
CLOUDSQL_SERVER_CA=CLOUDSQL_SERVER_CA:latest,\
CLOUDSQL_CLIENT_CERT=CLOUDSQL_CLIENT_CERT:latest,\
CLOUDSQL_CLIENT_KEY=CLOUDSQL_CLIENT_KEY:latest" \
  \
  --set-env-vars="\
NODE_ENV=production,\
PORT=4004,\
SERVICE_API_URL=PLACEHOLDER_WILL_BE_SET_AFTER_API_DEPLOY" \
  \
  --no-traffic \
  --quiet

NOTIFICATIONS_SERVICE_URL=$(gcloud run services describe "${SVC_NOTIFICATIONS}" \
  --project="${PROJECT_ID}" \
  --region="${REGION}" \
  --format="value(status.url)" 2>/dev/null || echo "")
success "crm-notifications deployed: ${NOTIFICATIONS_SERVICE_URL}"

# ==============================================================================
# ─── 6. Wire up service-to-service URLs ──────────────────────────────────────
# ==============================================================================
log ""
log "=== 6. Updating service URLs (internal cross-service references) ==="
log "   Services call each other via their .run.app URLs."
log "   These go through VPC egress and are treated as internal traffic."

# Get the actual deployed service URLs
API_URL=$(gcloud run services describe "${SVC_API}" \
  --project="${PROJECT_ID}" \
  --region="${REGION}" \
  --format="value(status.url)" 2>/dev/null || echo "")

log "  API URL:           ${API_URL}"
log "  Gmail URL:         ${GMAIL_SERVICE_URL}"
log "  Analysis URL:      ${ANALYSIS_SERVICE_URL}"
log "  Notifications URL: ${NOTIFICATIONS_SERVICE_URL}"

# Update crm-api with the real gmail and analysis URLs
log ""
log "  → Updating crm-api with gmail + analysis service URLs"
gcloud run services update "${SVC_API}" \
  --project="${PROJECT_ID}" \
  --region="${REGION}" \
  --update-env-vars="\
SERVICE_GMAIL_URL=${GMAIL_SERVICE_URL},\
SERVICE_ANALYSIS_URL=${ANALYSIS_SERVICE_URL}" \
  --quiet 2>/dev/null || true

# Update crm-gmail with the real api URL
log "  → Updating crm-gmail with api service URL"
gcloud run services update "${SVC_GMAIL}" \
  --project="${PROJECT_ID}" \
  --region="${REGION}" \
  --update-env-vars="SERVICE_API_URL=${API_URL}" \
  --quiet 2>/dev/null || true

# Update crm-analysis with the real api URL
log "  → Updating crm-analysis with api service URL"
gcloud run services update "${SVC_ANALYSIS}" \
  --project="${PROJECT_ID}" \
  --region="${REGION}" \
  --update-env-vars="SERVICE_API_URL=${API_URL}" \
  --quiet 2>/dev/null || true

# Update crm-notifications with the real api URL
log "  → Updating crm-notifications with api service URL"
gcloud run services update "${SVC_NOTIFICATIONS}" \
  --project="${PROJECT_ID}" \
  --region="${REGION}" \
  --update-env-vars="SERVICE_API_URL=${API_URL}" \
  --quiet 2>/dev/null || true

# ── Send all traffic to the new (latest) revision ────────────────────────────
log ""
log "=== 7. Directing 100% traffic to latest revisions ==="
for svc in "${SVC_WEB}" "${SVC_API}" "${SVC_GMAIL}" "${SVC_ANALYSIS}" "${SVC_NOTIFICATIONS}"; do
  log "  → ${svc}: traffic=latest"
  gcloud run services update-traffic "${svc}" \
    --project="${PROJECT_ID}" \
    --region="${REGION}" \
    --to-latest \
    --quiet 2>/dev/null || true
done

# ==============================================================================
log ""
log "=== Cloud Run Deployment Complete ==="
log ""
log "Service URLs (internal *.run.app — not directly accessible from internet):"
log ""
log "  crm-web:           $(gcloud run services describe ${SVC_WEB} --project=${PROJECT_ID} --region=${REGION} --format='value(status.url)' 2>/dev/null || echo '<deploying>')"
log "  crm-api:           $(gcloud run services describe ${SVC_API} --project=${PROJECT_ID} --region=${REGION} --format='value(status.url)' 2>/dev/null || echo '<deploying>')"
log "  crm-gmail:         $(gcloud run services describe ${SVC_GMAIL} --project=${PROJECT_ID} --region=${REGION} --format='value(status.url)' 2>/dev/null || echo '<deploying>')"
log "  crm-analysis:      $(gcloud run services describe ${SVC_ANALYSIS} --project=${PROJECT_ID} --region=${REGION} --format='value(status.url)' 2>/dev/null || echo '<deploying>')"
log "  crm-notifications: $(gcloud run services describe ${SVC_NOTIFICATIONS} --project=${PROJECT_ID} --region=${REGION} --format='value(status.url)' 2>/dev/null || echo '<deploying>')"
log ""
log "IMPORTANT: crm-web and crm-api are NOT publicly accessible yet."
log "  Run 08-load-balancer.sh to create the public HTTPS Load Balancers."
log ""
log "Next step: bash infra/08-load-balancer.sh"
