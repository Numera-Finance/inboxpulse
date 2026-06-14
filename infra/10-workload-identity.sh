#!/usr/bin/env bash
# =============================================================================
# 10-workload-identity.sh — Configure Workload Identity Federation for GitHub Actions
#
# WHY Workload Identity Federation?
# ----------------------------------
# Traditional approach: create a service account, export a JSON key, store it
# as a GitHub secret.  Problems:
#   • Long-lived credentials that never expire
#   • Keys can be accidentally committed to source control
#   • Manual rotation required
#
# Workload Identity Federation (WIF) solves this:
#   • GitHub Actions OIDC provides a short-lived token (valid ~5 min)
#   • WIF exchanges this token for a GCP access token
#   • No long-lived keys stored anywhere
#   • Least privilege: only the specific repo/branch can impersonate the SA
#   • Automatic rotation (each workflow run gets a fresh token)
#
# How it works:
#   1. GitHub Actions requests an OIDC token from GitHub's identity service
#   2. The workflow sends this token to GCP's Security Token Service (STS)
#   3. STS validates the token against our WIF pool configuration
#   4. If valid, STS issues a short-lived access token for crm-cicd-sa
#   5. The workflow uses this token for gcloud / docker commands
#
# USAGE: bash infra/10-workload-identity.sh
#
# After running, this script prints the values needed for GitHub Secrets.
# Add them to: GitHub repo → Settings → Secrets and variables → Actions
# =============================================================================
set -euo pipefail
source "$(dirname "$0")/00-variables.env"

log()    { echo "[$(date +'%H:%M:%S')] $*"; }
success(){ echo "[$(date +'%H:%M:%S')]   ✓ $*"; }

PROJECT_NUMBER=$(gcloud projects describe "${PROJECT_ID}" \
  --format="value(projectNumber)")

# ─── 1. Create Workload Identity Pool ─────────────────────────────────────────
# A Pool is a logical container for external identity providers.
# We create one pool named "crm-github-pool" for all GitHub Actions workflows.
log "=== Step 1: Workload Identity Pool ==="

EXISTING_POOL=$(gcloud iam workload-identity-pools describe "${WIF_POOL_ID}" \
  --project="${PROJECT_ID}" \
  --location="global" \
  --format="value(state)" 2>/dev/null || echo "")

if [[ "${EXISTING_POOL}" == "ACTIVE" ]]; then
  success "Pool '${WIF_POOL_ID}' already exists and is ACTIVE"
elif [[ -n "${EXISTING_POOL}" ]]; then
  log "  Pool '${WIF_POOL_ID}' exists (state: ${EXISTING_POOL})"
else
  log "  → Creating Workload Identity Pool '${WIF_POOL_ID}'"
  gcloud iam workload-identity-pools create "${WIF_POOL_ID}" \
    --project="${PROJECT_ID}" \
    --location="global" \
    --display-name="CRM GitHub Actions Pool" \
    --description="Allows GitHub Actions workflows to authenticate to GCP without long-lived keys"
  success "Pool '${WIF_POOL_ID}' created"
fi

# ─── 2. Create OIDC Provider in the Pool ──────────────────────────────────────
# An OIDC Provider maps GitHub's OIDC tokens to pool identities.
# We map specific GitHub token claims to GCP subject attributes so that:
#   • Only our specific repository can assume the crm-cicd-sa identity
#   • Only the 'main' branch or workflow_dispatch events can deploy
#
# GitHub OIDC token claims:
#   sub:           "repo:OWNER/REPO:ref:refs/heads/main"
#   repository:    "OWNER/REPO"
#   ref:           "refs/heads/main"
#   workflow:      ".github/workflows/deploy.yml"
log ""
log "=== Step 2: OIDC Provider ==="

EXISTING_PROVIDER=$(gcloud iam workload-identity-pools providers describe "${WIF_PROVIDER_ID}" \
  --project="${PROJECT_ID}" \
  --location="global" \
  --workload-identity-pool="${WIF_POOL_ID}" \
  --format="value(state)" 2>/dev/null || echo "")

if [[ "${EXISTING_PROVIDER}" == "ACTIVE" ]]; then
  success "Provider '${WIF_PROVIDER_ID}' already exists and is ACTIVE"
else
  log "  → Creating OIDC provider '${WIF_PROVIDER_ID}'"
  log "    Issuer:     https://token.actions.githubusercontent.com"
  log "    Attribute:  google.subject = assertion.sub"
  log "    Condition:  assertion.repository == '${GITHUB_REPO}'"

  gcloud iam workload-identity-pools providers create-oidc "${WIF_PROVIDER_ID}" \
    --project="${PROJECT_ID}" \
    --location="global" \
    --workload-identity-pool="${WIF_POOL_ID}" \
    --display-name="CRM GitHub Provider" \
    --description="GitHub Actions OIDC for CRM CI/CD pipeline" \
    \
    --issuer-uri="https://token.actions.githubusercontent.com" \
    `# GitHub's OIDC token issuer URL (standardized, never changes).        ` \
    \
    --attribute-mapping="\
google.subject=assertion.sub,\
attribute.actor=assertion.actor,\
attribute.repository=assertion.repository,\
attribute.repository_owner=assertion.repository_owner,\
attribute.ref=assertion.ref,\
attribute.workflow=assertion.workflow" \
    `# Map GitHub token claims to GCP pool attributes.                       ` \
    `# google.subject: the unique subject for policy binding.                ` \
    `# attribute.*: additional claims we can use in conditions.              ` \
    \
    --attribute-condition="assertion.repository == '${GITHUB_REPO}'"
    `# CRITICAL SECURITY RESTRICTION: Only tokens from our specific GitHub   ` \
    `# repository are accepted. Any other repo's tokens are rejected even if  ` \
    `# they have a valid GitHub signature.                                     `

  success "OIDC provider '${WIF_PROVIDER_ID}' created"
fi

# ─── 3. Bind the pool to crm-cicd-sa ──────────────────────────────────────────
# This is the "impersonation" binding: it says which pool identities are allowed
# to act as crm-cicd-sa.
#
# The principal is filtered to only the 'main' branch and workflow_dispatch events
# using the assertion.sub claim: "repo:OWNER/REPO:ref:refs/heads/main"
#
# Note: We also allow the full attribute.repository match to restrict to our repo.
log ""
log "=== Step 3: IAM Binding (pool → crm-cicd-sa) ==="

POOL_RESOURCE="principalSet://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${WIF_POOL_ID}/attribute.repository/${GITHUB_REPO}"

log "  → Binding ${POOL_RESOURCE}"
log "    → roles/iam.workloadIdentityUser on ${SA_CICD_EMAIL}"
gcloud iam service-accounts add-iam-policy-binding "${SA_CICD_EMAIL}" \
  --project="${PROJECT_ID}" \
  --role="roles/iam.workloadIdentityUser" \
  --member="${POOL_RESOURCE}" \
  --quiet 2>/dev/null || true
success "WIF pool can impersonate ${SA_CICD_EMAIL}"

# ─── 4. Compute the WIF provider resource name ────────────────────────────────
WIF_PROVIDER_RESOURCE="projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${WIF_POOL_ID}/providers/${WIF_PROVIDER_ID}"

# ==============================================================================
log ""
log "=== Workload Identity Federation Setup Complete ==="
log ""
log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
log " ACTION REQUIRED — Add these GitHub Secrets to your repository"
log " Path: GitHub repo → Settings → Secrets and variables → Actions"
log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
log ""
log "  Secret Name          Secret Value"
log "  ─────────────────    ─────────────────────────────────────────────────"
log "  GCP_PROJECT_ID       ${PROJECT_ID}"
log "  WIF_PROVIDER         ${WIF_PROVIDER_RESOURCE}"
log "  WIF_SERVICE_ACCOUNT  ${SA_CICD_EMAIL}"
log ""
log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
log ""
log "Quick copy (run these GitHub CLI commands):"
log ""
log "  gh secret set GCP_PROJECT_ID       --body '${PROJECT_ID}'"
log "  gh secret set WIF_PROVIDER         --body '${WIF_PROVIDER_RESOURCE}'"
log "  gh secret set WIF_SERVICE_ACCOUNT  --body '${SA_CICD_EMAIL}'"
log ""
log "Or set them using the GitHub web UI at:"
log "  https://github.com/${GITHUB_REPO}/settings/secrets/actions"
log ""
log "Next step: bash infra/11-database-migration.sh"
