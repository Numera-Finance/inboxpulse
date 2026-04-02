#!/usr/bin/env bash
#
# Sets up the Gmail Pub/Sub pipeline for the CRM Gmail service on Cloud Run.
#
# This script:
#   1. Creates the Pub/Sub topic
#   2. Grants Gmail API permission to publish to the topic
#   3. Creates a service account for authenticated push delivery
#   4. Grants the service account Cloud Run Invoker on crm-gmail
#   5. Grants the Pub/Sub service agent Token Creator (to mint OIDC tokens)
#   6. Creates a push subscription pointing to the Cloud Run webhook
#
# Usage:
#   ./scripts/setup-gmail-pubsub.sh <PROJECT_ID> [REGION]
#
# Example:
#   ./scripts/setup-gmail-pubsub.sh project-y-email-sentiment us-central1

set -euo pipefail

PROJECT_ID="${1:?Usage: $0 <PROJECT_ID> [REGION]}"
REGION="${2:-us-central1}"

TOPIC="crm-gmail-push"
SUBSCRIPTION="crm-gmail-push-sub"
SERVICE_ACCOUNT="pubsub-invoker"
CLOUD_RUN_SERVICE="crm-gmail"

echo "==> Setting up Gmail Pub/Sub for project: $PROJECT_ID (region: $REGION)"

# Get project number (needed for Pub/Sub service agent)
PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format="value(projectNumber)")
echo "    Project number: $PROJECT_NUMBER"

# Get Cloud Run service URL
GMAIL_SERVICE_URL=$(gcloud run services describe "$CLOUD_RUN_SERVICE" \
  --region="$REGION" \
  --project="$PROJECT_ID" \
  --format="value(status.url)" 2>/dev/null || true)

if [ -z "$GMAIL_SERVICE_URL" ]; then
  echo "ERROR: Cloud Run service '$CLOUD_RUN_SERVICE' not found in $REGION."
  echo "       Deploy the Gmail service first, then re-run this script."
  exit 1
fi
echo "    Gmail service URL: $GMAIL_SERVICE_URL"

# 1. Create Pub/Sub topic
echo ""
echo "==> Step 1: Creating Pub/Sub topic '$TOPIC'"
if gcloud pubsub topics describe "$TOPIC" --project="$PROJECT_ID" &>/dev/null; then
  echo "    Topic already exists, skipping."
else
  gcloud pubsub topics create "$TOPIC" --project="$PROJECT_ID"
  echo "    Topic created."
fi

# 2. Grant Gmail permission to publish
echo ""
echo "==> Step 2: Granting Gmail API publish permission"
gcloud pubsub topics add-iam-policy-binding "$TOPIC" \
  --project="$PROJECT_ID" \
  --member="serviceAccount:gmail-api-push@system.gserviceaccount.com" \
  --role="roles/pubsub.publisher" \
  --quiet
echo "    Done."

# 3. Create service account for authenticated push
echo ""
echo "==> Step 3: Creating service account '$SERVICE_ACCOUNT'"
if gcloud iam service-accounts describe "$SERVICE_ACCOUNT@$PROJECT_ID.iam.gserviceaccount.com" --project="$PROJECT_ID" &>/dev/null; then
  echo "    Service account already exists, skipping."
else
  gcloud iam service-accounts create "$SERVICE_ACCOUNT" \
    --project="$PROJECT_ID" \
    --display-name="Pub/Sub Cloud Run Invoker"
  echo "    Service account created."
fi

# 4. Grant Cloud Run Invoker role
echo ""
echo "==> Step 4: Granting Cloud Run Invoker role to service account"
gcloud run services add-iam-policy-binding "$CLOUD_RUN_SERVICE" \
  --region="$REGION" \
  --project="$PROJECT_ID" \
  --member="serviceAccount:$SERVICE_ACCOUNT@$PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/run.invoker" \
  --quiet
echo "    Done."

# 5. Grant Token Creator to Pub/Sub service agent
echo ""
echo "==> Step 5: Granting Token Creator to Pub/Sub service agent"
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:service-${PROJECT_NUMBER}@gcp-sa-pubsub.iam.gserviceaccount.com" \
  --role="roles/iam.serviceAccountTokenCreator" \
  --quiet
echo "    Done."

# 6. Create push subscription
echo ""
echo "==> Step 6: Creating push subscription '$SUBSCRIPTION'"
PUSH_ENDPOINT="$GMAIL_SERVICE_URL/webhooks/pubsub"

if gcloud pubsub subscriptions describe "$SUBSCRIPTION" --project="$PROJECT_ID" &>/dev/null; then
  echo "    Subscription already exists, updating push config."
  gcloud pubsub subscriptions modify-push-config "$SUBSCRIPTION" \
    --project="$PROJECT_ID" \
    --push-endpoint="$PUSH_ENDPOINT" \
    --push-auth-service-account="$SERVICE_ACCOUNT@$PROJECT_ID.iam.gserviceaccount.com"
else
  gcloud pubsub subscriptions create "$SUBSCRIPTION" \
    --project="$PROJECT_ID" \
    --topic="$TOPIC" \
    --push-endpoint="$PUSH_ENDPOINT" \
    --push-auth-service-account="$SERVICE_ACCOUNT@$PROJECT_ID.iam.gserviceaccount.com" \
    --ack-deadline=60
fi
echo "    Push endpoint: $PUSH_ENDPOINT"

# Summary
echo ""
echo "============================================"
echo "  Gmail Pub/Sub setup complete!"
echo "============================================"
echo ""
echo "  Topic:          $TOPIC"
echo "  Subscription:   $SUBSCRIPTION"
echo "  Push endpoint:   $PUSH_ENDPOINT"
echo "  Service account: $SERVICE_ACCOUNT@$PROJECT_ID.iam.gserviceaccount.com"
echo ""
echo "Next steps:"
echo "  1. Ensure GMAIL_PUBSUB_TOPIC env var on crm-gmail is set to:"
echo "     projects/$PROJECT_ID/topics/$TOPIC"
echo "  2. Ensure SERVICE_GMAIL_URL env var on crm-api points to:"
echo "     $GMAIL_SERVICE_URL"
echo "  3. Connect Gmail via OAuth in the web UI — watch + initial sync happen automatically."
echo ""
