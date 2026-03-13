#!/usr/bin/env bash
# =============================================================================
# 05-secret-manager.sh — Create all Secret Manager secrets
#
# WHY Secret Manager?
# -------------------
# Storing secrets (DB passwords, API keys, OAuth credentials) as plain-text
# environment variables in Cloud Run is a security risk:
#   • They appear in GCP Console and gcloud output for anyone with access
#   • They can be accidentally logged by application code
#   • Rotation requires a new deployment
#
# Secret Manager solves all of this:
#   • Secrets are encrypted at rest (AES-256) and in transit
#   • Access is controlled via IAM — only specific service accounts can read
#   • Cloud Run can mount secrets as env vars with --set-secrets (they are
#     never stored in the Cloud Run service definition in plain text)
#   • Rotation creates a new version; you can pin services to :latest or a
#     specific version for controlled rollouts
#   • Full audit trail (every secret access is logged in Cloud Audit Logs)
#
# This script creates secret resources and sets their initial values.
# Auto-generated values are used where possible. Secrets that require
# external credentials (Inngest, Langfuse, HuggingFace) use placeholders
# that must be updated before deployment.
#
# USAGE: bash infra/05-secret-manager.sh
# =============================================================================
set -euo pipefail
source "$(dirname "$0")/00-variables.env"

log()    { echo "[$(date +'%H:%M:%S')] $*"; }
success(){ echo "[$(date +'%H:%M:%S')]   ✓ $*"; }

# Helper: create or update a secret
upsert_secret() {
  local name="$1"
  local value="$2"

  EXISTING=$(gcloud secrets describe "${name}" \
    --project="${PROJECT_ID}" \
    --format="value(name)" 2>/dev/null || echo "")

  if [[ -n "${EXISTING}" ]]; then
    log "  → Secret '${name}' already exists — adding new version"
    echo -n "${value}" | gcloud secrets versions add "${name}" \
      --project="${PROJECT_ID}" \
      --data-file=-
    success "Secret '${name}' updated"
  else
    log "  → Creating secret '${name}'"
    gcloud secrets create "${name}" \
      --project="${PROJECT_ID}" \
      --replication-policy=user-managed \
      --locations="${REGION}" \
      --labels="env=production,team=crm"
    echo -n "${value}" | gcloud secrets versions add "${name}" \
      --project="${PROJECT_ID}" \
      --data-file=-
    success "Secret '${name}' created"
  fi
}

log "=========================================================="
log " Secret Manager Setup"
log " Project: ${PROJECT_ID}"
log "=========================================================="
log ""

# ─── 1. Database URL ──────────────────────────────────────────────────────────
log "=== 1. Database URL ==="

PRIVATE_IP=$(gcloud sql instances describe "${SQL_INSTANCE_NAME}" \
  --project="${PROJECT_ID}" \
  --format="json" 2>/dev/null | \
  python3 -c "
import json,sys
data=json.load(sys.stdin)
for ip in data.get('ipAddresses',[]):
    if ip.get('type') == 'PRIVATE':
        print(ip['ipAddress'])
        break
" 2>/dev/null || echo "")

if [[ -z "${PRIVATE_IP}" ]]; then
  log "  ⚠ Could not determine Cloud SQL private IP!"
  log "    Using placeholder — update before deploying."
  PRIVATE_IP="PRIVATE_IP_PLACEHOLDER"
fi

DB_URL="postgresql://${DB_USER}:${DB_PASSWORD}@${PRIVATE_IP}:5432/${DB_NAME}?sslmode=require"
log "  Database URL: postgresql://${DB_USER}:****@${PRIVATE_IP}:5432/${DB_NAME}?sslmode=require"
upsert_secret "${SECRET_DB_URL}" "${DB_URL}"

# ─── 2. Better-Auth Secret ──────────────────────────────────────────────────
log ""
log "=== 2. Better-Auth Secret ==="
log "  Auto-generating a secure random value (64 chars)..."

AUTH_SECRET=$(openssl rand -base64 48 | tr -d '\n')
upsert_secret "${SECRET_BETTER_AUTH_SECRET}" "${AUTH_SECRET}"

# ─── 3. Google OAuth Credentials ───────────────────────────────────────────
log ""
log "=== 3. Google OAuth Credentials ==="

# Check if secrets already exist (user may have created them manually)
EXISTING_CLIENT_ID=$(gcloud secrets describe "${SECRET_GOOGLE_CLIENT_ID}" \
  --project="${PROJECT_ID}" \
  --format="value(name)" 2>/dev/null || echo "")

if [[ -n "${EXISTING_CLIENT_ID}" ]]; then
  success "Secret '${SECRET_GOOGLE_CLIENT_ID}' already exists — skipping"
else
  log "  ⚠ '${SECRET_GOOGLE_CLIENT_ID}' not found. Creating with placeholder."
  log "    Update later: gcloud secrets versions add ${SECRET_GOOGLE_CLIENT_ID} --data-file=- --project=${PROJECT_ID}"
  upsert_secret "${SECRET_GOOGLE_CLIENT_ID}" "PLACEHOLDER_UPDATE_ME"
fi

EXISTING_CLIENT_SECRET=$(gcloud secrets describe "${SECRET_GOOGLE_CLIENT_SECRET}" \
  --project="${PROJECT_ID}" \
  --format="value(name)" 2>/dev/null || echo "")

if [[ -n "${EXISTING_CLIENT_SECRET}" ]]; then
  success "Secret '${SECRET_GOOGLE_CLIENT_SECRET}' already exists — skipping"
else
  log "  ⚠ '${SECRET_GOOGLE_CLIENT_SECRET}' not found. Creating with placeholder."
  upsert_secret "${SECRET_GOOGLE_CLIENT_SECRET}" "PLACEHOLDER_UPDATE_ME"
fi

# ─── 4. Internal API Key ──────────────────────────────────────────────────
log ""
log "=== 4. Internal API Key ==="
log "  Auto-generating shared secret for service-to-service auth..."

INTERNAL_KEY=$(openssl rand -base64 48 | tr -d '\n')
upsert_secret "${SECRET_INTERNAL_API_KEY}" "${INTERNAL_KEY}"

# ─── 5. Encryption Secret ──────────────────────────────────────────────────
log ""
log "=== 5. AES-256 Encryption Secret ==="
log "  Auto-generating 32-byte key..."

ENC_SECRET=$(openssl rand -base64 32 | tr -d '\n' | head -c 32)
upsert_secret "${SECRET_ENCRYPTION_SECRET}" "${ENC_SECRET}"

# ─── 6. Pub/Sub Verification Token ─────────────────────────────────────────
log ""
log "=== 6. Pub/Sub Verification Token ==="
log "  Auto-generating token for Gmail webhook verification..."

PUBSUB_TOKEN=$(openssl rand -hex 32)
upsert_secret "${SECRET_PUBSUB_TOKEN}" "${PUBSUB_TOKEN}"

# ─── 7. Inngest Keys ──────────────────────────────────────────────────────
log ""
log "=== 7. Inngest Keys ==="
INNGEST_EVENT_KEY_VAL="${INNGEST_EVENT_KEY:-PLACEHOLDER_UPDATE_FROM_INNGEST_DASHBOARD}"
upsert_secret "${SECRET_INNGEST_EVENT_KEY}" "${INNGEST_EVENT_KEY_VAL}"
INNGEST_SIGNING_KEY_VAL="${INNGEST_SIGNING_KEY:-PLACEHOLDER_UPDATE_FROM_INNGEST_DASHBOARD}"
upsert_secret "${SECRET_INNGEST_SIGNING_KEY}" "${INNGEST_SIGNING_KEY_VAL}"

# ─── 8. HuggingFace Token ──────────────────────────────────────────────────
log ""
log "=== 9. HuggingFace Token (email classification — optional) ==="
HUGGINGFACE_TOKEN_VAL="${HUGGINGFACE_API_TOKEN:-disabled}"
upsert_secret "${SECRET_HUGGINGFACE_TOKEN}" "${HUGGINGFACE_TOKEN_VAL}"

# ─── Summary ──────────────────────────────────────────────────────────────
log ""
log "=========================================================="
log " Secret Manager Setup Complete"
log "=========================================================="
log ""
log "Secrets in project '${PROJECT_ID}':"
for secret in \
  "${SECRET_DB_URL}" \
  "${SECRET_BETTER_AUTH_SECRET}" \
  "${SECRET_GOOGLE_CLIENT_ID}" \
  "${SECRET_GOOGLE_CLIENT_SECRET}" \
  "${SECRET_INTERNAL_API_KEY}" \
  "${SECRET_ENCRYPTION_SECRET}" \
  "${SECRET_PUBSUB_TOKEN}" \
  "${SECRET_INNGEST_EVENT_KEY}" \
  "${SECRET_INNGEST_SIGNING_KEY}" \
  "${SECRET_HUGGINGFACE_TOKEN}"; do
  log "  • ${secret}"
done
log ""
log "IMPORTANT: Service accounts need secretmanager.versions.access IAM"
log "  permission to read these secrets. This is configured in 06-service-accounts.sh"
log ""
log "To view a secret value:"
log "  gcloud secrets versions access latest --secret=SECRET_NAME --project=${PROJECT_ID}"
log ""
log "Next step: bash infra/06-service-accounts.sh"
