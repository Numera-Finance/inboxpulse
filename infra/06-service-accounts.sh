#!/usr/bin/env bash
# =============================================================================
# 06-service-accounts.sh — Create service accounts and IAM bindings
#
# Principle of Least Privilege
# ----------------------------
# Each Cloud Run service runs as a dedicated service account that has ONLY the
# permissions it actually needs.  This limits blast radius if a service is
# compromised:
#
#   crm-web-sa:          No GCP permissions needed (serves static files)
#   crm-api-sa:          Secret Manager read + Cloud SQL client
#   crm-gmail-sa:        Secret Manager read + Cloud SQL client + Pub/Sub subscriber
#   crm-analysis-sa:     Secret Manager read + Cloud SQL client
#   crm-notifications-sa: Secret Manager read + Cloud SQL client
#   crm-pubsub-invoker-sa: Cloud Run Invoker on crm-gmail only (used by Pub/Sub)
#   crm-cicd-sa:         Artifact Registry writer + Cloud Run deployer (GitHub Actions)
#
# USAGE: bash infra/06-service-accounts.sh
# =============================================================================
set -euo pipefail
source "$(dirname "$0")/00-variables.env"

log()    { echo "[$(date +'%H:%M:%S')] $*"; }
success(){ echo "[$(date +'%H:%M:%S')]   ✓ $*"; }

# ─── Helper: create service account if it doesn't exist ──────────────────────
create_sa() {
  local name="$1"
  local display="$2"
  local description="$3"

  EXISTING=$(gcloud iam service-accounts describe "${name}@${PROJECT_ID}.iam.gserviceaccount.com" \
    --project="${PROJECT_ID}" \
    --format="value(email)" 2>/dev/null || echo "")

  if [[ -n "${EXISTING}" ]]; then
    success "Service account '${name}' already exists"
  else
    log "  → Creating service account '${name}'"
    gcloud iam service-accounts create "${name}" \
      --project="${PROJECT_ID}" \
      --display-name="${display}" \
      --description="${description}"
    success "Service account '${name}' created"
  fi
}

# ─── Helper: bind IAM role to service account (idempotent) ───────────────────
bind_role() {
  local sa_email="$1"
  local role="$2"
  local resource_type="${3:-project}"  # project, secret, service
  local resource_id="${4:-${PROJECT_ID}}"

  case "${resource_type}" in
    project)
      gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
        --member="serviceAccount:${sa_email}" \
        --role="${role}" \
        --condition=None \
        --quiet 2>/dev/null | grep -q "bindings:" || true
      ;;
    secret)
      gcloud secrets add-iam-policy-binding "${resource_id}" \
        --project="${PROJECT_ID}" \
        --member="serviceAccount:${sa_email}" \
        --role="${role}" \
        --quiet 2>/dev/null || true
      ;;
    cloudrun)
      gcloud run services add-iam-policy-binding "${resource_id}" \
        --project="${PROJECT_ID}" \
        --region="${REGION}" \
        --member="serviceAccount:${sa_email}" \
        --role="${role}" \
        --quiet 2>/dev/null || true
      ;;
  esac
  success "Bound ${role} to ${sa_email} on ${resource_type}:${resource_id}"
}

# ─── Helper: grant secret access to a service account ─────────────────────────
grant_secret_access() {
  local sa_email="$1"
  shift
  local secrets=("$@")
  for secret in "${secrets[@]}"; do
    bind_role "${sa_email}" "roles/secretmanager.secretAccessor" "secret" "${secret}"
  done
}

# ==============================================================================
log ""
log "=== Creating Service Accounts ==="
# ==============================================================================

create_sa "${SA_WEB}" \
  "CRM Web Service Account" \
  "Service account for crm-web Cloud Run service (nginx/SPA — no GCP permissions needed)"

create_sa "${SA_API}" \
  "CRM API Service Account" \
  "Service account for crm-api Cloud Run service (main REST API)"

create_sa "${SA_GMAIL}" \
  "CRM Gmail Service Account" \
  "Service account for crm-gmail Cloud Run service (Gmail sync + Pub/Sub webhooks)"

create_sa "${SA_ANALYSIS}" \
  "CRM Analysis Service Account" \
  "Service account for crm-analysis Cloud Run service (AI/LLM email analysis)"

create_sa "${SA_NOTIFICATIONS}" \
  "CRM Notifications Service Account" \
  "Service account for crm-notifications Cloud Run service (email notifications)"

create_sa "${SA_PUBSUB_INVOKER}" \
  "CRM PubSub Invoker" \
  "Used by Google Pub/Sub to authenticate push requests to crm-gmail Cloud Run service"

create_sa "${SA_CICD}" \
  "CRM CI/CD Service Account" \
  "Used by GitHub Actions (via Workload Identity) to push images and deploy to Cloud Run"

# ==============================================================================
log ""
log "=== Granting IAM Roles ==="
# ==============================================================================

# ── crm-web-sa: No GCP permissions needed ─────────────────────────────────────
# The web service is a static nginx container. It does not call GCP APIs.
log ""
log "--- crm-web-sa (no permissions needed) ---"
success "No GCP IAM bindings required for crm-web-sa"

# ── crm-api-sa ────────────────────────────────────────────────────────────────
# The API needs to:
#   • Read all application secrets from Secret Manager
#   • Connect to Cloud SQL as a client
#   • Access Cloud Logging (included in default SA permissions for Cloud Run)
log ""
log "--- crm-api-sa ---"
bind_role "${SA_API_EMAIL}" "roles/cloudsql.client" "project"
# roles/cloudsql.client allows connecting to Cloud SQL instances in the project.
# With private IP, the network path is via VPC, but IAM still controls access.

grant_secret_access "${SA_API_EMAIL}" \
  "${SECRET_DB_URL}" \
  "${SECRET_BETTER_AUTH_SECRET}" \
  "${SECRET_GOOGLE_CLIENT_ID}" \
  "${SECRET_GOOGLE_CLIENT_SECRET}" \
  "${SECRET_INTERNAL_API_KEY}" \
  "${SECRET_ENCRYPTION_SECRET}"

# ── crm-gmail-sa ──────────────────────────────────────────────────────────────
# The Gmail service needs to:
#   • Read application secrets
#   • Connect to Cloud SQL
#   • Subscribe to Pub/Sub messages
#   • Call Gmail API (on behalf of users, using stored OAuth tokens)
log ""
log "--- crm-gmail-sa ---"
bind_role "${SA_GMAIL_EMAIL}" "roles/cloudsql.client" "project"
bind_role "${SA_GMAIL_EMAIL}" "roles/pubsub.subscriber" "project"
# roles/pubsub.subscriber: Can consume messages from Pub/Sub subscriptions.
# Note: Pub/Sub push does not require this — it pushes to an HTTP endpoint.
# This is for future pull-mode subscription support.

grant_secret_access "${SA_GMAIL_EMAIL}" \
  "${SECRET_DB_URL}" \
  "${SECRET_INTERNAL_API_KEY}" \
  "${SECRET_ENCRYPTION_SECRET}" \
  "${SECRET_PUBSUB_TOKEN}" \
  "${SECRET_GOOGLE_CLIENT_ID}" \
  "${SECRET_GOOGLE_CLIENT_SECRET}"

# ── crm-analysis-sa ───────────────────────────────────────────────────────────
# The analysis service needs to:
#   • Read application secrets (including API keys for LLM providers)
#   • Connect to Cloud SQL
#   • Egress to the internet (LLM providers: OpenAI, Anthropic, Google AI, xAI)
#     (handled by Cloud NAT — no additional IAM needed)
log ""
log "--- crm-analysis-sa ---"
bind_role "${SA_ANALYSIS_EMAIL}" "roles/cloudsql.client" "project"

grant_secret_access "${SA_ANALYSIS_EMAIL}" \
  "${SECRET_DB_URL}" \
  "${SECRET_INTERNAL_API_KEY}" \
  "${SECRET_ENCRYPTION_SECRET}"

# ── crm-notifications-sa ──────────────────────────────────────────────────────
# The notifications service needs to:
#   • Read application secrets (including Inngest keys)
#   • Connect to Cloud SQL
#   • Egress to the internet (Amazon SES, Inngest cloud)
log ""
log "--- crm-notifications-sa ---"
bind_role "${SA_NOTIFICATIONS_EMAIL}" "roles/cloudsql.client" "project"

grant_secret_access "${SA_NOTIFICATIONS_EMAIL}" \
  "${SECRET_DB_URL}" \
  "${SECRET_INTERNAL_API_KEY}" \
  "${SECRET_INNGEST_EVENT_KEY}" \
  "${SECRET_INNGEST_SIGNING_KEY}"

# ── crm-pubsub-invoker-sa ─────────────────────────────────────────────────────
# This SA is attached to the Pub/Sub push subscription.  When Pub/Sub pushes a
# message, it generates an OIDC token signed by this SA.  Cloud Run verifies
# the token and allows the request only if the SA has run.invoker on the service.
#
# We bind the role to crm-gmail AFTER the service is deployed (in 07-cloud-run.sh),
# because the service must exist before we can grant roles on it.
# But we grant the token creator permission here so Pub/Sub can generate tokens.
log ""
log "--- crm-pubsub-invoker-sa ---"
bind_role "${SA_PUBSUB_INVOKER_EMAIL}" "roles/iam.serviceAccountTokenCreator" "project"
# NOTE: roles/run.invoker on crm-gmail is granted in 07-cloud-run.sh after deployment.

# ── crm-cicd-sa ───────────────────────────────────────────────────────────────
# GitHub Actions uses Workload Identity Federation to impersonate this SA.
# It needs to:
#   • Push Docker images to Artifact Registry
#   • Deploy new Cloud Run revisions (does NOT need to delete/modify service configs)
#   • Read current Cloud Run service URLs (for deployment summaries)
log ""
log "--- crm-cicd-sa ---"
bind_role "${SA_CICD_EMAIL}" "roles/artifactregistry.writer" "project"
# roles/artifactregistry.writer: Can push images to Artifact Registry.

bind_role "${SA_CICD_EMAIL}" "roles/run.developer" "project"
# roles/run.developer: Can deploy new Cloud Run revisions and list services.
# Does NOT allow changing IAM policies, ingress settings, or VPC config
# (those are done by this infra script, not CI/CD).

bind_role "${SA_CICD_EMAIL}" "roles/iam.serviceAccountUser" "project"
# roles/iam.serviceAccountUser: Required to deploy Cloud Run services that
# run as a specific service account (SA impersonation during deploy).

# ── Allow Pub/Sub to impersonate the pubsub invoker SA ───────────────────────
# Google Cloud Pub/Sub generates OIDC tokens using the specified SA.
# The Pub/Sub service agent needs permission to create tokens as the invoker SA.
log ""
log "--- Pub/Sub service agent token creation ---"
PUBSUB_SA="service-$(gcloud projects describe "${PROJECT_ID}" --format='value(projectNumber)')@gcp-sa-pubsub.iam.gserviceaccount.com"
log "  Pub/Sub service agent: ${PUBSUB_SA}"

gcloud iam service-accounts add-iam-policy-binding \
  "${SA_PUBSUB_INVOKER_EMAIL}" \
  --project="${PROJECT_ID}" \
  --member="serviceAccount:${PUBSUB_SA}" \
  --role="roles/iam.serviceAccountTokenCreator" \
  --quiet 2>/dev/null || true
success "Pub/Sub service agent can create tokens as ${SA_PUBSUB_INVOKER}"

# ── Allow Gmail API to publish to Pub/Sub ─────────────────────────────────────
# Google's Gmail API publishes push notifications using a special Google-managed
# service account.  It must be allowed to publish to our topic.
# (Also handled in 09-pubsub.sh but granting here for reference)
log ""
log "--- Gmail API Pub/Sub publisher permission ---"
log "  Note: This is configured on the Pub/Sub topic in 09-pubsub.sh"

# ==============================================================================
log ""
log "=== Service Account IAM Setup Complete ==="
log ""
log "Service Accounts:"
for sa_name in "${SA_WEB}" "${SA_API}" "${SA_GMAIL}" "${SA_ANALYSIS}" "${SA_NOTIFICATIONS}" "${SA_PUBSUB_INVOKER}" "${SA_CICD}"; do
  log "  • ${sa_name}@${PROJECT_ID}.iam.gserviceaccount.com"
done
log ""
log "REMINDER: crm-pubsub-invoker-sa will get roles/run.invoker on crm-gmail"
log "  in the next step (07-cloud-run.sh) after the service is deployed."
log ""
log "Next step: bash infra/07-cloud-run.sh"
