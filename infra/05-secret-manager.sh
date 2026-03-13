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
# It is interactive — it will prompt for values that cannot be generated.
#
# USAGE: bash infra/05-secret-manager.sh
# =============================================================================
set -euo pipefail
source "$(dirname "$0")/00-variables.env"

log()    { echo "[$(date +'%H:%M:%S')] $*"; }
success(){ echo "[$(date +'%H:%M:%S')]   ✓ $*"; }
prompt() {
  # Usage: prompt "Description" "DEFAULT_VALUE" → echoes the input
  local desc="$1"
  local default="$2"
  local value
  if [[ -n "${default}" && "${default}" != "REQUIRED" ]]; then
    read -r -p "  ${desc} [${default}]: " value
    echo "${value:-${default}}"
  else
    while true; do
      read -r -p "  ${desc}: " value
      [[ -n "${value}" ]] && break
      echo "  ⚠ This value is required. Please enter a value." >&2
    done
    echo "${value}"
  fi
}

# Helper: create or update a secret
upsert_secret() {
  local name="$1"
  local value="$2"
  local description="$3"

  EXISTING=$(gcloud secrets describe "${name}" \
    --project="${PROJECT_ID}" \
    --format="value(name)" 2>/dev/null || echo "")

  if [[ -n "${EXISTING}" ]]; then
    log "  → Updating secret '${name}' (adding new version)"
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
      --labels="env=production,team=crm" 2>/dev/null || true
    # Set description separately (not all SDK versions support --description at create)
    gcloud secrets update "${name}" \
      --project="${PROJECT_ID}" \
      --set-labels="env=production,team=crm" 2>/dev/null || true
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
log "This script will prompt you for secret values."
log "Leave blank to keep the current value (if updating)."
log ""

# ─── 1. Database URL ──────────────────────────────────────────────────────────
log "=== 1. Database URL ==="
log "  Format: postgresql://USER:PASSWORD@PRIVATE_IP:5432/DB_NAME?sslmode=require"
log "  Get the private IP from: gcloud sql instances describe ${SQL_INSTANCE_NAME} --project=${PROJECT_ID}"

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

AUTO_DB_URL="postgresql://${DB_USER}:${DB_PASSWORD}@${PRIVATE_IP}:5432/${DB_NAME}?sslmode=require"
DB_URL=$(prompt "DATABASE_URL" "${AUTO_DB_URL}")
upsert_secret "${SECRET_DB_URL}" "${DB_URL}" "PostgreSQL connection URL for Cloud SQL instance"

# ─── 2. Better-Auth Secret ────────────────────────────────────────────────────
log ""
log "=== 2. Better-Auth Secret ==="
log "  This must be a random string ≥32 characters. Used to sign auth sessions."
log "  Auto-generating a secure value (press Enter to accept)..."

AUTO_AUTH_SECRET=$(openssl rand -base64 48 | tr -d '\n')
AUTH_SECRET=$(prompt "BETTER_AUTH_SECRET" "${AUTO_AUTH_SECRET}")
upsert_secret "${SECRET_BETTER_AUTH_SECRET}" "${AUTH_SECRET}" "Better-auth session signing secret (min 32 chars)"

# ─── 3. Google OAuth Credentials ─────────────────────────────────────────────
log ""
log "=== 3. Google OAuth Credentials ==="
log "  Get these from: https://console.cloud.google.com/apis/credentials"
log "  Create an OAuth 2.0 Client ID of type 'Web application'"

GOOGLE_CLIENT_ID_VAL=$(prompt "GOOGLE_CLIENT_ID (e.g. xxx.apps.googleusercontent.com)" "REQUIRED")
upsert_secret "${SECRET_GOOGLE_CLIENT_ID}" "${GOOGLE_CLIENT_ID_VAL}" "Google OAuth2 Client ID for better-auth SSO"

GOOGLE_CLIENT_SECRET_VAL=$(prompt "GOOGLE_CLIENT_SECRET" "REQUIRED")
upsert_secret "${SECRET_GOOGLE_CLIENT_SECRET}" "${GOOGLE_CLIENT_SECRET_VAL}" "Google OAuth2 Client Secret for better-auth SSO"

# ─── 4. Internal API Key ──────────────────────────────────────────────────────
log ""
log "=== 4. Internal API Key ==="
log "  Shared secret used for service-to-service authentication."
log "  Auto-generating (press Enter to accept)..."

AUTO_INTERNAL_KEY=$(openssl rand -base64 48 | tr -d '\n')
INTERNAL_KEY=$(prompt "INTERNAL_API_KEY" "${AUTO_INTERNAL_KEY}")
upsert_secret "${SECRET_INTERNAL_API_KEY}" "${INTERNAL_KEY}" "Shared secret for internal service-to-service auth (x-internal-api-key header)"

# ─── 5. Encryption Secret ─────────────────────────────────────────────────────
log ""
log "=== 5. AES-256 Encryption Secret ==="
log "  Used by the @crm/encryption package to encrypt sensitive data in the DB."
log "  Must be exactly 32 bytes. Auto-generating (press Enter to accept)..."

AUTO_ENC_SECRET=$(openssl rand -base64 32 | tr -d '\n' | head -c 32)
ENC_SECRET=$(prompt "ENCRYPTION_SECRET (exactly 32 chars)" "${AUTO_ENC_SECRET}")
upsert_secret "${SECRET_ENCRYPTION_SECRET}" "${ENC_SECRET}" "AES-256 encryption key for sensitive database fields"

# ─── 6. Pub/Sub Verification Token ───────────────────────────────────────────
log ""
log "=== 6. Pub/Sub Verification Token ==="
log "  Used by crm-gmail to verify that webhook pushes come from Pub/Sub."
log "  Auto-generating (press Enter to accept)..."

AUTO_PUBSUB_TOKEN=$(openssl rand -hex 32)
PUBSUB_TOKEN=$(prompt "PUBSUB_VERIFICATION_TOKEN" "${AUTO_PUBSUB_TOKEN}")
upsert_secret "${SECRET_PUBSUB_TOKEN}" "${PUBSUB_TOKEN}" "Token to verify Pub/Sub push requests in crm-gmail"

# ─── 7. Inngest Keys ──────────────────────────────────────────────────────────
log ""
log "=== 7. Inngest Keys ==="
log "  Get these from your Inngest dashboard: https://app.inngest.com"

INNGEST_EVENT_KEY_VAL=$(prompt "INNGEST_EVENT_KEY" "REQUIRED")
upsert_secret "${SECRET_INNGEST_EVENT_KEY}" "${INNGEST_EVENT_KEY_VAL}" "Inngest event key for publishing background job events"

INNGEST_SIGNING_KEY_VAL=$(prompt "INNGEST_SIGNING_KEY" "REQUIRED")
upsert_secret "${SECRET_INNGEST_SIGNING_KEY}" "${INNGEST_SIGNING_KEY_VAL}" "Inngest signing key for verifying callback HMAC signatures"

# ─── Summary ──────────────────────────────────────────────────────────────────
log ""
log "=========================================================="
log " Secret Manager Setup Complete"
log "=========================================================="
log ""
log "Secrets created in project '${PROJECT_ID}':"
for secret in \
  "${SECRET_DB_URL}" \
  "${SECRET_BETTER_AUTH_SECRET}" \
  "${SECRET_GOOGLE_CLIENT_ID}" \
  "${SECRET_GOOGLE_CLIENT_SECRET}" \
  "${SECRET_INTERNAL_API_KEY}" \
  "${SECRET_ENCRYPTION_SECRET}" \
  "${SECRET_PUBSUB_TOKEN}" \
  "${SECRET_INNGEST_EVENT_KEY}" \
  "${SECRET_INNGEST_SIGNING_KEY}"; do
  log "  • ${secret}"
done

log ""
log "IMPORTANT: Service accounts need secretmanager.versions.access IAM"
log "  permission to read these secrets.  This is configured in 06-service-accounts.sh"
log ""
log "To view a secret value (for debugging):"
log "  gcloud secrets versions access latest --secret=SECRET_NAME --project=${PROJECT_ID}"
log ""
log "Next step: bash infra/06-service-accounts.sh"
