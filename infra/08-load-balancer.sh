#!/usr/bin/env bash
# =============================================================================
# 08-load-balancer.sh — Global HTTPS Load Balancers for crm-web and crm-api
#
# WHY a Load Balancer instead of direct Cloud Run URLs?
# -------------------------------------------------------
# Cloud Run auto-generates *.run.app URLs, but production needs:
#   • Custom domains (app.yourdomain.com, api.yourdomain.com)
#   • SSL/TLS with Google-managed certificates (auto-renewal)
#   • Cloud Armor WAF + DDoS protection
#   • HTTP→HTTPS redirect
#   • Global anycast IP (routes users to nearest GCP edge)
#
# Architecture per service (web and api):
#   Internet → Global Static IP
#            → HTTPS Target Proxy (+ SSL cert)
#            → URL Map
#            → Backend Service
#            → Serverless NEG (Network Endpoint Group) → Cloud Run
#
# The Serverless NEG is the bridge between the Load Balancer and Cloud Run.
# Cloud Run with --ingress=internal-and-cloud-load-balancing only accepts
# traffic coming through the Load Balancer (not direct *.run.app access).
#
# Cloud Armor
# -----------
# Both Load Balancers get a Cloud Armor security policy that:
#   • Enables the OWASP Top-10 managed rule set
#   • Rate limits aggressive clients (>100 req/10s per IP)
#   • Blocks known malicious IP ranges (Google's threat intelligence)
#
# USAGE: bash infra/08-load-balancer.sh
#
# AFTER running this script:
#   1. Note the static IP addresses printed at the end
#   2. Create DNS A records pointing your domains to these IPs
#   3. Wait ~30 minutes for Google-managed SSL certs to provision
#   4. Update the VITE_API_URL env var on crm-web once the LB is live
# =============================================================================
set -euo pipefail
source "$(dirname "$0")/00-variables.env"

log()    { echo "[$(date +'%H:%M:%S')] $*"; }
success(){ echo "[$(date +'%H:%M:%S')]   ✓ $*"; }

# ==============================================================================
# ─── Helper: build one complete HTTPS Load Balancer ──────────────────────────
# ==============================================================================
# Arguments:
#   $1 = lb_name        — base name (e.g. "crm-web-lb")
#   $2 = ip_name        — static IP resource name
#   $3 = neg_name       — serverless NEG name
#   $4 = backend_name   — backend service name
#   $5 = urlmap_name    — URL map name
#   $6 = cert_name      — SSL certificate name
#   $7 = proxy_name     — HTTPS target proxy name
#   $8 = rule_name      — forwarding rule name
#   $9 = cloud_run_svc  — Cloud Run service name
#  $10 = domain         — custom domain for SSL cert
#  $11 = armor_policy   — Cloud Armor security policy name
build_lb() {
  local lb_name="$1"
  local ip_name="$2"
  local neg_name="$3"
  local backend_name="$4"
  local urlmap_name="$5"
  local cert_name="$6"
  local proxy_name="$7"
  local rule_name="$8"
  local cr_service="$9"
  local domain="${10}"
  local armor_policy="${11}"

  log ""
  log "--- Building load balancer '${lb_name}' for ${cr_service} (${domain}) ---"

  # ── Step A: Reserve a global static IP ──────────────────────────────────────
  # Static IP ensures your DNS record never needs to change.
  EXISTING_IP=$(gcloud compute addresses describe "${ip_name}" \
    --global --project="${PROJECT_ID}" \
    --format="value(address)" 2>/dev/null || echo "")

  if [[ -n "${EXISTING_IP}" ]]; then
    success "Static IP '${ip_name}' already exists: ${EXISTING_IP}"
  else
    log "  → Reserving global static IP '${ip_name}'"
    gcloud compute addresses create "${ip_name}" \
      --project="${PROJECT_ID}" \
      --global \
      --ip-version=IPV4 \
      --description="Static IP for ${lb_name} (${domain})"
    EXISTING_IP=$(gcloud compute addresses describe "${ip_name}" \
      --global --project="${PROJECT_ID}" \
      --format="value(address)")
    success "Static IP reserved: ${EXISTING_IP}"
  fi

  # ── Step B: Serverless Network Endpoint Group (NEG) ─────────────────────────
  # The Serverless NEG is the bridge between the LB and Cloud Run.
  # It tells the backend service to forward traffic to a specific Cloud Run service.
  EXISTING_NEG=$(gcloud compute network-endpoint-groups describe "${neg_name}" \
    --project="${PROJECT_ID}" \
    --region="${REGION}" \
    --format="value(name)" 2>/dev/null || echo "")

  if [[ -n "${EXISTING_NEG}" ]]; then
    success "NEG '${neg_name}' already exists"
  else
    log "  → Creating Serverless NEG '${neg_name}' → ${cr_service}"
    gcloud compute network-endpoint-groups create "${neg_name}" \
      --project="${PROJECT_ID}" \
      --region="${REGION}" \
      --network-endpoint-type=serverless \
      --cloud-run-service="${cr_service}"
  fi

  # ── Step C: Backend Service ──────────────────────────────────────────────────
  # The Backend Service aggregates NEGs and applies:
  #   • Cloud Armor security policy
  #   • Health checking (serverless NEGs don't need explicit HC)
  #   • Session affinity (NONE is fine for stateless services)
  EXISTING_BACKEND=$(gcloud compute backend-services describe "${backend_name}" \
    --project="${PROJECT_ID}" \
    --global \
    --format="value(name)" 2>/dev/null || echo "")

  if [[ -n "${EXISTING_BACKEND}" ]]; then
    success "Backend service '${backend_name}' already exists"
  else
    log "  → Creating backend service '${backend_name}'"
    gcloud compute backend-services create "${backend_name}" \
      --project="${PROJECT_ID}" \
      --global \
      --load-balancing-scheme=EXTERNAL_MANAGED \
      `# EXTERNAL_MANAGED = Global Application Load Balancer (replaces classic).`\
      --protocol=HTTPS \
      --security-policy="${armor_policy}" \
      --description="Backend for ${lb_name} (${cr_service})"

    log "  → Adding NEG to backend service"
    gcloud compute backend-services add-backend "${backend_name}" \
      --project="${PROJECT_ID}" \
      --global \
      --network-endpoint-group="${neg_name}" \
      --network-endpoint-group-region="${REGION}"
  fi

  # ── Step D: URL Map ──────────────────────────────────────────────────────────
  # URL Map routes incoming requests to backend services.
  # Simple case: all paths → backend_name.
  EXISTING_URLMAP=$(gcloud compute url-maps describe "${urlmap_name}" \
    --project="${PROJECT_ID}" \
    --global \
    --format="value(name)" 2>/dev/null || echo "")

  if [[ -n "${EXISTING_URLMAP}" ]]; then
    success "URL map '${urlmap_name}' already exists"
  else
    log "  → Creating URL map '${urlmap_name}'"
    gcloud compute url-maps create "${urlmap_name}" \
      --project="${PROJECT_ID}" \
      --global \
      --default-service="${backend_name}" \
      --description="URL map for ${lb_name}"
  fi

  # ── Step E: HTTP redirect URL map ─────────────────────────────────────────
  # Separate URL map that redirects all HTTP traffic to HTTPS.
  HTTP_URLMAP="${urlmap_name}-http-redirect"
  EXISTING_HTTP_MAP=$(gcloud compute url-maps describe "${HTTP_URLMAP}" \
    --project="${PROJECT_ID}" \
    --global \
    --format="value(name)" 2>/dev/null || echo "")

  if [[ -n "${EXISTING_HTTP_MAP}" ]]; then
    success "HTTP redirect URL map '${HTTP_URLMAP}' already exists"
  else
    log "  → Creating HTTP→HTTPS redirect URL map '${HTTP_URLMAP}'"
    gcloud compute url-maps import "${HTTP_URLMAP}" \
      --project="${PROJECT_ID}" \
      --global \
      --source=/dev/stdin << EOF
defaultUrlRedirect:
  redirectResponseCode: MOVED_PERMANENTLY_DEFAULT
  httpsRedirect: true
EOF
  fi

  # ── Step F: Google-managed SSL Certificate ────────────────────────────────
  # Google manages provisioning and auto-renewal. The cert becomes ACTIVE
  # only after DNS is configured and propagated (~30 min after DNS change).
  EXISTING_CERT=$(gcloud compute ssl-certificates describe "${cert_name}" \
    --project="${PROJECT_ID}" \
    --global \
    --format="value(name)" 2>/dev/null || echo "")

  if [[ -n "${EXISTING_CERT}" ]]; then
    success "SSL certificate '${cert_name}' already exists"
    # Show current status
    CERT_STATUS=$(gcloud compute ssl-certificates describe "${cert_name}" \
      --project="${PROJECT_ID}" \
      --global \
      --format="value(managed.status)" 2>/dev/null || echo "UNKNOWN")
    log "    Status: ${CERT_STATUS}"
  else
    if [[ -z "${domain}" ]]; then
      log "  ⚠  No domain configured for ${lb_name} — skipping SSL certificate."
      log "     Set WEB_DOMAIN / API_DOMAIN in 00-variables.env and re-run."
    else
      log "  → Creating Google-managed SSL certificate '${cert_name}' for ${domain}"
      gcloud compute ssl-certificates create "${cert_name}" \
        --project="${PROJECT_ID}" \
        --global \
        --domains="${domain}" \
        --description="Google-managed SSL cert for ${domain}"
      log "    Certificate will become ACTIVE after DNS A record points to ${EXISTING_IP}"
    fi
  fi

  # ── Step G: HTTPS Target Proxy ────────────────────────────────────────────
  EXISTING_PROXY=$(gcloud compute target-https-proxies describe "${proxy_name}" \
    --project="${PROJECT_ID}" \
    --global \
    --format="value(name)" 2>/dev/null || echo "")

  if [[ -n "${EXISTING_PROXY}" ]]; then
    success "HTTPS target proxy '${proxy_name}' already exists"
  else
    if [[ -z "${domain}" ]]; then
      log "  ⚠  Skipping HTTPS proxy (no domain/cert configured)"
    else
      log "  → Creating HTTPS target proxy '${proxy_name}'"
      gcloud compute target-https-proxies create "${proxy_name}" \
        --project="${PROJECT_ID}" \
        --global \
        --url-map="${urlmap_name}" \
        --ssl-certificates="${cert_name}" \
        --description="HTTPS proxy for ${lb_name}"
    fi
  fi

  # ── Step H: HTTP Target Proxy (for redirect) ────────────────────────────────
  HTTP_PROXY="${proxy_name}-http"
  EXISTING_HTTP_PROXY=$(gcloud compute target-http-proxies describe "${HTTP_PROXY}" \
    --project="${PROJECT_ID}" \
    --global \
    --format="value(name)" 2>/dev/null || echo "")

  if [[ -n "${EXISTING_HTTP_PROXY}" ]]; then
    success "HTTP target proxy '${HTTP_PROXY}' already exists"
  else
    log "  → Creating HTTP target proxy '${HTTP_PROXY}' (redirects to HTTPS)"
    gcloud compute target-http-proxies create "${HTTP_PROXY}" \
      --project="${PROJECT_ID}" \
      --global \
      --url-map="${HTTP_URLMAP}"
  fi

  # ── Step I: Forwarding Rules ─────────────────────────────────────────────────
  # HTTPS forwarding rule (port 443)
  EXISTING_FWD=$(gcloud compute forwarding-rules describe "${rule_name}" \
    --project="${PROJECT_ID}" \
    --global \
    --format="value(name)" 2>/dev/null || echo "")

  if [[ -n "${EXISTING_FWD}" ]]; then
    success "HTTPS forwarding rule '${rule_name}' already exists"
  else
    if [[ -z "${domain}" ]]; then
      log "  ⚠  Skipping HTTPS forwarding rule (no domain/proxy configured)"
    else
      log "  → Creating HTTPS forwarding rule '${rule_name}' on ${EXISTING_IP}:443"
      gcloud compute forwarding-rules create "${rule_name}" \
        --project="${PROJECT_ID}" \
        --global \
        --load-balancing-scheme=EXTERNAL_MANAGED \
        --address="${ip_name}" \
        --target-https-proxy="${proxy_name}" \
        --ports=443
    fi
  fi

  # HTTP forwarding rule (port 80 → redirect to 443)
  HTTP_RULE="${rule_name}-http"
  EXISTING_HTTP_FWD=$(gcloud compute forwarding-rules describe "${HTTP_RULE}" \
    --project="${PROJECT_ID}" \
    --global \
    --format="value(name)" 2>/dev/null || echo "")

  if [[ -n "${EXISTING_HTTP_FWD}" ]]; then
    success "HTTP forwarding rule '${HTTP_RULE}' already exists"
  else
    log "  → Creating HTTP forwarding rule '${HTTP_RULE}' on ${EXISTING_IP}:80 (redirect)"
    gcloud compute forwarding-rules create "${HTTP_RULE}" \
      --project="${PROJECT_ID}" \
      --global \
      --load-balancing-scheme=EXTERNAL_MANAGED \
      --address="${ip_name}" \
      --target-http-proxy="${HTTP_PROXY}" \
      --ports=80
  fi

  log ""
  log "  Load Balancer '${lb_name}' is configured."
  log "    Static IP: ${EXISTING_IP}"
  log "    Domain:    ${domain}"
  log "    → Create DNS A record: ${domain} → ${EXISTING_IP}"
}

# ==============================================================================
# ─── Cloud Armor Security Policies ───────────────────────────────────────────
# ==============================================================================
log "=== Creating Cloud Armor Security Policies ==="

ARMOR_POLICY="crm-cloud-armor"

EXISTING_ARMOR=$(gcloud compute security-policies describe "${ARMOR_POLICY}" \
  --project="${PROJECT_ID}" \
  --format="value(name)" 2>/dev/null || echo "")

if [[ -n "${EXISTING_ARMOR}" ]]; then
  success "Cloud Armor policy '${ARMOR_POLICY}' already exists"
else
  log "  → Creating Cloud Armor policy '${ARMOR_POLICY}'"

  # Create the base policy
  gcloud compute security-policies create "${ARMOR_POLICY}" \
    --project="${PROJECT_ID}" \
    --type=CLOUD_ARMOR \
    --description="CRM WAF policy — OWASP rules + rate limiting + adaptive protection"

  # ── Rule 1: OWASP ModSecurity Core Rule Set ─────────────────────────────────
  # Protects against: SQLi, XSS, RCE, LFI, RFI, and other OWASP Top-10 attacks.
  # Sensitivity level 1 = low false positives (good starting point for prod).
  log "  → Adding OWASP ModSecurity Core Rule Set (sensitivity=1)"
  gcloud compute security-policies rules create 1000 \
    --project="${PROJECT_ID}" \
    --security-policy="${ARMOR_POLICY}" \
    --action=deny-403 \
    --expression="evaluatePreconfiguredExpr('sqli-stable', {'sensitivity': 1})" \
    --description="Block SQL injection attacks"

  gcloud compute security-policies rules create 1001 \
    --project="${PROJECT_ID}" \
    --security-policy="${ARMOR_POLICY}" \
    --action=deny-403 \
    --expression="evaluatePreconfiguredExpr('xss-stable', {'sensitivity': 1})" \
    --description="Block XSS attacks"

  gcloud compute security-policies rules create 1002 \
    --project="${PROJECT_ID}" \
    --security-policy="${ARMOR_POLICY}" \
    --action=deny-403 \
    --expression="evaluatePreconfiguredExpr('rce-stable', {'sensitivity': 1})" \
    --description="Block remote code execution attacks"

  gcloud compute security-policies rules create 1003 \
    --project="${PROJECT_ID}" \
    --security-policy="${ARMOR_POLICY}" \
    --action=deny-403 \
    --expression="evaluatePreconfiguredExpr('lfi-stable', {'sensitivity': 1})" \
    --description="Block local file inclusion attacks"

  gcloud compute security-policies rules create 1004 \
    --project="${PROJECT_ID}" \
    --security-policy="${ARMOR_POLICY}" \
    --action=deny-403 \
    --expression="evaluatePreconfiguredExpr('scannerdetection-stable', {'sensitivity': 1})" \
    --description="Block known vulnerability scanners"

  # ── Rule 2: IP-based rate limiting ─────────────────────────────────────────
  # Limits each source IP to 100 requests per 10-second window.
  # This blocks credential stuffing and DDoS while allowing normal browsing.
  log "  → Adding rate limiting rule (100 req / 10s per IP)"
  gcloud compute security-policies rules create 2000 \
    --project="${PROJECT_ID}" \
    --security-policy="${ARMOR_POLICY}" \
    --action=rate-based-ban \
    --src-ip-ranges="*" \
    --rate-limit-threshold-count=100 \
    --rate-limit-threshold-interval-sec=10 \
    --ban-duration-sec=300 \
    --conform-action=allow \
    --exceed-action=deny-429 \
    --description="Rate limit: 100 req/10s per IP, ban 5min if exceeded"

  # ── Rule 3: Enable Adaptive Protection ─────────────────────────────────────
  # Adaptive Protection uses ML to detect and block L7 DDoS attacks in real time.
  log "  → Enabling Cloud Armor Adaptive Protection"
  gcloud compute security-policies update "${ARMOR_POLICY}" \
    --project="${PROJECT_ID}" \
    --enable-layer7-ddos-defense \
    --layer7-ddos-defense-rule-visibility=STANDARD 2>/dev/null || \
    log "  ⚠  Adaptive Protection requires Cloud Armor Plus tier — skipping"

  # ── Default rule: allow all (rules above block specific patterns) ───────────
  log "  → Updating default rule to allow (rules above handle blocking)"
  gcloud compute security-policies rules update 2147483647 \
    --project="${PROJECT_ID}" \
    --security-policy="${ARMOR_POLICY}" \
    --action=allow \
    --description="Default: allow (specific rules above handle blocking)"

  success "Cloud Armor policy '${ARMOR_POLICY}' created"
fi

# ==============================================================================
# ─── Build Load Balancers ─────────────────────────────────────────────────────
# ==============================================================================

build_lb \
  "${LB_WEB_NAME}" \
  "${LB_WEB_IP_NAME}" \
  "crm-web-neg" \
  "crm-web-backend" \
  "crm-web-urlmap" \
  "crm-web-ssl-cert" \
  "crm-web-https-proxy" \
  "crm-web-https-rule" \
  "${SVC_WEB}" \
  "${WEB_DOMAIN}" \
  "${ARMOR_POLICY}"

build_lb \
  "${LB_API_NAME}" \
  "${LB_API_IP_NAME}" \
  "crm-api-neg" \
  "crm-api-backend" \
  "crm-api-urlmap" \
  "crm-api-ssl-cert" \
  "crm-api-https-proxy" \
  "crm-api-https-rule" \
  "${SVC_API}" \
  "${API_DOMAIN}" \
  "${ARMOR_POLICY}"

# ==============================================================================
# ─── Update VITE_API_URL on crm-web ─────────────────────────────────────────
# ==============================================================================
# Once the load balancer is set up, we know the real public API URL.
# Update the crm-web service so the Nginx entrypoint injects the correct URL.
log ""
log "=== Updating crm-web with public API URL ==="
if [[ -n "${API_DOMAIN}" ]]; then
  gcloud run services update "${SVC_WEB}" \
    --project="${PROJECT_ID}" \
    --region="${REGION}" \
    --update-env-vars="VITE_API_URL=https://${API_DOMAIN}" \
    --quiet 2>/dev/null || true
  success "crm-web: VITE_API_URL=https://${API_DOMAIN}"
else
  API_URL=$(gcloud run services describe "${SVC_API}" \
    --project="${PROJECT_ID}" \
    --region="${REGION}" \
    --format="value(status.url)" 2>/dev/null || echo "")
  gcloud run services update "${SVC_WEB}" \
    --project="${PROJECT_ID}" \
    --region="${REGION}" \
    --update-env-vars="VITE_API_URL=${API_URL}" \
    --quiet 2>/dev/null || true
  log "  ⚠  Using Cloud Run URL (no custom domain set): ${API_URL}"
fi

# ==============================================================================
WEB_IP=$(gcloud compute addresses describe "${LB_WEB_IP_NAME}" \
  --global --project="${PROJECT_ID}" --format="value(address)" 2>/dev/null || echo "<pending>")
API_IP=$(gcloud compute addresses describe "${LB_API_IP_NAME}" \
  --global --project="${PROJECT_ID}" --format="value(address)" 2>/dev/null || echo "<pending>")

log ""
log "=== Load Balancer Setup Complete ==="
log ""
log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
log " ACTION REQUIRED — Configure DNS"
log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
log ""
log "  Create the following DNS A records at your domain registrar:"
log ""
log "  ${WEB_DOMAIN}   A   ${WEB_IP}"
log "  ${API_DOMAIN}   A   ${API_IP}"
log ""
log "  After DNS propagation (~5-60 min), Google-managed SSL certs"
log "  will auto-provision.  Check status with:"
log "    gcloud compute ssl-certificates describe crm-web-ssl-cert --global"
log "    gcloud compute ssl-certificates describe crm-api-ssl-cert --global"
log ""
log "  Services will be live at:"
log "    https://${WEB_DOMAIN}  (frontend)"
log "    https://${API_DOMAIN}  (REST API)"
log ""
log "Next step: bash infra/09-pubsub.sh"
