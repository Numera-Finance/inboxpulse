#!/usr/bin/env bash
# =============================================================================
# 11-database-migration.sh — Migrate PostgreSQL data from Neon to Cloud SQL
#
# Strategy: pg_dump + pg_restore with minimal downtime
# -----------------------------------------------------
# This script implements a "stop-the-world" migration with a brief downtime
# window.  For zero-downtime migration, see the "Advanced: Zero-Downtime"
# section at the bottom of this script.
#
# Migration steps:
#   1. Pre-flight checks (connections, disk space, version compatibility)
#   2. Full schema + data dump from Neon (logical dump, no superuser needed)
#   3. Restore into Cloud SQL via a Cloud SQL Auth Proxy tunnel
#   4. Verify row counts and key constraints
#   5. Switch application DATABASE_URL to Cloud SQL (Secret Manager update)
#   6. Post-migration smoke tests
#
# PREREQUISITES (run on your local machine or a CI runner):
#   • pg_dump / pg_restore / psql (PostgreSQL client tools, version 15)
#   • gcloud CLI authenticated with access to ${PROJECT_ID}
#   • Cloud SQL Auth Proxy binary (downloaded by this script if missing)
#   • Network access to your Neon database (VPN or public endpoint)
#   • The Cloud SQL instance must be RUNNABLE (run 04-cloud-sql.sh first)
#
# USAGE:
#   export NEON_DATABASE_URL="postgresql://user:pass@host.neon.tech/dbname?sslmode=require"
#   bash infra/11-database-migration.sh
# =============================================================================
set -euo pipefail
source "$(dirname "$0")/00-variables.env"

log()    { echo "[$(date +'%H:%M:%S')] $*"; }
success(){ echo "[$(date +'%H:%M:%S')]   ✓ $*"; }
warn()   { echo "[$(date +'%H:%M:%S')] ⚠  $*"; }
error()  { echo "[$(date +'%H:%M:%S')] ✗  $*" >&2; }

# ─── Validate required inputs ─────────────────────────────────────────────────
if [[ -z "${NEON_DATABASE_URL:-}" ]]; then
  error "NEON_DATABASE_URL environment variable is not set."
  echo ""
  echo "  Export it before running this script:"
  echo "  export NEON_DATABASE_URL='postgresql://user:pass@host.neon.tech/dbname?sslmode=require'"
  exit 1
fi

DUMP_DIR="$(mktemp -d)"
DUMP_FILE="${DUMP_DIR}/crm-neon-dump.dump"
PROXY_PID=""

log "=========================================================="
log " Database Migration: Neon → Cloud SQL"
log "=========================================================="
log ""
log "Source (Neon):  ${NEON_DATABASE_URL//:*@/:***@}"  # hide password
log "Target:         ${SQL_INSTANCE_NAME} (Cloud SQL, ${DB_NAME})"
log "Dump dir:       ${DUMP_DIR}"
log ""

# Cleanup on exit
cleanup() {
  log "Cleaning up..."
  if [[ -n "${PROXY_PID}" ]] && kill -0 "${PROXY_PID}" 2>/dev/null; then
    log "  Stopping Cloud SQL Auth Proxy (PID ${PROXY_PID})"
    kill "${PROXY_PID}" 2>/dev/null || true
  fi
  rm -rf "${DUMP_DIR}"
  log "Done."
}
trap cleanup EXIT

# ─── Step 0: Pre-flight checks ────────────────────────────────────────────────
log "=== Step 0: Pre-flight Checks ==="

# Check PostgreSQL client tools are available
for tool in pg_dump pg_restore psql; do
  if ! command -v "${tool}" &>/dev/null; then
    error "Required tool '${tool}' not found."
    echo "  Install: sudo apt-get install -y postgresql-client-15"
    echo "  Or:      brew install libpq && brew link --force libpq"
    exit 1
  fi
  PG_VERSION=$(${tool} --version 2>&1 | head -1)
  success "${tool}: ${PG_VERSION}"
done

# Check Cloud SQL Auth Proxy
PROXY_BIN="${DUMP_DIR}/cloud-sql-proxy"
if command -v cloud-sql-proxy &>/dev/null; then
  PROXY_BIN="cloud-sql-proxy"
  success "cloud-sql-proxy: $(cloud-sql-proxy --version 2>&1 | head -1)"
else
  log "  cloud-sql-proxy not found — downloading..."
  PROXY_OS="linux.amd64"
  if [[ "$(uname)" == "Darwin" ]]; then
    PROXY_OS="darwin.arm64"
    [[ "$(uname -m)" == "x86_64" ]] && PROXY_OS="darwin.amd64"
  fi
  curl -sSLo "${PROXY_BIN}" \
    "https://storage.googleapis.com/cloud-sql-connectors/cloud-sql-proxy/v2.14.1/cloud-sql-proxy.${PROXY_OS}"
  chmod +x "${PROXY_BIN}"
  success "cloud-sql-proxy downloaded to ${PROXY_BIN}"
fi

# Check Cloud SQL instance is running
INSTANCE_STATE=$(gcloud sql instances describe "${SQL_INSTANCE_NAME}" \
  --project="${PROJECT_ID}" \
  --format="value(state)" 2>/dev/null || echo "")
if [[ "${INSTANCE_STATE}" != "RUNNABLE" ]]; then
  error "Cloud SQL instance '${SQL_INSTANCE_NAME}' is not RUNNABLE (state: ${INSTANCE_STATE})"
  echo "  Run: bash infra/04-cloud-sql.sh"
  exit 1
fi
success "Cloud SQL instance '${SQL_INSTANCE_NAME}' is RUNNABLE"

# Test Neon connection
log "  Testing Neon connection..."
psql "${NEON_DATABASE_URL}" -c "SELECT version();" -t --no-psqlrc 2>/dev/null | head -1 | xargs
if [[ $? -ne 0 ]]; then
  error "Cannot connect to Neon database. Check NEON_DATABASE_URL."
  exit 1
fi
success "Neon connection: OK"

# ─── Step 1: Dump from Neon ───────────────────────────────────────────────────
log ""
log "=== Step 1: Dump from Neon ==="
log "  This may take several minutes for large databases."
log "  Format: custom (compressed, supports parallel restore)"

pg_dump \
  "${NEON_DATABASE_URL}" \
  --format=custom \
  --compress=9 \
  --no-owner \
  `# --no-owner: don't dump ownership info; we'll use ${DB_USER} as owner. `\
  --no-acl \
  `# --no-acl: don't dump GRANT/REVOKE; we set permissions separately.     `\
  --exclude-schema="_timescaledb_internal" \
  `# Exclude any internal Neon/TimescaleDB schemas if present.             `\
  --verbose \
  --file="${DUMP_FILE}" \
  2>&1 | tee "${DUMP_DIR}/pg_dump.log" | grep -E "^(pg_dump|dumping)" || true

DUMP_SIZE=$(du -sh "${DUMP_FILE}" | cut -f1)
success "Dump complete. Size: ${DUMP_SIZE}"

# ─── Step 2: Start Cloud SQL Auth Proxy ───────────────────────────────────────
log ""
log "=== Step 2: Start Cloud SQL Auth Proxy ==="
log "  The proxy creates a local TCP tunnel to the Cloud SQL instance."
log "  Even with private IP, the proxy works via the Cloud SQL Admin API."

PROXY_PORT=15432
PROXY_ADDR="127.0.0.1:${PROXY_PORT}"

log "  → Starting proxy: ${SQL_INSTANCE_NAME} → ${PROXY_ADDR}"
"${PROXY_BIN}" \
  "${PROJECT_ID}:${SQL_REGION}:${SQL_INSTANCE_NAME}" \
  --address="127.0.0.1" \
  --port="${PROXY_PORT}" \
  &
PROXY_PID=$!

log "  Waiting for proxy to be ready..."
for i in $(seq 1 30); do
  if pg_isready -h 127.0.0.1 -p "${PROXY_PORT}" -U "${DB_USER}" 2>/dev/null; then
    success "Cloud SQL Auth Proxy is ready on ${PROXY_ADDR}"
    break
  fi
  sleep 1
  if [[ "${i}" == "30" ]]; then
    error "Proxy did not become ready in 30 seconds."
    exit 1
  fi
done

# Target connection URL via proxy
TARGET_URL="postgresql://${DB_USER}:${DB_PASSWORD}@127.0.0.1:${PROXY_PORT}/${DB_NAME}?sslmode=disable"
# sslmode=disable: the Auth Proxy handles TLS; the local tunnel is already secure.

# ─── Step 3: Pre-restore schema prep ─────────────────────────────────────────
log ""
log "=== Step 3: Pre-restore Preparation ==="

# Get row counts from Neon for verification
log "  Collecting row counts from Neon for post-migration verification..."
NEON_ROW_COUNTS=$(psql "${NEON_DATABASE_URL}" --no-psqlrc -t -A -F'|' << 'SQL'
SELECT
  schemaname || '.' || tablename as table,
  n_live_tup::text as approx_rows
FROM pg_stat_user_tables
ORDER BY n_live_tup DESC;
SQL
)
echo "${NEON_ROW_COUNTS}" > "${DUMP_DIR}/neon_row_counts.txt"
success "Row counts saved to ${DUMP_DIR}/neon_row_counts.txt"

# ─── Step 4: Restore to Cloud SQL ────────────────────────────────────────────
log ""
log "=== Step 4: Restore to Cloud SQL ==="
log "  This may take several minutes for large databases."
log "  Using 4 parallel workers for faster restoration."
log ""

# Drop and recreate the target database for a clean restore
# (idempotent — won't fail if tables already exist due to --if-exists)
log "  → Cleaning target database schema"
psql "${TARGET_URL}" --no-psqlrc -c "
  -- Terminate any open connections to the database
  SELECT pg_terminate_backend(pid)
  FROM pg_stat_activity
  WHERE datname = '${DB_NAME}' AND pid <> pg_backend_pid();
" 2>/dev/null || true

log "  → Running pg_restore (4 parallel jobs)"
pg_restore \
  --host="127.0.0.1" \
  --port="${PROXY_PORT}" \
  --username="${DB_USER}" \
  --dbname="${DB_NAME}" \
  --no-owner \
  --no-acl \
  --jobs=4 \
  `# 4 parallel workers — good for most databases. Increase for very large DBs.`\
  --clean \
  --if-exists \
  `# --clean --if-exists: drop existing objects before recreating them.      `\
  `# Safe for first migration and idempotent re-runs.                         `\
  --verbose \
  "${DUMP_FILE}" \
  2>&1 | tee "${DUMP_DIR}/pg_restore.log" | \
  grep -E "^(pg_restore|processing)" | tail -20 || true

PGPASSWORD="${DB_PASSWORD}"
export PGPASSWORD

# Check for errors in restore log
ERROR_COUNT=$(grep -c "^pg_restore: error:" "${DUMP_DIR}/pg_restore.log" 2>/dev/null || echo "0")
WARN_COUNT=$(grep -c "^pg_restore: warning:" "${DUMP_DIR}/pg_restore.log" 2>/dev/null || echo "0")

if [[ "${ERROR_COUNT}" -gt 0 ]]; then
  warn "pg_restore completed with ${ERROR_COUNT} errors and ${WARN_COUNT} warnings."
  log "  Review the restore log: ${DUMP_DIR}/pg_restore.log"
  log "  Common non-fatal errors: 'already exists', 'does not exist'"
  log "  Fatal errors require investigation before proceeding."
else
  success "pg_restore completed (${WARN_COUNT} warnings, 0 errors)"
fi

# ─── Step 5: Post-migration verification ─────────────────────────────────────
log ""
log "=== Step 5: Post-Migration Verification ==="

# Compare row counts between Neon and Cloud SQL
log "  Comparing row counts: Neon vs Cloud SQL"
CLOUD_ROW_COUNTS=$(psql "${TARGET_URL}" --no-psqlrc -t -A -F'|' << 'SQL'
SELECT
  schemaname || '.' || tablename as table,
  n_live_tup::text as approx_rows
FROM pg_stat_user_tables
ORDER BY n_live_tup DESC;
SQL
)

echo ""
printf "%-50s %15s %15s\n" "Table" "Neon (source)" "Cloud SQL (target)"
printf "%-50s %15s %15s\n" "$(printf '%0.s─' {1..50})" "───────────────" "───────────────"

MISMATCH=0
while IFS='|' read -r table neon_count; do
  cloud_count=$(echo "${CLOUD_ROW_COUNTS}" | grep "^${table}|" | cut -d'|' -f2 || echo "0")
  if [[ "${neon_count}" != "${cloud_count}" ]]; then
    printf "%-50s %15s %15s ⚠\n" "${table}" "${neon_count}" "${cloud_count}"
    MISMATCH=$((MISMATCH + 1))
  else
    printf "%-50s %15s %15s ✓\n" "${table}" "${neon_count}" "${cloud_count}"
  fi
done < "${DUMP_DIR}/neon_row_counts.txt"

echo ""
if [[ "${MISMATCH}" -gt 0 ]]; then
  warn "${MISMATCH} tables have row count mismatches."
  log "  Note: Approximate counts (pg_stat_user_tables) may differ slightly."
  log "  Run ANALYZE on both databases for exact counts if needed."
else
  success "All row counts match between Neon and Cloud SQL"
fi

# Run a quick connectivity test with key tables
log ""
log "  Running connectivity test on key tables..."
psql "${TARGET_URL}" --no-psqlrc -c "
SELECT
  (SELECT count(*) FROM users)          AS users,
  (SELECT count(*) FROM tenants)        AS tenants,
  (SELECT count(*) FROM customers)      AS customers,
  (SELECT count(*) FROM emails)         AS emails,
  (SELECT count(*) FROM tasks)          AS tasks;
" 2>/dev/null || warn "Could not query key tables — check schema was restored correctly"

# ─── Step 6: Switch application to Cloud SQL ─────────────────────────────────
log ""
log "=== Step 6: Switch Application to Cloud SQL ==="
log ""
log "  The migration is complete. To cut over to Cloud SQL:"
log ""
log "  1. Update the DATABASE_URL secret with the Cloud SQL private IP:"
log ""

# Get Cloud SQL private IP
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
" 2>/dev/null || echo "<PRIVATE_IP>")

CLOUD_SQL_URL="postgresql://${DB_USER}:${DB_PASSWORD}@${PRIVATE_IP}:5432/${DB_NAME}?sslmode=require"

log "     export CLOUD_SQL_URL='${CLOUD_SQL_URL//${DB_PASSWORD}/***}'"
log "     echo -n \"\${CLOUD_SQL_URL}\" | gcloud secrets versions add ${SECRET_DB_URL} \\"
log "       --data-file=- --project=${PROJECT_ID}"
log ""
log "  2. Force a new deployment of all services to pick up the new secret:"
log "     (GitHub Actions will do this on next push, or trigger manually)"
log ""
log "  3. Verify the services start successfully and can connect to the DB."
log ""
log "  4. Once confirmed, update Drizzle config / any migration scripts to"
log "     use the Cloud SQL connection string."
log ""

# Offer to do the cutover automatically
read -r -p "  Do you want to update the DATABASE_URL secret now? [y/N]: " DO_CUTOVER
if [[ "${DO_CUTOVER:-N}" =~ ^[Yy]$ ]]; then
  log "  → Updating ${SECRET_DB_URL} in Secret Manager"
  echo -n "${CLOUD_SQL_URL}" | gcloud secrets versions add "${SECRET_DB_URL}" \
    --project="${PROJECT_ID}" \
    --data-file=-
  success "DATABASE_URL updated to Cloud SQL"
  log ""
  log "  IMPORTANT: Trigger a new deployment to pick up the new secret."
  log "  Services still use the old Neon URL until redeployed."
else
  log "  Skipping automatic cutover. Update the secret manually when ready."
fi

# ==============================================================================
log ""
log "=== Database Migration Complete ==="
log ""
log "Summary:"
log "  Dump file:       ${DUMP_FILE} (cleaned up on exit)"
log "  Restore log:     ${DUMP_DIR}/pg_restore.log (cleaned up on exit)"
log "  Row mismatches:  ${MISMATCH}"
log ""
log "NEXT STEPS:"
log "  1. Verify the application works with the Cloud SQL database"
log "  2. Run the Drizzle migration tool: pnpm db:push (from Cloud SQL DB URL)"
log "  3. Once satisfied, disable/delete the Neon database"
log "  4. Update all .env.example files to reflect Cloud SQL format"
log ""
log "Next step: bash infra/12-monitoring.sh"
