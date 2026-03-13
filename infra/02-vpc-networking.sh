#!/usr/bin/env bash
# =============================================================================
# 02-vpc-networking.sh — Create the VPC, subnet, Cloud NAT, firewall rules,
#                        and Private Service Access peering for Cloud SQL
#
# WHY a custom VPC?
# -----------------
# GCP's default VPC has auto-mode subnets in every region and overly permissive
# firewall rules. By using a custom VPC we get:
#   • Only the subnet(s) we explicitly create (minimal blast radius)
#   • Tight firewall rules (deny-all-ingress by default)
#   • Private connectivity to Cloud SQL with no public IP exposure
#   • Cloud NAT for outbound internet access (LLM APIs, Amazon SES, etc.)
#     without assigning public IPs to Cloud Run instances
#
# USAGE: bash infra/02-vpc-networking.sh
# =============================================================================
set -euo pipefail
source "$(dirname "$0")/00-variables.env"

log() { echo "[$(date +'%H:%M:%S')] $*"; }

# ─── 1. VPC Network ───────────────────────────────────────────────────────────
# Custom-mode VPC: GCP will NOT automatically create subnets in every region.
# We control exactly where subnets exist.
log "=== Step 1: VPC Network ==="

if gcloud compute networks describe "${VPC_NAME}" \
    --project="${PROJECT_ID}" &>/dev/null; then
  log "  ✓ VPC '${VPC_NAME}' already exists"
else
  log "  → Creating custom VPC '${VPC_NAME}'"
  gcloud compute networks create "${VPC_NAME}" \
    --project="${PROJECT_ID}" \
    --subnet-mode=custom \
    --bgp-routing-mode=regional \
    --description="CRM platform VPC — all services run inside this network"
fi

# ─── 2. Subnet ────────────────────────────────────────────────────────────────
# A single regional subnet hosts all Cloud Run services via Direct VPC Egress.
# Cloud Run needs a subnet with enough IPs; /20 gives 4096 addresses which is
# more than enough even with aggressive auto-scaling.
#
# Private Google Access: Enabled so that services in the subnet can reach
# Google APIs (Secret Manager, Pub/Sub, Cloud SQL, etc.) without going through
# the public internet — traffic stays on Google's backbone network.
log ""
log "=== Step 2: Subnet ==="

if gcloud compute networks subnets describe "${SUBNET_NAME}" \
    --project="${PROJECT_ID}" \
    --region="${REGION}" &>/dev/null; then
  log "  ✓ Subnet '${SUBNET_NAME}' already exists"
else
  log "  → Creating subnet '${SUBNET_NAME}' (${SUBNET_RANGE}) in ${REGION}"
  gcloud compute networks subnets create "${SUBNET_NAME}" \
    --project="${PROJECT_ID}" \
    --network="${VPC_NAME}" \
    --region="${REGION}" \
    --range="${SUBNET_RANGE}" \
    --enable-private-ip-google-access \
    --description="Primary subnet for CRM Cloud Run services (${SUBNET_RANGE})"
fi

# ─── 3. Private Service Access (PSA) ──────────────────────────────────────────
# PSA creates a VPC peering connection between our VPC and Google's managed
# services VPC (where Cloud SQL lives). This is what gives Cloud SQL its
# private IP address on our network, allowing connections without a public IP.
#
# The /16 allocated range must NOT overlap with our subnet range.
# Our subnet: 10.0.0.0/20  — our PSA range: 10.1.0.0/16 (no overlap).
log ""
log "=== Step 3: Private Service Access (for Cloud SQL private IP) ==="

EXISTING_PSA=$(gcloud compute addresses list \
  --project="${PROJECT_ID}" \
  --filter="name=${PSA_RANGE_NAME} AND purpose=VPC_PEERING" \
  --format="value(name)" 2>/dev/null || echo "")

if [[ -n "${EXISTING_PSA}" ]]; then
  log "  ✓ PSA IP range '${PSA_RANGE_NAME}' already exists"
else
  log "  → Allocating PSA IP range ${PSA_RANGE}/${PSA_PREFIX_LENGTH}"
  gcloud compute addresses create "${PSA_RANGE_NAME}" \
    --project="${PROJECT_ID}" \
    --global \
    --purpose=VPC_PEERING \
    --prefix-length="${PSA_PREFIX_LENGTH}" \
    --addresses="${PSA_RANGE}" \
    --network="${VPC_NAME}" \
    --description="Private Service Access range for Cloud SQL private IP"
fi

# Create the VPC peering connection to Google's service producer network.
# This is what makes Cloud SQL reachable via private IP from our VPC.
EXISTING_PEERING=$(gcloud services vpc-peerings list \
  --project="${PROJECT_ID}" \
  --network="${VPC_NAME}" \
  --format="value(peering)" 2>/dev/null | grep "servicenetworking" || echo "")

if [[ -n "${EXISTING_PEERING}" ]]; then
  log "  ✓ Service networking peering already exists"
else
  log "  → Creating service networking VPC peering"
  gcloud services vpc-peerings connect \
    --project="${PROJECT_ID}" \
    --service=servicenetworking.googleapis.com \
    --ranges="${PSA_RANGE_NAME}" \
    --network="${VPC_NAME}"
  log "  Waiting 30 seconds for peering to activate..."
  sleep 30
fi

# ─── 4. Cloud Router ──────────────────────────────────────────────────────────
# Cloud Router is required by Cloud NAT. It advertises routes and manages the
# NAT configuration for the subnet.
log ""
log "=== Step 4: Cloud Router ==="

if gcloud compute routers describe "${CLOUD_ROUTER_NAME}" \
    --project="${PROJECT_ID}" \
    --region="${REGION}" &>/dev/null; then
  log "  ✓ Cloud Router '${CLOUD_ROUTER_NAME}' already exists"
else
  log "  → Creating Cloud Router '${CLOUD_ROUTER_NAME}'"
  gcloud compute routers create "${CLOUD_ROUTER_NAME}" \
    --project="${PROJECT_ID}" \
    --network="${VPC_NAME}" \
    --region="${REGION}" \
    --description="Cloud Router for CRM VPC — used by Cloud NAT"
fi

# ─── 5. Cloud NAT ─────────────────────────────────────────────────────────────
# Cloud NAT provides outbound internet access for Cloud Run services without
# assigning them public IP addresses. This is how our services reach:
#   • LLM provider APIs (OpenAI, Anthropic, Google AI, xAI)
#   • Amazon SES (email sending)
#   • Inngest cloud API
#   • Langfuse (AI observability)
#   • Any other external HTTPS services
#
# NAT logging is enabled so we can audit all outbound connections.
# MIN_PORTS_PER_VM is set to 64 (default 64) — increase if you see port
# exhaustion issues under high auto-scaling load.
log ""
log "=== Step 5: Cloud NAT ==="

if gcloud compute routers nats describe "${CLOUD_NAT_NAME}" \
    --project="${PROJECT_ID}" \
    --router="${CLOUD_ROUTER_NAME}" \
    --region="${REGION}" &>/dev/null; then
  log "  ✓ Cloud NAT '${CLOUD_NAT_NAME}' already exists"
else
  log "  → Creating Cloud NAT '${CLOUD_NAT_NAME}' on subnet '${SUBNET_NAME}'"
  gcloud compute routers nats create "${CLOUD_NAT_NAME}" \
    --project="${PROJECT_ID}" \
    --router="${CLOUD_ROUTER_NAME}" \
    --region="${REGION}" \
    --nat-custom-subnet-ip-ranges="${SUBNET_NAME}" \
    --auto-allocate-nat-external-ips \
    --min-ports-per-vm=64 \
    --log-config=enable=true,filter=ERRORS_ONLY \
    --enable-endpoint-independent-mapping \
    --description="Cloud NAT for CRM VPC — outbound internet access for Cloud Run"
fi

# ─── 6. Firewall Rules ────────────────────────────────────────────────────────
# GCP's implied rules: deny all ingress, allow all egress.
# We add only what's explicitly needed.
#
# For Cloud Run services using Direct VPC Egress, GCP manages firewall rules
# internally for Cloud Run ↔ VPC traffic.  We only need to define rules for
# health checks and any explicitly needed inter-service traffic.
log ""
log "=== Step 6: Firewall Rules ==="

# Allow GCP Load Balancer health check probes to reach Cloud Run instances.
# Source ranges are Google's health checker IPs (documented in GCP docs).
# Without this rule, load balancer health checks will fail.
FW_RULE_LB_HEALTHCHECK="crm-allow-lb-health-checks"
if gcloud compute firewall-rules describe "${FW_RULE_LB_HEALTHCHECK}" \
    --project="${PROJECT_ID}" &>/dev/null; then
  log "  ✓ Firewall rule '${FW_RULE_LB_HEALTHCHECK}' already exists"
else
  log "  → Creating firewall rule: allow load balancer health checks"
  gcloud compute firewall-rules create "${FW_RULE_LB_HEALTHCHECK}" \
    --project="${PROJECT_ID}" \
    --network="${VPC_NAME}" \
    --direction=INGRESS \
    --priority=1000 \
    --source-ranges="35.191.0.0/16,130.211.0.0/22" \
    --allow=tcp:8080,tcp:4001,tcp:4002,tcp:4003,tcp:4004 \
    --target-tags="crm-cloud-run" \
    --description="Allow GCP LB health checks to reach Cloud Run services"
fi

# Allow internal VPC traffic between our services.
# Cloud Run services with Direct VPC Egress appear as VPC resources and can
# communicate with other services in the subnet.
FW_RULE_INTERNAL="crm-allow-internal"
if gcloud compute firewall-rules describe "${FW_RULE_INTERNAL}" \
    --project="${PROJECT_ID}" &>/dev/null; then
  log "  ✓ Firewall rule '${FW_RULE_INTERNAL}' already exists"
else
  log "  → Creating firewall rule: allow internal VPC traffic"
  gcloud compute firewall-rules create "${FW_RULE_INTERNAL}" \
    --project="${PROJECT_ID}" \
    --network="${VPC_NAME}" \
    --direction=INGRESS \
    --priority=1000 \
    --source-ranges="${SUBNET_RANGE}" \
    --allow=tcp:4001,tcp:4002,tcp:4003,tcp:4004,tcp:5432 \
    --description="Allow inter-service communication within the CRM VPC subnet"
fi

# Deny all other ingress traffic explicitly.
# (GCP has an implied deny-all-ingress rule at priority 65535, but being
# explicit makes the intent clear and allows higher-priority overrides later.)
FW_RULE_DENY_ALL="crm-deny-all-ingress"
if gcloud compute firewall-rules describe "${FW_RULE_DENY_ALL}" \
    --project="${PROJECT_ID}" &>/dev/null; then
  log "  ✓ Firewall rule '${FW_RULE_DENY_ALL}' already exists"
else
  log "  → Creating firewall rule: deny all other ingress"
  gcloud compute firewall-rules create "${FW_RULE_DENY_ALL}" \
    --project="${PROJECT_ID}" \
    --network="${VPC_NAME}" \
    --direction=INGRESS \
    --priority=65000 \
    --source-ranges="0.0.0.0/0" \
    --action=DENY \
    --rules=all \
    --description="Deny all ingress traffic not explicitly allowed (belt + suspenders)"
fi

log ""
log "=== VPC Networking Setup Complete ==="
log ""
log "Summary:"
log "  VPC:           ${VPC_NAME}"
log "  Subnet:        ${SUBNET_NAME}  (${SUBNET_RANGE}, ${REGION})"
log "  PSA Range:     ${PSA_RANGE}/${PSA_PREFIX_LENGTH}  (for Cloud SQL private IP)"
log "  Cloud NAT:     ${CLOUD_NAT_NAME}  (outbound internet via ${CLOUD_ROUTER_NAME})"
log ""
log "Next step: bash infra/03-artifact-registry.sh"
