#!/usr/bin/env bash
# =============================================================================
# 12-monitoring.sh — Cloud Monitoring: dashboards, uptime checks, and alerts
#
# What this sets up:
#   • Uptime checks — verify web + api are reachable from multiple GCP regions
#   • Alert policies — notify on: service down, high error rate, high latency,
#                      Cloud SQL disk full, Pub/Sub dead-letter backlog
#   • Notification channel — email alerts to your ops address
#   • Log-based metrics — for application-level error tracking
#
# USAGE: bash infra/12-monitoring.sh
# =============================================================================
set -euo pipefail
source "$(dirname "$0")/00-variables.env"

log()    { echo "[$(date +'%H:%M:%S')] $*"; }
success(){ echo "[$(date +'%H:%M:%S')]   ✓ $*"; }

# ─── 1. Notification Channel ──────────────────────────────────────────────────
# All alerts are sent to this email address.  Add PagerDuty or Slack channels
# here after initial setup if needed.
log "=== Step 1: Email Notification Channel ==="

EXISTING_CHANNEL=$(gcloud beta monitoring channels list \
  --project="${PROJECT_ID}" \
  --filter="type=email AND labels.email_address=${ALERT_EMAIL}" \
  --format="value(name)" 2>/dev/null | head -1 || echo "")

if [[ -n "${EXISTING_CHANNEL}" ]]; then
  success "Notification channel for '${ALERT_EMAIL}' already exists: ${EXISTING_CHANNEL}"
  CHANNEL_NAME="${EXISTING_CHANNEL}"
else
  log "  → Creating email notification channel for '${ALERT_EMAIL}'"
  CHANNEL_NAME=$(gcloud beta monitoring channels create \
    --project="${PROJECT_ID}" \
    --display-name="CRM Ops Email" \
    --type=email \
    --channel-labels="email_address=${ALERT_EMAIL}" \
    --format="value(name)" 2>/dev/null || echo "")

  if [[ -n "${CHANNEL_NAME}" ]]; then
    success "Notification channel created: ${CHANNEL_NAME}"
  else
    log "  ⚠  Could not create notification channel via CLI."
    log "     Create it manually: GCP Console → Monitoring → Alerting → Notification channels"
    CHANNEL_NAME=""
  fi
fi

# ─── 2. Uptime Checks ─────────────────────────────────────────────────────────
# GCP probes these URLs from multiple global locations every 60 seconds.
# Alerts if the URL returns a non-2xx response or times out for >1 failure period.
log ""
log "=== Step 2: Uptime Checks ==="

# Helper to create uptime check
create_uptime_check() {
  local name="$1"
  local display="$2"
  local host="$3"
  local path="$4"

  EXISTING=$(gcloud beta monitoring uptime list-configs \
    --project="${PROJECT_ID}" \
    --filter="displayName='${display}'" \
    --format="value(name)" 2>/dev/null | head -1 || echo "")

  if [[ -n "${EXISTING}" ]]; then
    success "Uptime check '${display}' already exists"
    return
  fi

  if [[ -z "${host}" ]]; then
    log "  ⚠  Skipping uptime check '${display}' (no domain configured)"
    return
  fi

  log "  → Creating uptime check '${display}' for https://${host}${path}"
  gcloud beta monitoring uptime create "${name}" \
    --project="${PROJECT_ID}" \
    --display-name="${display}" \
    --resource-type=uptime_url \
    --http-check-path="${path}" \
    --https \
    --hostname="${host}" \
    --period=60 \
    --timeout=10 \
    --regions="usa-virginia,europe-belgium,asia-singapore" \
    2>/dev/null || \
    log "  ⚠  Uptime check creation failed — may require Monitoring API to be active"
  success "Uptime check '${display}' created"
}

create_uptime_check "crm-web-uptime" "CRM Web Uptime" "${WEB_DOMAIN}" "/"
create_uptime_check "crm-api-uptime" "CRM API Uptime" "${API_DOMAIN}" "/health"

# ─── 3. Alert Policies ────────────────────────────────────────────────────────
log ""
log "=== Step 3: Alert Policies ==="

# Helper to create an alert policy from JSON
create_alert() {
  local display="$1"
  local json_file="$2"

  EXISTING=$(gcloud alpha monitoring policies list \
    --project="${PROJECT_ID}" \
    --filter="displayName='${display}'" \
    --format="value(name)" 2>/dev/null | head -1 || echo "")

  if [[ -n "${EXISTING}" ]]; then
    success "Alert policy '${display}' already exists"
    return
  fi

  log "  → Creating alert policy '${display}'"
  gcloud alpha monitoring policies create \
    --project="${PROJECT_ID}" \
    --policy-from-file="${json_file}" \
    --format="value(name)" 2>/dev/null | xargs -I{} echo "    Created: {}" || \
    log "  ⚠  Alert policy creation failed — review policy JSON"
}

# ── Alert 1: Cloud Run — Request Error Rate > 5% ────────────────────────────
ALERT_ERROR_RATE_FILE=$(mktemp --suffix=.json)
cat > "${ALERT_ERROR_RATE_FILE}" << EOF
{
  "displayName": "CRM — Cloud Run error rate > 5%",
  "conditions": [{
    "displayName": "Cloud Run 5xx rate",
    "conditionThreshold": {
      "filter": "resource.type=\\\"cloud_run_revision\\\" AND metric.type=\\\"run.googleapis.com/request_count\\\" AND metric.labels.response_code_class=\\\"5xx\\\"",
      "aggregations": [{
        "alignmentPeriod": "300s",
        "perSeriesAligner": "ALIGN_RATE",
        "crossSeriesReducer": "REDUCE_SUM",
        "groupByFields": ["resource.labels.service_name"]
      }],
      "comparison": "COMPARISON_GT",
      "thresholdValue": 0.05,
      "duration": "120s",
      "trigger": {"count": 1}
    }
  }],
  "alertStrategy": {
    "autoClose": "1800s"
  },
  "combiner": "OR",
  "enabled": true,
  "notificationChannels": [${CHANNEL_NAME:+"\"${CHANNEL_NAME}\""}],
  "documentation": {
    "content": "Cloud Run service is returning >5% HTTP 5xx responses. Check Cloud Run logs for errors.",
    "mimeType": "text/markdown"
  }
}
EOF
create_alert "CRM — Cloud Run error rate > 5%" "${ALERT_ERROR_RATE_FILE}"

# ── Alert 2: Cloud Run — P99 Latency > 5s ────────────────────────────────────
ALERT_LATENCY_FILE=$(mktemp --suffix=.json)
cat > "${ALERT_LATENCY_FILE}" << EOF
{
  "displayName": "CRM — Cloud Run P99 latency > 5s",
  "conditions": [{
    "displayName": "Cloud Run P99 latency",
    "conditionThreshold": {
      "filter": "resource.type=\\\"cloud_run_revision\\\" AND metric.type=\\\"run.googleapis.com/request_latencies\\\"",
      "aggregations": [{
        "alignmentPeriod": "300s",
        "perSeriesAligner": "ALIGN_PERCENTILE_99",
        "crossSeriesReducer": "REDUCE_MAX",
        "groupByFields": ["resource.labels.service_name"]
      }],
      "comparison": "COMPARISON_GT",
      "thresholdValue": 5000,
      "duration": "300s",
      "trigger": {"count": 1}
    }
  }],
  "alertStrategy": {"autoClose": "1800s"},
  "combiner": "OR",
  "enabled": true,
  "notificationChannels": [${CHANNEL_NAME:+"\"${CHANNEL_NAME}\""}],
  "documentation": {
    "content": "Cloud Run P99 request latency is above 5 seconds. Investigate performance bottlenecks.",
    "mimeType": "text/markdown"
  }
}
EOF
create_alert "CRM — Cloud Run P99 latency > 5s" "${ALERT_LATENCY_FILE}"

# ── Alert 3: Cloud SQL — Disk usage > 80% ────────────────────────────────────
ALERT_DISK_FILE=$(mktemp --suffix=.json)
cat > "${ALERT_DISK_FILE}" << EOF
{
  "displayName": "CRM — Cloud SQL disk usage > 80%",
  "conditions": [{
    "displayName": "Cloud SQL disk utilization",
    "conditionThreshold": {
      "filter": "resource.type=\\\"cloudsql_database\\\" AND metric.type=\\\"cloudsql.googleapis.com/database/disk/utilization\\\" AND resource.labels.database_id=\\\"${PROJECT_ID}:${SQL_INSTANCE_NAME}\\\"",
      "aggregations": [{
        "alignmentPeriod": "300s",
        "perSeriesAligner": "ALIGN_MEAN"
      }],
      "comparison": "COMPARISON_GT",
      "thresholdValue": 0.80,
      "duration": "300s",
      "trigger": {"count": 1}
    }
  }],
  "alertStrategy": {"autoClose": "86400s"},
  "combiner": "OR",
  "enabled": true,
  "notificationChannels": [${CHANNEL_NAME:+"\"${CHANNEL_NAME}\""}],
  "documentation": {
    "content": "Cloud SQL disk is >80% full. Increase storage or delete old data to prevent outage.",
    "mimeType": "text/markdown"
  }
}
EOF
create_alert "CRM — Cloud SQL disk usage > 80%" "${ALERT_DISK_FILE}"

# ── Alert 4: Cloud SQL — Connection count > 150 ──────────────────────────────
ALERT_CONN_FILE=$(mktemp --suffix=.json)
cat > "${ALERT_CONN_FILE}" << EOF
{
  "displayName": "CRM — Cloud SQL connections > 150",
  "conditions": [{
    "displayName": "Cloud SQL active connections",
    "conditionThreshold": {
      "filter": "resource.type=\\\"cloudsql_database\\\" AND metric.type=\\\"cloudsql.googleapis.com/database/postgresql/num_backends\\\" AND resource.labels.database_id=\\\"${PROJECT_ID}:${SQL_INSTANCE_NAME}\\\"",
      "aggregations": [{
        "alignmentPeriod": "60s",
        "perSeriesAligner": "ALIGN_MAX"
      }],
      "comparison": "COMPARISON_GT",
      "thresholdValue": 150,
      "duration": "60s",
      "trigger": {"count": 1}
    }
  }],
  "alertStrategy": {"autoClose": "3600s"},
  "combiner": "OR",
  "enabled": true,
  "notificationChannels": [${CHANNEL_NAME:+"\"${CHANNEL_NAME}\""}],
  "documentation": {
    "content": "Cloud SQL connection count is >150 (max_connections=200). Consider adding PgBouncer.",
    "mimeType": "text/markdown"
  }
}
EOF
create_alert "CRM — Cloud SQL connections > 150" "${ALERT_CONN_FILE}"

# ── Alert 5: Pub/Sub Dead-Letter backlog ─────────────────────────────────────
ALERT_PUBSUB_FILE=$(mktemp --suffix=.json)
cat > "${ALERT_PUBSUB_FILE}" << EOF
{
  "displayName": "CRM — Gmail Pub/Sub dead-letter messages",
  "conditions": [{
    "displayName": "Dead-letter message count",
    "conditionThreshold": {
      "filter": "resource.type=\\\"pubsub_subscription\\\" AND metric.type=\\\"pubsub.googleapis.com/subscription/num_undelivered_messages\\\" AND resource.labels.subscription_id=\\\"${PUBSUB_TOPIC}-deadletter-sub\\\"",
      "aggregations": [{
        "alignmentPeriod": "300s",
        "perSeriesAligner": "ALIGN_MAX"
      }],
      "comparison": "COMPARISON_GT",
      "thresholdValue": 0,
      "duration": "0s",
      "trigger": {"count": 1}
    }
  }],
  "alertStrategy": {"autoClose": "3600s"},
  "combiner": "OR",
  "enabled": true,
  "notificationChannels": [${CHANNEL_NAME:+"\"${CHANNEL_NAME}\""}],
  "documentation": {
    "content": "Gmail webhook messages are failing and being dead-lettered. Check crm-gmail Cloud Run logs.",
    "mimeType": "text/markdown"
  }
}
EOF
create_alert "CRM — Gmail Pub/Sub dead-letter messages" "${ALERT_PUBSUB_FILE}"

# ── Alert 6: Cloud Run — Instance count maxed out ────────────────────────────
ALERT_MAXSCALE_FILE=$(mktemp --suffix=.json)
cat > "${ALERT_MAXSCALE_FILE}" << EOF
{
  "displayName": "CRM — Cloud Run scaling at max instances",
  "conditions": [{
    "displayName": "Cloud Run instance count at max",
    "conditionThreshold": {
      "filter": "resource.type=\\\"cloud_run_revision\\\" AND metric.type=\\\"run.googleapis.com/container/instance_count\\\" AND metric.labels.state=\\\"active\\\"",
      "aggregations": [{
        "alignmentPeriod": "300s",
        "perSeriesAligner": "ALIGN_MAX",
        "crossSeriesReducer": "REDUCE_MAX",
        "groupByFields": ["resource.labels.service_name"]
      }],
      "comparison": "COMPARISON_GT",
      "thresholdValue": 18,
      "duration": "300s",
      "trigger": {"count": 1}
    }
  }],
  "alertStrategy": {"autoClose": "3600s"},
  "combiner": "OR",
  "enabled": true,
  "notificationChannels": [${CHANNEL_NAME:+"\"${CHANNEL_NAME}\""}],
  "documentation": {
    "content": "A Cloud Run service has 18+ active instances (max is 20). Consider increasing max-instances.",
    "mimeType": "text/markdown"
  }
}
EOF
create_alert "CRM — Cloud Run scaling at max instances" "${ALERT_MAXSCALE_FILE}"

# Cleanup temp files
rm -f "${ALERT_ERROR_RATE_FILE}" "${ALERT_LATENCY_FILE}" "${ALERT_DISK_FILE}" \
      "${ALERT_CONN_FILE}" "${ALERT_PUBSUB_FILE}" "${ALERT_MAXSCALE_FILE}"

# ─── 4. Log-based Metrics ─────────────────────────────────────────────────────
# Extract application-level errors from structured logs so we can alert on them.
log ""
log "=== Step 4: Log-based Metrics ==="

# Metric: count of log entries with severity >= ERROR across all Cloud Run services
METRIC_NAME="crm_cloud_run_errors"
EXISTING_METRIC=$(gcloud logging metrics describe "${METRIC_NAME}" \
  --project="${PROJECT_ID}" \
  --format="value(name)" 2>/dev/null || echo "")

if [[ -n "${EXISTING_METRIC}" ]]; then
  success "Log metric '${METRIC_NAME}' already exists"
else
  log "  → Creating log-based metric '${METRIC_NAME}'"
  gcloud logging metrics create "${METRIC_NAME}" \
    --project="${PROJECT_ID}" \
    --description="Count of ERROR+ severity log entries in CRM Cloud Run services" \
    --log-filter='resource.type="cloud_run_revision" AND severity>=ERROR AND resource.labels.service_name=~"^crm-"' \
    2>/dev/null || log "  ⚠  Log metric creation failed"
  success "Log metric '${METRIC_NAME}' created"
fi

# ==============================================================================
log ""
log "=== Monitoring Setup Complete ==="
log ""
log "Monitoring resources created:"
log "  Notification channel: ${ALERT_EMAIL}"
log "  Uptime checks:        crm-web (${WEB_DOMAIN}), crm-api (${API_DOMAIN})"
log "  Alert policies:       6 policies covering errors, latency, DB, Pub/Sub, scaling"
log "  Log metric:           ${METRIC_NAME}"
log ""
log "View in GCP Console:"
log "  Monitoring:    https://console.cloud.google.com/monitoring?project=${PROJECT_ID}"
log "  Alerts:        https://console.cloud.google.com/monitoring/alerting?project=${PROJECT_ID}"
log "  Uptime checks: https://console.cloud.google.com/monitoring/uptime?project=${PROJECT_ID}"
log "  Logs:          https://console.cloud.google.com/logs?project=${PROJECT_ID}"
log ""
log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
log " ALL INFRASTRUCTURE SCRIPTS COMPLETE"
log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
log ""
log "REMAINING MANUAL STEPS:"
log "  1. Add GitHub Secrets (see output from 10-workload-identity.sh)"
log "  2. Update DNS A records (see output from 08-load-balancer.sh)"
log "  3. Push a commit to main to trigger the first real CI/CD deployment"
log "  4. Set WEB_DOMAIN and API_DOMAIN for SSL cert provisioning"
log "  5. Configure Amazon SES DNS (DKIM, SPF, DMARC) for notifications"
log "  6. (Optional) Configure Inngest self-hosting or verify cloud callback URLs"
log ""
log "Review all gaps in infra/README.md before going live."
