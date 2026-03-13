#!/usr/bin/env bash
# =============================================================================
# 04-cloud-sql.sh — Create Cloud SQL PostgreSQL instance (private IP)
#
# This creates a PostgreSQL 17 instance with:
#   • Private IP only — no public endpoint exposed to the internet
#   • Single-zone (ZONAL) — no HA failover (cost-optimized for early stage)
#   • Automated daily backups with 7-day retention + point-in-time recovery
#   • SSL enforcement — all connections must use TLS
#   • Deletion protection — prevents accidental instance deletion
#
# The instance takes 5-15 minutes to provision.  The script polls until ready.
#
# IMPORTANT: Run 02-vpc-networking.sh FIRST — the Private Service Access peering
# must exist before Cloud SQL can be assigned a private IP.
#
# USAGE: bash infra/04-cloud-sql.sh
# =============================================================================
set -euo pipefail
source "$(dirname "$0")/00-variables.env"

log() { echo "[$(date +'%H:%M:%S')] $*"; }

# ─── 1. Create Cloud SQL Instance ─────────────────────────────────────────────
log "=== Step 1: Cloud SQL Instance ==="

INSTANCE_STATE=$(gcloud sql instances describe "${SQL_INSTANCE_NAME}" \
  --project="${PROJECT_ID}" \
  --format="value(state)" 2>/dev/null || echo "")

if [[ "${INSTANCE_STATE}" == "RUNNABLE" ]]; then
  log "  ✓ Instance '${SQL_INSTANCE_NAME}' already exists and is running"
elif [[ -n "${INSTANCE_STATE}" ]]; then
  log "  ✓ Instance '${SQL_INSTANCE_NAME}' exists (state: ${INSTANCE_STATE})"
else
  log "  → Creating Cloud SQL PostgreSQL 17 instance '${SQL_INSTANCE_NAME}'"
  log "    This takes 5-15 minutes. Please wait..."
  log ""
  log "    Configuration:"
  log "      Tier:       ${SQL_TIER} (shared-core, 614 MB RAM)"
  log "      Region:     ${SQL_REGION}"
  log "      HA:         disabled (single-zone, cost-optimized)"
  log "      Storage:    10 GB SSD, auto-grow enabled"
  log "      Backups:    daily, 7-day retention, PITR enabled"
  log "      Network:    private IP only (via ${VPC_NAME} PSA peering)"

  gcloud sql instances create "${SQL_INSTANCE_NAME}" \
    --project="${PROJECT_ID}" \
    --database-version=POSTGRES_17 \
    --edition=ENTERPRISE \
    --tier="${SQL_TIER}" \
    --region="${SQL_REGION}" \
    \
    `# ── Availability ──────────────────────────────────────────────────`\
    --availability-type=ZONAL \
    `# ZONAL = single zone, no HA failover. Upgrade to REGIONAL for HA. `\
    \
    `# ── Storage ────────────────────────────────────────────────────────`\
    --storage-type=SSD \
    --storage-size=10GB \
    --storage-auto-increase \
    `# Auto-increase prevents disk-full outages. Max auto-increase: 64TB. `\
    \
    `# ── Backups & PITR ─────────────────────────────────────────────────`\
    --backup \
    --backup-start-time=02:00 \
    `# Backups run at 2 AM UTC (low-traffic window). `\
    --retained-backups-count=7 \
    --enable-point-in-time-recovery \
    `# PITR allows restoring to any second within the retention window.  `\
    --retained-transaction-log-days=7 \
    \
    `# ── Networking — private IP only ───────────────────────────────────`\
    --network="${VPC_NAME}" \
    --no-assign-ip \
    `# --no-assign-ip prevents a public IP from being assigned.         `\
    `# All access is via the private IP allocated by PSA peering.       `\
    \
    `# ── SSL / security ─────────────────────────────────────────────────`\
    --ssl-mode=ENCRYPTED_ONLY \
    `# ENCRYPTED_ONLY rejects non-SSL connections.                      `\
    `# Use TRUSTED_CLIENT_CERTIFICATE_REQUIRED for mTLS (stricter).     `\
    \
    `# ── Maintenance ────────────────────────────────────────────────────`\
    --maintenance-window-day=SUN \
    --maintenance-window-hour=3 \
    `# Sunday 3 AM UTC — low-traffic maintenance window.               `\
    \
    `# ── Safety ─────────────────────────────────────────────────────────`\
    --deletion-protection \
    `# Prevents accidental deletion of the production database.        `\
    \
    --database-flags=\
"max_connections=50,\
log_min_duration_statement=1000,\
log_checkpoints=on,\
log_connections=on,\
log_disconnections=on,\
log_lock_waits=on,\
log_temp_files=0"
    # max_connections=50: f1-micro has limited memory; 50 is sufficient
    # for early stage with a few Cloud Run instances.
    # log_min_duration_statement=1000: log queries taking >1 second.
    # All log_* flags: enable comprehensive audit logging.

  log ""
  log "  Waiting for instance to become RUNNABLE..."
  while true; do
    STATE=$(gcloud sql instances describe "${SQL_INSTANCE_NAME}" \
      --project="${PROJECT_ID}" \
      --format="value(state)" 2>/dev/null || echo "UNKNOWN")
    if [[ "${STATE}" == "RUNNABLE" ]]; then
      log "  ✓ Instance is RUNNABLE"
      break
    fi
    log "    State: ${STATE} — waiting 30 seconds..."
    sleep 30
  done
fi

# ─── 2. Get the private IP ────────────────────────────────────────────────────
PRIVATE_IP=$(gcloud sql instances describe "${SQL_INSTANCE_NAME}" \
  --project="${PROJECT_ID}" \
  --format="value(ipAddresses[0].ipAddress)" 2>/dev/null || echo "")

# Filter to get only private IP (type PRIVATE)
PRIVATE_IP=$(gcloud sql instances describe "${SQL_INSTANCE_NAME}" \
  --project="${PROJECT_ID}" \
  --format="json" | \
  python3 -c "
import json,sys
data=json.load(sys.stdin)
for ip in data.get('ipAddresses',[]):
    if ip.get('type') == 'PRIVATE':
        print(ip['ipAddress'])
        break
" 2>/dev/null || echo "")

if [[ -z "${PRIVATE_IP}" ]]; then
  log "  ⚠ Could not determine private IP yet. It may still be provisioning."
  log "    Run: gcloud sql instances describe ${SQL_INSTANCE_NAME} --project=${PROJECT_ID}"
else
  log "  Private IP: ${PRIVATE_IP}"
fi

# ─── 3. Create the application database ──────────────────────────────────────
log ""
log "=== Step 2: Create Database '${DB_NAME}' ==="

EXISTING_DB=$(gcloud sql databases describe "${DB_NAME}" \
  --instance="${SQL_INSTANCE_NAME}" \
  --project="${PROJECT_ID}" \
  --format="value(name)" 2>/dev/null || echo "")

if [[ -n "${EXISTING_DB}" ]]; then
  log "  ✓ Database '${DB_NAME}' already exists"
else
  log "  → Creating database '${DB_NAME}'"
  gcloud sql databases create "${DB_NAME}" \
    --instance="${SQL_INSTANCE_NAME}" \
    --project="${PROJECT_ID}" \
    --charset=UTF8 \
    --collation=en_US.UTF8
fi

# ─── 4. Create the application user ──────────────────────────────────────────
# This is the user the application connects as.  We use a dedicated user with
# a strong password rather than the default 'postgres' superuser.
log ""
log "=== Step 3: Create Database User '${DB_USER}' ==="

EXISTING_USER=$(gcloud sql users list \
  --instance="${SQL_INSTANCE_NAME}" \
  --project="${PROJECT_ID}" \
  --filter="name=${DB_USER}" \
  --format="value(name)" 2>/dev/null || echo "")

if [[ -n "${EXISTING_USER}" ]]; then
  log "  ✓ User '${DB_USER}' already exists"
  log "  → Updating password (in case it changed in variables)"
  gcloud sql users set-password "${DB_USER}" \
    --instance="${SQL_INSTANCE_NAME}" \
    --project="${PROJECT_ID}" \
    --password="${DB_PASSWORD}"
else
  log "  → Creating user '${DB_USER}'"
  gcloud sql users create "${DB_USER}" \
    --instance="${SQL_INSTANCE_NAME}" \
    --project="${PROJECT_ID}" \
    --password="${DB_PASSWORD}"
fi

# ─── 5. Restrict postgres superuser remote login ──────────────────────────────
# Set a strong password on the default 'postgres' user to prevent unauthorized
# access if someone were to expose it accidentally.  The application uses
# '${DB_USER}' not 'postgres'.
log ""
log "=== Step 4: Secure postgres superuser ==="
log "  → Setting random password on 'postgres' user (disabling default access)"
POSTGRES_RANDOM_PWD=$(openssl rand -base64 32)
gcloud sql users set-password postgres \
  --instance="${SQL_INSTANCE_NAME}" \
  --project="${PROJECT_ID}" \
  --password="${POSTGRES_RANDOM_PWD}"
log "  ✓ postgres superuser password randomized"
log "    (Save this if needed: ${POSTGRES_RANDOM_PWD})"

# ─── Summary ──────────────────────────────────────────────────────────────────
log ""
log "=== Cloud SQL Setup Complete ==="
log ""
log "Instance:    ${SQL_INSTANCE_NAME}  (PostgreSQL 17, ${SQL_TIER})"
log "Database:    ${DB_NAME}"
log "User:        ${DB_USER}"
log "Private IP:  ${PRIVATE_IP:-<run describe to get IP>}"
log ""
log "DATABASE_URL (to store in Secret Manager):"
log "  postgresql://${DB_USER}:${DB_PASSWORD}@${PRIVATE_IP:-<PRIVATE_IP>}:5432/${DB_NAME}?sslmode=require"
log ""
log "IMPORTANT: The private IP above is only accessible from within ${VPC_NAME}."
log "  Cloud Run services must use VPC egress to reach this IP."
log ""
log "Next step: bash infra/05-secret-manager.sh"
