#!/usr/bin/env bash
# =============================================================================
# verify.sh — Smoke-test every infrastructure component after setup
#
# Run this after each script (or all at once) to confirm the setup is correct
# before moving to the next step.
#
# USAGE:
#   source infra/00-variables.env
#
#   # Test a single step
#   bash infra/verify.sh vpc
#   bash infra/verify.sh sql
#   bash infra/verify.sh secrets
#   bash infra/verify.sh services
#   bash infra/verify.sh loadbalancer
#   bash infra/verify.sh pubsub
#   bash infra/verify.sh cicd
#
#   # Test everything
#   bash infra/verify.sh all
# =============================================================================
set -euo pipefail
source "$(dirname "$0")/00-variables.env"

PASS=0
FAIL=0

pass() { echo "  ✅ $*"; PASS=$((PASS+1)); }
fail() { echo "  ❌ $*"; FAIL=$((FAIL+1)); }
header() { echo ""; echo "━━━ $* ━━━"; }

# =============================================================================
verify_apis() {
  header "01 · APIs"
  for api in \
    run.googleapis.com \
    artifactregistry.googleapis.com \
    compute.googleapis.com \
    sqladmin.googleapis.com \
    secretmanager.googleapis.com \
    pubsub.googleapis.com \
    iam.googleapis.com \
    sts.googleapis.com; do
    state=$(gcloud services list \
      --project="${PROJECT_ID}" \
      --filter="name:${api}" \
      --format="value(state)" 2>/dev/null || echo "")
    if [[ "${state}" == "ENABLED" ]]; then
      pass "${api}"
    else
      fail "${api} — state: ${state:-NOT_FOUND}"
    fi
  done
}

# =============================================================================
verify_vpc() {
  header "02 · VPC & Networking"

  # VPC exists
  if gcloud compute networks describe "${VPC_NAME}" \
      --project="${PROJECT_ID}" &>/dev/null; then
    pass "VPC '${VPC_NAME}' exists"
  else
    fail "VPC '${VPC_NAME}' not found"
  fi

  # Subnet exists with correct range
  SUBNET_RANGE_ACTUAL=$(gcloud compute networks subnets describe "${SUBNET_NAME}" \
    --project="${PROJECT_ID}" --region="${REGION}" \
    --format="value(ipCidrRange)" 2>/dev/null || echo "")
  if [[ "${SUBNET_RANGE_ACTUAL}" == "${SUBNET_RANGE}" ]]; then
    pass "Subnet '${SUBNET_NAME}' exists (${SUBNET_RANGE})"
  else
    fail "Subnet '${SUBNET_NAME}' — expected ${SUBNET_RANGE}, got: ${SUBNET_RANGE_ACTUAL:-NOT_FOUND}"
  fi

  # Private Google Access enabled on subnet
  PGA=$(gcloud compute networks subnets describe "${SUBNET_NAME}" \
    --project="${PROJECT_ID}" --region="${REGION}" \
    --format="value(privateIpGoogleAccess)" 2>/dev/null || echo "False")
  if [[ "${PGA}" == "True" ]]; then
    pass "Private Google Access enabled on subnet"
  else
    fail "Private Google Access NOT enabled on subnet (needed for Secret Manager, etc.)"
  fi

  # PSA IP range allocated
  PSA=$(gcloud compute addresses list \
    --project="${PROJECT_ID}" \
    --filter="name=${PSA_RANGE_NAME} AND purpose=VPC_PEERING" \
    --format="value(name)" 2>/dev/null || echo "")
  if [[ -n "${PSA}" ]]; then
    pass "PSA range '${PSA_RANGE_NAME}' allocated"
  else
    fail "PSA range '${PSA_RANGE_NAME}' not found (Cloud SQL private IP will not work)"
  fi

  # Service networking peering exists
  PEERING=$(gcloud services vpc-peerings list \
    --project="${PROJECT_ID}" --network="${VPC_NAME}" \
    --format="value(peering)" 2>/dev/null | grep -c "servicenetworking" || echo "0")
  if [[ "${PEERING}" -gt 0 ]]; then
    pass "Service networking VPC peering active"
  else
    fail "Service networking VPC peering not found (required for Cloud SQL private IP)"
  fi

  # Cloud NAT exists
  NAT=$(gcloud compute routers nats describe "${CLOUD_NAT_NAME}" \
    --project="${PROJECT_ID}" --router="${CLOUD_ROUTER_NAME}" \
    --region="${REGION}" --format="value(name)" 2>/dev/null || echo "")
  if [[ -n "${NAT}" ]]; then
    pass "Cloud NAT '${CLOUD_NAT_NAME}' exists"
  else
    fail "Cloud NAT '${CLOUD_NAT_NAME}' not found (external API calls will fail)"
  fi

  # Firewall rules
  for rule in "crm-allow-lb-health-checks" "crm-allow-internal" "crm-deny-all-ingress"; do
    if gcloud compute firewall-rules describe "${rule}" \
        --project="${PROJECT_ID}" &>/dev/null; then
      pass "Firewall rule '${rule}' exists"
    else
      fail "Firewall rule '${rule}' not found"
    fi
  done
}

# =============================================================================
verify_registry() {
  header "03 · Artifact Registry"

  REPO=$(gcloud artifacts repositories describe "${AR_REPOSITORY}" \
    --project="${PROJECT_ID}" --location="${REGION}" \
    --format="value(name)" 2>/dev/null || echo "")
  if [[ -n "${REPO}" ]]; then
    pass "Repository '${AR_REPOSITORY}' exists in ${REGION}"
  else
    fail "Repository '${AR_REPOSITORY}' not found"
  fi
}

# =============================================================================
verify_sql() {
  header "04 · Cloud SQL"

  # Instance running
  STATE=$(gcloud sql instances describe "${SQL_INSTANCE_NAME}" \
    --project="${PROJECT_ID}" --format="value(state)" 2>/dev/null || echo "")
  if [[ "${STATE}" == "RUNNABLE" ]]; then
    pass "Instance '${SQL_INSTANCE_NAME}' is RUNNABLE"
  else
    fail "Instance '${SQL_INSTANCE_NAME}' — state: ${STATE:-NOT_FOUND}"
    return
  fi

  # Private IP only (no public IP)
  PUBLIC_IP=$(gcloud sql instances describe "${SQL_INSTANCE_NAME}" \
    --project="${PROJECT_ID}" --format="json" 2>/dev/null | \
    python3 -c "
import json,sys
data=json.load(sys.stdin)
pub=[ip for ip in data.get('ipAddresses',[]) if ip.get('type')=='PRIMARY']
print(pub[0]['ipAddress'] if pub else '')
" 2>/dev/null || echo "")
  if [[ -z "${PUBLIC_IP}" ]]; then
    pass "No public IP assigned (private-only — correct)"
  else
    fail "Instance has a PUBLIC IP ${PUBLIC_IP} — should be private-only"
  fi

  # Private IP assigned
  PRIVATE_IP=$(gcloud sql instances describe "${SQL_INSTANCE_NAME}" \
    --project="${PROJECT_ID}" --format="json" 2>/dev/null | \
    python3 -c "
import json,sys
data=json.load(sys.stdin)
prv=[ip for ip in data.get('ipAddresses',[]) if ip.get('type')=='PRIVATE']
print(prv[0]['ipAddress'] if prv else '')
" 2>/dev/null || echo "")
  if [[ -n "${PRIVATE_IP}" ]]; then
    pass "Private IP assigned: ${PRIVATE_IP}"
  else
    fail "No private IP assigned — PSA peering may not be active yet"
  fi

  # Database exists
  DB=$(gcloud sql databases describe "${DB_NAME}" \
    --instance="${SQL_INSTANCE_NAME}" --project="${PROJECT_ID}" \
    --format="value(name)" 2>/dev/null || echo "")
  if [[ -n "${DB}" ]]; then
    pass "Database '${DB_NAME}' exists"
  else
    fail "Database '${DB_NAME}' not found"
  fi

  # App user exists
  USER=$(gcloud sql users list \
    --instance="${SQL_INSTANCE_NAME}" --project="${PROJECT_ID}" \
    --filter="name=${DB_USER}" --format="value(name)" 2>/dev/null || echo "")
  if [[ -n "${USER}" ]]; then
    pass "Database user '${DB_USER}' exists"
  else
    fail "Database user '${DB_USER}' not found"
  fi

  # HA enabled
  HA=$(gcloud sql instances describe "${SQL_INSTANCE_NAME}" \
    --project="${PROJECT_ID}" --format="value(settings.availabilityType)" 2>/dev/null || echo "")
  if [[ "${HA}" == "REGIONAL" ]]; then
    pass "High availability: REGIONAL (automatic failover)"
  else
    fail "HA type: ${HA} — expected REGIONAL"
  fi

  # Deletion protection on
  DEL_PROT=$(gcloud sql instances describe "${SQL_INSTANCE_NAME}" \
    --project="${PROJECT_ID}" --format="value(settings.deletionProtectionEnabled)" 2>/dev/null || echo "")
  if [[ "${DEL_PROT}" == "True" ]]; then
    pass "Deletion protection: enabled"
  else
    fail "Deletion protection: NOT enabled"
  fi
}

# =============================================================================
verify_secrets() {
  header "05 · Secret Manager"

  SECRETS=(
    "${SECRET_DB_URL}"
    "${SECRET_BETTER_AUTH_SECRET}"
    "${SECRET_GOOGLE_CLIENT_ID}"
    "${SECRET_GOOGLE_CLIENT_SECRET}"
    "${SECRET_INTERNAL_API_KEY}"
    "${SECRET_ENCRYPTION_SECRET}"
    "${SECRET_PUBSUB_TOKEN}"
    "${SECRET_INNGEST_EVENT_KEY}"
    "${SECRET_INNGEST_SIGNING_KEY}"
    "${SECRET_LANGFUSE_SECRET_KEY}"
    "${SECRET_LANGFUSE_PUBLIC_KEY}"
    "${SECRET_HUGGINGFACE_TOKEN}"
  )

  for secret in "${SECRETS[@]}"; do
    VERSION=$(gcloud secrets versions list "${secret}" \
      --project="${PROJECT_ID}" \
      --filter="state=ENABLED" \
      --format="value(name)" 2>/dev/null | head -1 || echo "")
    if [[ -n "${VERSION}" ]]; then
      pass "Secret '${secret}' has an ENABLED version"
    else
      fail "Secret '${secret}' — no ENABLED version found"
    fi
  done

  # Spot-check: DATABASE_URL contains the private IP (not a Neon host)
  DB_URL_VAL=$(gcloud secrets versions access latest \
    --secret="${SECRET_DB_URL}" --project="${PROJECT_ID}" 2>/dev/null || echo "")
  if echo "${DB_URL_VAL}" | grep -qE "^postgresql://"; then
    pass "DATABASE_URL looks like a valid PostgreSQL URL"
    if echo "${DB_URL_VAL}" | grep -q "neon.tech"; then
      fail "DATABASE_URL still points to Neon — update it to the Cloud SQL private IP"
    else
      pass "DATABASE_URL does not reference Neon (points to Cloud SQL)"
    fi
  else
    fail "DATABASE_URL does not look like a valid PostgreSQL URL"
  fi
}

# =============================================================================
verify_service_accounts() {
  header "06 · Service Accounts"

  for sa in "${SA_WEB}" "${SA_API}" "${SA_GMAIL}" "${SA_ANALYSIS}" \
            "${SA_NOTIFICATIONS}" "${SA_PUBSUB_INVOKER}" "${SA_CICD}"; do
    EMAIL="${sa}@${PROJECT_ID}.iam.gserviceaccount.com"
    EXISTS=$(gcloud iam service-accounts describe "${EMAIL}" \
      --project="${PROJECT_ID}" --format="value(email)" 2>/dev/null || echo "")
    if [[ -n "${EXISTS}" ]]; then
      pass "SA '${sa}' exists"
    else
      fail "SA '${sa}' not found"
    fi
  done

  # Check crm-api-sa has cloudsql.client
  API_ROLES=$(gcloud projects get-iam-policy "${PROJECT_ID}" \
    --flatten="bindings[].members" \
    --filter="bindings.members:${SA_API_EMAIL} AND bindings.role:roles/cloudsql.client" \
    --format="value(bindings.role)" 2>/dev/null || echo "")
  if [[ -n "${API_ROLES}" ]]; then
    pass "crm-api-sa has roles/cloudsql.client"
  else
    fail "crm-api-sa missing roles/cloudsql.client"
  fi

  # Check crm-cicd-sa has artifactregistry.writer
  CICD_AR=$(gcloud projects get-iam-policy "${PROJECT_ID}" \
    --flatten="bindings[].members" \
    --filter="bindings.members:${SA_CICD_EMAIL} AND bindings.role:roles/artifactregistry.writer" \
    --format="value(bindings.role)" 2>/dev/null || echo "")
  if [[ -n "${CICD_AR}" ]]; then
    pass "crm-cicd-sa has roles/artifactregistry.writer"
  else
    fail "crm-cicd-sa missing roles/artifactregistry.writer"
  fi
}

# =============================================================================
verify_services() {
  header "07 · Cloud Run Services"

  declare -A EXPECTED_INGRESS=(
    ["${SVC_WEB}"]="INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER"
    ["${SVC_API}"]="INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER"
    ["${SVC_GMAIL}"]="INGRESS_TRAFFIC_ALL"
    ["${SVC_ANALYSIS}"]="INGRESS_TRAFFIC_INTERNAL_ONLY"
    ["${SVC_NOTIFICATIONS}"]="INGRESS_TRAFFIC_ALL"
  )

  for svc in "${SVC_WEB}" "${SVC_API}" "${SVC_GMAIL}" "${SVC_ANALYSIS}" "${SVC_NOTIFICATIONS}"; do
    # Service exists and has a URL
    URL=$(gcloud run services describe "${svc}" \
      --project="${PROJECT_ID}" --region="${REGION}" \
      --format="value(status.url)" 2>/dev/null || echo "")
    if [[ -z "${URL}" ]]; then
      fail "Service '${svc}' not found or has no URL"
      continue
    fi
    pass "Service '${svc}' exists: ${URL}"

    # Correct ingress setting
    INGRESS=$(gcloud run services describe "${svc}" \
      --project="${PROJECT_ID}" --region="${REGION}" \
      --format="value(spec.template.metadata.annotations.'run.googleapis.com/ingress')" \
      2>/dev/null || echo "")
    # Also check via the top-level ingress field
    if [[ -z "${INGRESS}" ]]; then
      INGRESS=$(gcloud run services describe "${svc}" \
        --project="${PROJECT_ID}" --region="${REGION}" \
        --format="value(metadata.annotations.'run.googleapis.com/ingress')" \
        2>/dev/null || echo "")
    fi
    EXPECTED="${EXPECTED_INGRESS[${svc}]}"
    if [[ "${INGRESS}" == "${EXPECTED}" || "${INGRESS}" == "internal-and-cloud-load-balancing" || \
          "${INGRESS}" == "all" || "${INGRESS}" == "internal" ]]; then
      pass "  Ingress: ${INGRESS}"
    else
      fail "  Ingress: got '${INGRESS}', expected something matching '${EXPECTED}'"
    fi

    # VPC egress configured
    VPC=$(gcloud run services describe "${svc}" \
      --project="${PROJECT_ID}" --region="${REGION}" \
      --format="value(spec.template.metadata.annotations.'run.googleapis.com/network-interfaces')" \
      2>/dev/null || echo "")
    if [[ -n "${VPC}" ]]; then
      pass "  VPC egress: configured"
    else
      fail "  VPC egress: NOT configured (service is not in the VPC)"
    fi

    # Service account is the dedicated SA (not the default compute SA)
    SA=$(gcloud run services describe "${svc}" \
      --project="${PROJECT_ID}" --region="${REGION}" \
      --format="value(spec.template.spec.serviceAccountName)" 2>/dev/null || echo "")
    if echo "${SA}" | grep -q "crm-"; then
      pass "  Service account: ${SA}"
    else
      fail "  Service account: ${SA} — expected a crm-*-sa account"
    fi
  done

  # Verify crm-analysis is NOT reachable from the internet
  header "07b · crm-analysis internet isolation"
  ANALYSIS_URL=$(gcloud run services describe "${SVC_ANALYSIS}" \
    --project="${PROJECT_ID}" --region="${REGION}" \
    --format="value(status.url)" 2>/dev/null || echo "")
  if [[ -n "${ANALYSIS_URL}" ]]; then
    HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
      --max-time 10 "${ANALYSIS_URL}/health" 2>/dev/null || echo "000")
    if [[ "${HTTP_CODE}" == "403" || "${HTTP_CODE}" == "000" ]]; then
      pass "crm-analysis returns ${HTTP_CODE} from internet (correctly blocked)"
    else
      fail "crm-analysis returned HTTP ${HTTP_CODE} from internet — ingress may be misconfigured"
    fi
  fi

  # Verify crm-gmail requires auth (returns 401/403, not 200)
  header "07c · crm-gmail auth enforcement"
  GMAIL_URL=$(gcloud run services describe "${SVC_GMAIL}" \
    --project="${PROJECT_ID}" --region="${REGION}" \
    --format="value(status.url)" 2>/dev/null || echo "")
  if [[ -n "${GMAIL_URL}" ]]; then
    HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
      --max-time 10 "${GMAIL_URL}/health" 2>/dev/null || echo "000")
    if [[ "${HTTP_CODE}" == "401" || "${HTTP_CODE}" == "403" ]]; then
      pass "crm-gmail returns ${HTTP_CODE} without auth token (correctly enforced)"
    else
      fail "crm-gmail returned HTTP ${HTTP_CODE} without auth — should be 401/403"
    fi
  fi
}

# =============================================================================
verify_loadbalancer() {
  header "08 · Load Balancers"

  for ip_name in "${LB_WEB_IP_NAME}" "${LB_API_IP_NAME}"; do
    IP=$(gcloud compute addresses describe "${ip_name}" \
      --global --project="${PROJECT_ID}" \
      --format="value(address)" 2>/dev/null || echo "")
    if [[ -n "${IP}" ]]; then
      pass "Static IP '${ip_name}': ${IP}"
    else
      fail "Static IP '${ip_name}' not found"
    fi
  done

  for cert in "crm-web-ssl-cert" "crm-api-ssl-cert"; do
    STATUS=$(gcloud compute ssl-certificates describe "${cert}" \
      --global --project="${PROJECT_ID}" \
      --format="value(managed.status)" 2>/dev/null || echo "NOT_FOUND")
    if [[ "${STATUS}" == "ACTIVE" ]]; then
      pass "SSL cert '${cert}': ACTIVE"
    elif [[ "${STATUS}" == "PROVISIONING" ]]; then
      pass "SSL cert '${cert}': PROVISIONING (waiting for DNS — normal)"
    elif [[ "${STATUS}" == "NOT_FOUND" ]]; then
      fail "SSL cert '${cert}' not found"
    else
      fail "SSL cert '${cert}': ${STATUS}"
    fi
  done

  # Cloud Armor policy exists
  ARMOR=$(gcloud compute security-policies describe "crm-cloud-armor" \
    --project="${PROJECT_ID}" --format="value(name)" 2>/dev/null || echo "")
  if [[ -n "${ARMOR}" ]]; then
    pass "Cloud Armor policy 'crm-cloud-armor' exists"
  else
    fail "Cloud Armor policy 'crm-cloud-armor' not found"
  fi

  # Test public endpoints (if domains are configured)
  if [[ -n "${WEB_DOMAIN}" ]]; then
    HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
      --max-time 15 "https://${WEB_DOMAIN}" 2>/dev/null || echo "000")
    if [[ "${HTTP_CODE}" == "200" ]]; then
      pass "https://${WEB_DOMAIN} → HTTP ${HTTP_CODE}"
    elif [[ "${HTTP_CODE}" == "000" ]]; then
      fail "https://${WEB_DOMAIN} → no response (DNS not configured yet?)"
    else
      fail "https://${WEB_DOMAIN} → HTTP ${HTTP_CODE}"
    fi
  fi

  if [[ -n "${API_DOMAIN}" ]]; then
    HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
      --max-time 15 "https://${API_DOMAIN}/health" 2>/dev/null || echo "000")
    if [[ "${HTTP_CODE}" == "200" ]]; then
      pass "https://${API_DOMAIN}/health → HTTP ${HTTP_CODE}"
    elif [[ "${HTTP_CODE}" == "000" ]]; then
      fail "https://${API_DOMAIN}/health → no response (DNS not configured yet?)"
    else
      fail "https://${API_DOMAIN}/health → HTTP ${HTTP_CODE} (may be normal if /health not implemented)"
    fi
  fi
}

# =============================================================================
verify_pubsub() {
  header "09 · Pub/Sub"

  # Topic exists
  TOPIC=$(gcloud pubsub topics describe "${PUBSUB_TOPIC}" \
    --project="${PROJECT_ID}" --format="value(name)" 2>/dev/null || echo "")
  if [[ -n "${TOPIC}" ]]; then
    pass "Topic '${PUBSUB_TOPIC}' exists"
  else
    fail "Topic '${PUBSUB_TOPIC}' not found"
    return
  fi

  # Gmail API has publisher permission
  PUBLISHER=$(gcloud pubsub topics get-iam-policy "${PUBSUB_TOPIC}" \
    --project="${PROJECT_ID}" --format="json" 2>/dev/null | \
    python3 -c "
import json,sys
p=json.load(sys.stdin)
members=[m for b in p.get('bindings',[]) if 'pubsub.publisher' in b['role'] for m in b['members']]
print('yes' if any('gmail-api-push' in m for m in members) else '')
" 2>/dev/null || echo "")
  if [[ -n "${PUBLISHER}" ]]; then
    pass "Gmail API service account has pubsub.publisher on topic"
  else
    fail "Gmail API service account missing pubsub.publisher — Gmail watches will not deliver"
  fi

  # Push subscription exists with correct endpoint
  SUB=$(gcloud pubsub subscriptions describe "${PUBSUB_SUBSCRIPTION}" \
    --project="${PROJECT_ID}" --format="json" 2>/dev/null || echo "{}")
  PUSH_URL=$(echo "${SUB}" | python3 -c "
import json,sys
d=json.load(sys.stdin)
print(d.get('pushConfig',{}).get('pushEndpoint',''))
" 2>/dev/null || echo "")
  AUTH_SA=$(echo "${SUB}" | python3 -c "
import json,sys
d=json.load(sys.stdin)
print(d.get('pushConfig',{}).get('oidcToken',{}).get('serviceAccountEmail',''))
" 2>/dev/null || echo "")

  if [[ -n "${PUSH_URL}" ]]; then
    pass "Subscription '${PUBSUB_SUBSCRIPTION}' has push endpoint: ${PUSH_URL}"
  else
    fail "Subscription '${PUBSUB_SUBSCRIPTION}' not found or has no push endpoint"
  fi

  if [[ "${AUTH_SA}" == "${SA_PUBSUB_INVOKER_EMAIL}" ]]; then
    pass "Push auth SA: ${AUTH_SA}"
  else
    fail "Push auth SA: got '${AUTH_SA}', expected '${SA_PUBSUB_INVOKER_EMAIL}'"
  fi

  # crm-pubsub-invoker-sa has run.invoker on crm-gmail
  INVOKER=$(gcloud run services get-iam-policy "${SVC_GMAIL}" \
    --project="${PROJECT_ID}" --region="${REGION}" --format="json" 2>/dev/null | \
    python3 -c "
import json,sys
p=json.load(sys.stdin)
members=[m for b in p.get('bindings',[]) if 'run.invoker' in b['role'] for m in b['members']]
print('yes' if any('pubsub-invoker' in m for m in members) else '')
" 2>/dev/null || echo "")
  if [[ -n "${INVOKER}" ]]; then
    pass "crm-pubsub-invoker-sa has roles/run.invoker on crm-gmail"
  else
    fail "crm-pubsub-invoker-sa missing roles/run.invoker on crm-gmail — Pub/Sub pushes will fail"
  fi

  # Dead-letter topic exists
  DLT=$(gcloud pubsub topics describe "${PUBSUB_TOPIC}-deadletter" \
    --project="${PROJECT_ID}" --format="value(name)" 2>/dev/null || echo "")
  if [[ -n "${DLT}" ]]; then
    pass "Dead-letter topic '${PUBSUB_TOPIC}-deadletter' exists"
  else
    fail "Dead-letter topic not found"
  fi
}

# =============================================================================
verify_cicd() {
  header "10 · Workload Identity Federation"

  PROJECT_NUMBER=$(gcloud projects describe "${PROJECT_ID}" \
    --format="value(projectNumber)" 2>/dev/null || echo "")

  # WIF pool exists and is active
  POOL_STATE=$(gcloud iam workload-identity-pools describe "${WIF_POOL_ID}" \
    --project="${PROJECT_ID}" --location="global" \
    --format="value(state)" 2>/dev/null || echo "")
  if [[ "${POOL_STATE}" == "ACTIVE" ]]; then
    pass "WIF pool '${WIF_POOL_ID}': ACTIVE"
  else
    fail "WIF pool '${WIF_POOL_ID}': ${POOL_STATE:-NOT_FOUND}"
  fi

  # WIF provider exists and is active
  PROV_STATE=$(gcloud iam workload-identity-pools providers describe "${WIF_PROVIDER_ID}" \
    --project="${PROJECT_ID}" --location="global" \
    --workload-identity-pool="${WIF_POOL_ID}" \
    --format="value(state)" 2>/dev/null || echo "")
  if [[ "${PROV_STATE}" == "ACTIVE" ]]; then
    pass "WIF provider '${WIF_PROVIDER_ID}': ACTIVE"
  else
    fail "WIF provider '${WIF_PROVIDER_ID}': ${PROV_STATE:-NOT_FOUND}"
  fi

  # crm-cicd-sa has the WIF binding
  WIF_BINDING=$(gcloud iam service-accounts get-iam-policy "${SA_CICD_EMAIL}" \
    --project="${PROJECT_ID}" --format="json" 2>/dev/null | \
    python3 -c "
import json,sys
p=json.load(sys.stdin)
members=[m for b in p.get('bindings',[]) if 'workloadIdentityUser' in b['role'] for m in b['members']]
print('yes' if members else '')
" 2>/dev/null || echo "")
  if [[ -n "${WIF_BINDING}" ]]; then
    pass "crm-cicd-sa has workloadIdentityUser binding for GitHub pool"
  else
    fail "crm-cicd-sa missing workloadIdentityUser binding — GitHub Actions auth will fail"
  fi

  echo ""
  echo "  GitHub Secrets required in your repo:"
  echo "    GCP_PROJECT_ID      = ${PROJECT_ID}"
  echo "    WIF_PROVIDER        = projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${WIF_POOL_ID}/providers/${WIF_PROVIDER_ID}"
  echo "    WIF_SERVICE_ACCOUNT = ${SA_CICD_EMAIL}"
  echo ""
  echo "  Verify at: https://github.com/${GITHUB_REPO}/settings/secrets/actions"
}

# =============================================================================
# ─── Main dispatcher ─────────────────────────────────────────────────────────
# =============================================================================
STEP="${1:-all}"

case "${STEP}" in
  apis)        verify_apis ;;
  vpc)         verify_apis; verify_vpc ;;
  registry)    verify_registry ;;
  sql)         verify_sql ;;
  secrets)     verify_secrets ;;
  accounts)    verify_service_accounts ;;
  services)    verify_services ;;
  loadbalancer|lb) verify_loadbalancer ;;
  pubsub)      verify_pubsub ;;
  cicd)        verify_cicd ;;
  all)
    verify_apis
    verify_vpc
    verify_registry
    verify_sql
    verify_secrets
    verify_service_accounts
    verify_services
    verify_loadbalancer
    verify_pubsub
    verify_cicd
    ;;
  *)
    echo "Unknown step '${STEP}'"
    echo "Usage: bash infra/verify.sh [apis|vpc|registry|sql|secrets|accounts|services|lb|pubsub|cicd|all]"
    exit 1
    ;;
esac

# =============================================================================
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo " Results: ${PASS} passed, ${FAIL} failed"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
if [[ "${FAIL}" -gt 0 ]]; then
  echo " Fix the ❌ items above before proceeding to the next step."
  exit 1
fi
