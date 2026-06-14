#!/usr/bin/env bash
# =============================================================================
# 01-enable-apis.sh — Enable all required GCP APIs
#
# This must be run before any other script.  GCP APIs can take a minute or two
# to become fully active after being enabled, so the script waits briefly after
# enabling them.
#
# USAGE: bash infra/01-enable-apis.sh
# =============================================================================
set -euo pipefail
source "$(dirname "$0")/00-variables.env"

log() { echo "[$(date +'%H:%M:%S')] $*"; }

log "Enabling GCP APIs for project: ${PROJECT_ID}"
log "This may take a couple of minutes..."

# Array of all APIs required by the CRM platform
APIS=(
  # ── Core compute / serverless ──────────────────────────────────────────────
  "run.googleapis.com"               # Cloud Run — hosts all services

  # ── Container / artifact storage ──────────────────────────────────────────
  "artifactregistry.googleapis.com"  # Artifact Registry — Docker image storage
  "containerscanning.googleapis.com" # Container vulnerability scanning

  # ── Networking ─────────────────────────────────────────────────────────────
  "compute.googleapis.com"           # Compute Engine — needed for VPC, NAT, LB
  "servicenetworking.googleapis.com" # Service Networking — VPC peering for Cloud SQL
  "vpcaccess.googleapis.com"         # Serverless VPC Access (fallback if Direct VPC not available)

  # ── Database ───────────────────────────────────────────────────────────────
  "sqladmin.googleapis.com"          # Cloud SQL Admin — manage PostgreSQL instances

  # ── Security / secrets ─────────────────────────────────────────────────────
  "secretmanager.googleapis.com"     # Secret Manager — all secrets, API keys, credentials
  "iamcredentials.googleapis.com"    # IAM Credentials — service account token generation
  "sts.googleapis.com"               # Security Token Service — Workload Identity Federation

  # ── Messaging ──────────────────────────────────────────────────────────────
  "pubsub.googleapis.com"            # Pub/Sub — Gmail webhook delivery

  # ── Google Workspace APIs ──────────────────────────────────────────────────
  "gmail.googleapis.com"             # Gmail API — email sync
  "people.googleapis.com"            # People API — user profile data from Google SSO

  # ── Monitoring ────────────────────────────────────────────────────────────
  "monitoring.googleapis.com"        # Cloud Monitoring — uptime checks, alert policies

  # ── CI/CD ──────────────────────────────────────────────────────────────────
  "iam.googleapis.com"               # IAM — service accounts and policies
)

for api in "${APIS[@]}"; do
  # Check if the API is already enabled (avoid unnecessary re-enables)
  state=$(gcloud services list \
    --project="${PROJECT_ID}" \
    --filter="name:${api}" \
    --format="value(state)" 2>/dev/null || echo "")

  if [[ "${state}" == "ENABLED" ]]; then
    log "  ✓ Already enabled: ${api}"
  else
    log "  → Enabling: ${api}"
    gcloud services enable "${api}" --project="${PROJECT_ID}"
  fi
done

log ""
log "All APIs enabled. Waiting 30 seconds for propagation..."
sleep 30

log "Done. All required GCP APIs are active."
