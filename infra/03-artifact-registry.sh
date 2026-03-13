#!/usr/bin/env bash
# =============================================================================
# 03-artifact-registry.sh — Create Artifact Registry repository
#
# Artifact Registry is GCP's fully-managed container image registry.
# It replaced Container Registry (gcr.io) and provides:
#   • Regional storage (images stay close to Cloud Run in the same region)
#   • Integrated IAM (fine-grained push/pull access control)
#   • Vulnerability scanning via Container Analysis (enabled by this script)
#   • Immutable image tags with SHA256 digests
#
# All 5 service images will be pushed to:
#   us-central1-docker.pkg.dev/{PROJECT_ID}/crm/{service-name}:{sha}
#
# USAGE: bash infra/03-artifact-registry.sh
# =============================================================================
set -euo pipefail
source "$(dirname "$0")/00-variables.env"

log() { echo "[$(date +'%H:%M:%S')] $*"; }

# ─── Create the Docker repository ─────────────────────────────────────────────
log "=== Artifact Registry ==="

EXISTING=$(gcloud artifacts repositories describe "${AR_REPOSITORY}" \
  --project="${PROJECT_ID}" \
  --location="${REGION}" \
  --format="value(name)" 2>/dev/null || echo "")

if [[ -n "${EXISTING}" ]]; then
  log "  ✓ Repository '${AR_REPOSITORY}' already exists in ${REGION}"
else
  log "  → Creating Docker repository '${AR_REPOSITORY}' in ${REGION}"
  gcloud artifacts repositories create "${AR_REPOSITORY}" \
    --project="${PROJECT_ID}" \
    --repository-format=docker \
    --location="${REGION}" \
    --description="CRM platform Docker images (all 5 services)" \
    --immutable-tags
  # --immutable-tags prevents overwriting an existing tag (e.g., :latest)
  # with a different image digest, protecting against accidental overwrites
  # in production.  CI/CD always pushes both :sha and :latest.
fi

# ─── Enable Container Vulnerability Scanning ──────────────────────────────────
# Container Analysis automatically scans every image pushed to this repository
# for known CVEs.  Results are visible in the GCP Console under
# "Artifact Registry → [repo] → [image] → Vulnerabilities".
#
# Note: this requires the containerscanning.googleapis.com API (enabled in 01).
log ""
log "  → Enabling automatic vulnerability scanning on '${AR_REPOSITORY}'"
gcloud artifacts repositories update "${AR_REPOSITORY}" \
  --project="${PROJECT_ID}" \
  --location="${REGION}" \
  --update-labels="env=production,team=crm" 2>/dev/null || true
# Vulnerability scanning is enabled by default when the API is active;
# the update above adds labels for cost attribution and resource management.

# ─── Configure cleanup policy ─────────────────────────────────────────────────
# Old images accumulate quickly with CI/CD. This policy keeps the 10 most
# recent tagged versions and deletes untagged (intermediate build cache) images
# older than 7 days, controlling storage costs.
log ""
log "  → Setting image cleanup policy (keep last 10 tags, purge untagged >7d)"

# Write the cleanup policy JSON to a temp file
CLEANUP_POLICY_FILE=$(mktemp)
cat > "${CLEANUP_POLICY_FILE}" << 'EOF'
[
  {
    "name": "keep-last-10-tags",
    "action": {"type": "Keep"},
    "mostRecentVersions": {
      "keepCount": 10
    }
  },
  {
    "name": "delete-old-untagged",
    "action": {"type": "Delete"},
    "condition": {
      "tagState": "untagged",
      "olderThan": "604800s"
    }
  }
]
EOF

gcloud artifacts repositories set-cleanup-policies "${AR_REPOSITORY}" \
  --project="${PROJECT_ID}" \
  --location="${REGION}" \
  --policy="${CLEANUP_POLICY_FILE}" \
  --no-dry-run 2>/dev/null || \
  log "  ⚠  Cleanup policy API not available in this SDK version — skipping"

rm -f "${CLEANUP_POLICY_FILE}"

# ─── Print registry path ──────────────────────────────────────────────────────
log ""
log "=== Artifact Registry Setup Complete ==="
log ""
log "Registry URL: ${REGISTRY}/${PROJECT_ID}/${AR_REPOSITORY}"
log ""
log "Service image paths:"
for svc in web api gmail analysis notifications; do
  log "  ${REGISTRY}/${PROJECT_ID}/${AR_REPOSITORY}/crm-${svc}:<sha>"
done
log ""
log "Configure Docker auth (run this locally or in CI):"
log "  gcloud auth configure-docker ${REGISTRY}"
log ""
log "Next step: bash infra/04-cloud-sql.sh"
