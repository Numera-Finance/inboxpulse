#!/usr/bin/env bash
# =============================================================================
# 09-pubsub.sh — Configure Pub/Sub for Gmail push notifications
#
# How Gmail + Pub/Sub works
# -------------------------
# 1. A user connects their Gmail account via OAuth (stored in DB as integration)
# 2. The app calls Gmail API's users.watch() to register a Pub/Sub topic
# 3. When Gmail receives a new email, it publishes a notification to the topic
# 4. Pub/Sub push-delivers the notification to crm-gmail's webhook endpoint
# 5. crm-gmail reads the message, fetches the new email(s) via Gmail API
#
# Gmail watches expire after 7 days — an Inngest cron job renews them daily.
#
# Security model
# --------------
# crm-gmail is deployed with --no-allow-unauthenticated, meaning Cloud Run
# will reject any request that doesn't carry a valid Google OIDC token.
#
# The Pub/Sub push subscription is configured with the crm-pubsub-invoker-sa
# service account. When Pub/Sub pushes a message, it:
#   a) Obtains an OIDC token signed by crm-pubsub-invoker-sa
#   b) Includes it in the Authorization: Bearer <token> header
#   c) Cloud Run verifies the token and checks that crm-pubsub-invoker-sa
#      has roles/run.invoker on crm-gmail (granted in 06 + 07)
#   d) Only then forwards the request to the crm-gmail container
#
# This means the only entity that can invoke crm-gmail is:
#   • Pub/Sub (via crm-pubsub-invoker-sa)
#   • Other services within the VPC (crm-api, etc.) that have run.invoker
#
# USAGE: bash infra/09-pubsub.sh
# =============================================================================
set -euo pipefail
source "$(dirname "$0")/00-variables.env"

log()    { echo "[$(date +'%H:%M:%S')] $*"; }
success(){ echo "[$(date +'%H:%M:%S')]   ✓ $*"; }

# ─── 1. Create the Pub/Sub topic ──────────────────────────────────────────────
log "=== Step 1: Pub/Sub Topic ==="

EXISTING_TOPIC=$(gcloud pubsub topics describe "${PUBSUB_TOPIC}" \
  --project="${PROJECT_ID}" \
  --format="value(name)" 2>/dev/null || echo "")

if [[ -n "${EXISTING_TOPIC}" ]]; then
  success "Topic '${PUBSUB_TOPIC}' already exists"
else
  log "  → Creating Pub/Sub topic '${PUBSUB_TOPIC}'"
  gcloud pubsub topics create "${PUBSUB_TOPIC}" \
    --project="${PROJECT_ID}" \
    --message-retention-duration=1d \
    `# Retain undelivered messages for 24 hours.  This provides a buffer if ` \
    `# crm-gmail is temporarily unavailable.                                 ` \
    --labels="env=production,team=crm"
  success "Topic '${PUBSUB_TOPIC}' created"
fi

# ─── 2. Grant Gmail API publisher permission on the topic ─────────────────────
# The Gmail API publishes to our topic on behalf of users who connected Gmail.
# It uses a Google-managed service account: gmail-api-push@system.gserviceaccount.com
# This is a Google system SA — you cannot look it up; just grant the role.
log ""
log "=== Step 2: Grant Gmail API publish permission ==="

log "  → Granting roles/pubsub.publisher to Gmail API service account"
gcloud pubsub topics add-iam-policy-binding "${PUBSUB_TOPIC}" \
  --project="${PROJECT_ID}" \
  --member="serviceAccount:gmail-api-push@system.gserviceaccount.com" \
  --role="roles/pubsub.publisher" \
  --quiet 2>/dev/null || true
success "Gmail API can publish to '${PUBSUB_TOPIC}'"

# ─── 3. Get the crm-gmail Cloud Run service URL ───────────────────────────────
# The push subscription endpoint must be the HTTPS URL of crm-gmail's webhook.
log ""
log "=== Step 3: Get crm-gmail service URL ==="

GMAIL_SERVICE_URL=$(gcloud run services describe "${SVC_GMAIL}" \
  --project="${PROJECT_ID}" \
  --region="${REGION}" \
  --format="value(status.url)" 2>/dev/null || echo "")

if [[ -z "${GMAIL_SERVICE_URL}" ]]; then
  echo "ERROR: crm-gmail service not found. Run 07-cloud-run.sh first." >&2
  exit 1
fi

WEBHOOK_ENDPOINT="${GMAIL_SERVICE_URL}/webhooks/pubsub"
log "  Gmail service URL:  ${GMAIL_SERVICE_URL}"
log "  Webhook endpoint:   ${WEBHOOK_ENDPOINT}"

# ─── 4. Create the authenticated push subscription ────────────────────────────
log ""
log "=== Step 4: Push Subscription (authenticated) ==="

EXISTING_SUB=$(gcloud pubsub subscriptions describe "${PUBSUB_SUBSCRIPTION}" \
  --project="${PROJECT_ID}" \
  --format="value(name)" 2>/dev/null || echo "")

if [[ -n "${EXISTING_SUB}" ]]; then
  log "  Subscription '${PUBSUB_SUBSCRIPTION}' exists — updating push endpoint"
  # Update the endpoint in case the Cloud Run URL changed
  gcloud pubsub subscriptions modify-push-config "${PUBSUB_SUBSCRIPTION}" \
    --project="${PROJECT_ID}" \
    --push-endpoint="${WEBHOOK_ENDPOINT}" \
    --push-auth-service-account="${SA_PUBSUB_INVOKER_EMAIL}"
  success "Push endpoint updated to ${WEBHOOK_ENDPOINT}"
else
  log "  → Creating push subscription '${PUBSUB_SUBSCRIPTION}'"
  log "    Push endpoint:      ${WEBHOOK_ENDPOINT}"
  log "    Auth service acct:  ${SA_PUBSUB_INVOKER_EMAIL}"

  gcloud pubsub subscriptions create "${PUBSUB_SUBSCRIPTION}" \
    --project="${PROJECT_ID}" \
    --topic="${PUBSUB_TOPIC}" \
    \
    --push-endpoint="${WEBHOOK_ENDPOINT}" \
    `# Pub/Sub will POST to this URL when a Gmail notification arrives.   ` \
    \
    --push-auth-service-account="${SA_PUBSUB_INVOKER_EMAIL}" \
    `# Pub/Sub generates an OIDC token as this SA and includes it in the  ` \
    `# Authorization header. Cloud Run verifies the token and checks that  ` \
    `# crm-pubsub-invoker-sa has roles/run.invoker on crm-gmail.          ` \
    \
    --ack-deadline=60 \
    `# 60 seconds for crm-gmail to process the message and acknowledge it.` \
    `# Gmail notifications are lightweight (just a historyId), so 60s is  ` \
    `# generous. Increase if crm-gmail processing is slow.                ` \
    \
    --message-retention-duration=10m \
    `# Keep unacknowledged messages for 10 minutes. If crm-gmail fails to ` \
    `# ack within this window, Pub/Sub redelivers the message.            ` \
    \
    --max-delivery-attempts=5 \
    `# Retry up to 5 times with exponential backoff before dead-lettering.` \
    \
    --min-retry-delay=10s \
    --max-retry-delay=600s \
    `# Exponential backoff: 10s, 20s, 40s ... up to 600s between retries. ` \
    \
    --labels="env=production,team=crm"

  success "Push subscription '${PUBSUB_SUBSCRIPTION}' created"
fi

# ─── 5. Create a dead-letter topic ────────────────────────────────────────────
# Messages that fail all 5 retry attempts are forwarded here.
# Set up an alert on this topic (in 12-monitoring.sh) so ops is notified.
DLT_NAME="${PUBSUB_TOPIC}-deadletter"
log ""
log "=== Step 5: Dead-Letter Topic ==="

EXISTING_DLT=$(gcloud pubsub topics describe "${DLT_NAME}" \
  --project="${PROJECT_ID}" \
  --format="value(name)" 2>/dev/null || echo "")

if [[ -n "${EXISTING_DLT}" ]]; then
  success "Dead-letter topic '${DLT_NAME}' already exists"
else
  log "  → Creating dead-letter topic '${DLT_NAME}'"
  gcloud pubsub topics create "${DLT_NAME}" \
    --project="${PROJECT_ID}" \
    --message-retention-duration=7d \
    --labels="env=production,team=crm"
  success "Dead-letter topic created"
fi

# Grant Pub/Sub service account permission to publish to the dead-letter topic
PROJECT_NUMBER=$(gcloud projects describe "${PROJECT_ID}" --format="value(projectNumber)")
PUBSUB_SA="service-${PROJECT_NUMBER}@gcp-sa-pubsub.iam.gserviceaccount.com"

log "  → Granting dead-letter publisher permission to Pub/Sub service agent"
gcloud pubsub topics add-iam-policy-binding "${DLT_NAME}" \
  --project="${PROJECT_ID}" \
  --member="serviceAccount:${PUBSUB_SA}" \
  --role="roles/pubsub.publisher" \
  --quiet 2>/dev/null || true

gcloud pubsub subscriptions add-iam-policy-binding "${PUBSUB_SUBSCRIPTION}" \
  --project="${PROJECT_ID}" \
  --member="serviceAccount:${PUBSUB_SA}" \
  --role="roles/pubsub.subscriber" \
  --quiet 2>/dev/null || true

# Update subscription to use dead-letter topic
gcloud pubsub subscriptions update "${PUBSUB_SUBSCRIPTION}" \
  --project="${PROJECT_ID}" \
  --dead-letter-topic="${DLT_NAME}" \
  --max-delivery-attempts=5 \
  --quiet 2>/dev/null || true
success "Dead-letter topic connected to subscription"

# ─── 6. Create a dead-letter subscription (for monitoring/reprocessing) ───────
DLT_SUB="${DLT_NAME}-sub"
EXISTING_DLT_SUB=$(gcloud pubsub subscriptions describe "${DLT_SUB}" \
  --project="${PROJECT_ID}" \
  --format="value(name)" 2>/dev/null || echo "")

if [[ -n "${EXISTING_DLT_SUB}" ]]; then
  success "Dead-letter subscription '${DLT_SUB}' already exists"
else
  log ""
  log "  → Creating pull subscription on dead-letter topic (for manual replay)"
  gcloud pubsub subscriptions create "${DLT_SUB}" \
    --project="${PROJECT_ID}" \
    --topic="${DLT_NAME}" \
    --ack-deadline=600 \
    --message-retention-duration=7d \
    --labels="env=production,team=crm"
  success "Dead-letter subscription '${DLT_SUB}' created"
fi

# ==============================================================================
log ""
log "=== Pub/Sub Setup Complete ==="
log ""
log "Topic:                ${PUBSUB_TOPIC}"
log "Subscription:         ${PUBSUB_SUBSCRIPTION}"
log "  Push endpoint:      ${WEBHOOK_ENDPOINT}"
log "  Auth SA:            ${SA_PUBSUB_INVOKER_EMAIL}"
log "  Max retries:        5"
log "  Ack deadline:       60s"
log "Dead-letter topic:    ${DLT_NAME}"
log "Dead-letter sub:      ${DLT_SUB}  (pull — use gcloud pubsub to drain)"
log ""
log "Verify with:"
log "  gcloud pubsub subscriptions describe ${PUBSUB_SUBSCRIPTION} --project=${PROJECT_ID}"
log ""
log "To manually test the webhook (from a machine inside the VPC):"
log "  curl -X POST ${WEBHOOK_ENDPOINT} \\"
log "    -H 'Content-Type: application/json' \\"
log "    -d '{\"message\":{\"data\":\"dGVzdA==\",\"messageId\":\"test\"},\"subscription\":\"test\"}'"
log ""
log "Next step: bash infra/10-workload-identity.sh"
