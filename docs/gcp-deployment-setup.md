# GCP Deployment Setup Guide

This document contains all the GCP commands needed to deploy the CRM application to a customer's GCP instance.

## Prerequisites

- Google Cloud Project created
- `gcloud` CLI installed and authenticated
- Billing enabled on the project
- Required APIs enabled (see below)

## Environment Variables

Set these variables before running commands:

```bash
export PROJECT_ID="your-project-id"
export REGION="us-central1"
```

## 1. Enable Required APIs

```bash
# Enable Cloud Run API
gcloud services enable run.googleapis.com --project=$PROJECT_ID

# Enable Cloud Build API
gcloud services enable cloudbuild.googleapis.com --project=$PROJECT_ID

# Enable Container Registry API
gcloud services enable containerregistry.googleapis.com --project=$PROJECT_ID

# Enable Pub/Sub API
gcloud services enable pubsub.googleapis.com --project=$PROJECT_ID

# Enable Gmail API
gcloud services enable gmail.googleapis.com --project=$PROJECT_ID

# Enable Secret Manager API (if using secrets)
gcloud services enable secretmanager.googleapis.com --project=$PROJECT_ID
```

## 2. Deploy Services to Cloud Run

### Deploy API Service

```bash
gcloud run deploy crm-api \
  --source ./apps/api \
  --platform managed \
  --region=$REGION \
  --allow-unauthenticated \
  --set-env-vars="DATABASE_URL=your-database-url,NODE_ENV=production" \
  --project=$PROJECT_ID
```

### Deploy Gmail Service

```bash
gcloud run deploy crm-gmail \
  --source ./apps/gmail \
  --platform managed \
  --region=$REGION \
  --set-env-vars="DATABASE_URL=your-database-url,GOOGLE_CLOUD_PROJECT=$PROJECT_ID,NODE_ENV=production,GMAIL_PUBSUB_TOPIC=projects/$PROJECT_ID/topics/crm-gmail-push" \
  --project=$PROJECT_ID
```

### Deploy Web Service

```bash
gcloud run deploy crm-web \
  --source ./apps/web \
  --platform managed \
  --region=$REGION \
  --allow-unauthenticated \
  --set-env-vars="VITE_API_URL=https://your-api-url" \
  --project=$PROJECT_ID
```

## 3. Set Up Gmail Pub/Sub Pipeline

**IMPORTANT: Run this AFTER deploying the Gmail service.** The script needs the Cloud Run URL to configure the push subscription.

This sets up the full Pub/Sub pipeline: topic, IAM permissions, service account, and authenticated push subscription.

```bash
./scripts/setup-gmail-pubsub.sh $PROJECT_ID $REGION
```

The script performs these steps:
1. Creates Pub/Sub topic `crm-gmail-push`
2. Grants Gmail API (`gmail-api-push@system.gserviceaccount.com`) permission to publish to the topic
3. Creates a `pubsub-invoker` service account for authenticated push delivery
4. Grants the service account `roles/run.invoker` on `crm-gmail`
5. Grants the Pub/Sub service agent `roles/iam.serviceAccountTokenCreator` (required to mint OIDC tokens for the invoker SA)
6. Creates a push subscription `crm-gmail-push-sub` pointing to `https://<crm-gmail-url>/webhooks/pubsub`

The script is idempotent — safe to re-run if any step was already completed.

### Verify Pub/Sub Setup

```bash
# Check topic exists
gcloud pubsub topics describe crm-gmail-push --project=$PROJECT_ID

# Check subscription has correct push endpoint and auth
gcloud pubsub subscriptions describe crm-gmail-push-sub --project=$PROJECT_ID \
  --format="yaml(pushConfig,topic)"

# Check IAM on Cloud Run service
gcloud run services get-iam-policy crm-gmail --region=$REGION --project=$PROJECT_ID
```

### Update API Service Environment

After running the script, ensure the API service can reach the Gmail service for watch setup during OAuth:

```bash
GMAIL_SERVICE_URL=$(gcloud run services describe crm-gmail --region=$REGION --project=$PROJECT_ID --format="value(status.url)")

gcloud run services update crm-api \
  --region=$REGION \
  --project=$PROJECT_ID \
  --update-env-vars="SERVICE_GMAIL_URL=$GMAIL_SERVICE_URL"
```

## 4. Additional IAM Permissions

## 5. Database Setup

### Create PostgreSQL Database

If using Cloud SQL:

```bash
# Create Cloud SQL instance
gcloud sql instances create crm-db \
  --database-version=POSTGRES_15 \
  --tier=db-f1-micro \
  --region=$REGION \
  --project=$PROJECT_ID

# Create database
gcloud sql databases create crm \
  --instance=crm-db \
  --project=$PROJECT_ID

# Set root password
gcloud sql users set-password postgres \
  --instance=crm-db \
  --password=YOUR_SECURE_PASSWORD \
  --project=$PROJECT_ID
```

### Run Database Migrations

```bash
# Connect to database and run schema
psql $DATABASE_URL -f sql/schema.sql
```

## 6. Insert Gmail Integration (Per Tenant)

For each tenant that connects Gmail:

```bash
# Use the SQL script to insert integration
# Replace placeholders with actual values
psql $DATABASE_URL -f scripts/insert-gmail-integration.sql
```

Or use the TypeScript script:

```bash
TENANT_ID="tenant-uuid" \
EMAIL="user@example.com" \
CLIENT_ID="oauth-client-id" \
CLIENT_SECRET="oauth-client-secret" \
REFRESH_TOKEN="oauth-refresh-token" \
HISTORY_ID="gmail-history-id" \
DATABASE_URL="postgresql://..." \
pnpm exec tsx scripts/insert-gmail-integration.ts
```

## 7. Setup OAuth 2.0 Credentials

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Navigate to **APIs & Services > Credentials**
3. Click **Create Credentials > OAuth 2.0 Client ID**
4. Application type: **Web application**
5. Add authorized redirect URIs:
   - `http://localhost:3000/auth/callback` (for local development)
   - `https://your-domain.com/auth/callback` (for production)
6. Save Client ID and Client Secret

## 8. Enable Gmail Watch (Per Tenant)

The Gmail watch is set up **automatically** when a user connects Gmail via OAuth in the web UI. The OAuth callback in `crm-api` calls the Gmail service to:
1. Register a Gmail watch (push notifications to Pub/Sub topic)
2. Trigger an initial sync (last 30 days of emails)

The watch expires after 7 days and is auto-renewed by the watch renewal cron endpoint (`GET /api/watch/renew-expiring`) which runs every 4 hours.

To manually set up or renew a watch:

```bash
GMAIL_SERVICE_URL=$(gcloud run services describe crm-gmail --region=$REGION --project=$PROJECT_ID --format="value(status.url)")
SERVICE_API_KEY=$(gcloud secrets versions access latest --secret=SERVICE_API_KEY --project=$PROJECT_ID)

# Set up watch
curl -X POST "$GMAIL_SERVICE_URL/api/watch?tenantId=<TENANT_ID>" \
  -H "x-internal-api-key: $SERVICE_API_KEY"

# Trigger initial sync
curl -X POST "$GMAIL_SERVICE_URL/api/sync/<TENANT_ID>/initial" \
  -H "x-internal-api-key: $SERVICE_API_KEY"
```

## Verification

### Check Deployment Status

```bash
# List Cloud Run services
gcloud run services list --project=$PROJECT_ID

# Check Pub/Sub topic
gcloud pubsub topics list --project=$PROJECT_ID

# Check Pub/Sub subscription
gcloud pubsub subscriptions list --project=$PROJECT_ID

# View logs
gcloud logging read "resource.type=cloud_run_revision" --limit=50 --project=$PROJECT_ID
```

### Test Gmail Webhook

Send a test email to the monitored Gmail account and check:

1. Cloud Run logs for webhook requests
2. Database for new email records
3. Pub/Sub metrics for delivered messages

## Troubleshooting

### No webhooks received

1. Check Pub/Sub subscription exists and points to correct endpoint:
   `gcloud pubsub subscriptions describe crm-gmail-push-sub --project=$PROJECT_ID`
2. Verify Gmail API publish permission on the topic:
   `gcloud pubsub topics get-iam-policy crm-gmail-push --project=$PROJECT_ID`
3. Check `pubsub-invoker` service account has `roles/run.invoker` on `crm-gmail`
4. Verify the Pub/Sub service agent has `roles/iam.serviceAccountTokenCreator` (needed to mint OIDC tokens)
5. Check `SERVICE_GMAIL_URL` on `crm-api` points to the **current** Cloud Run URL (URLs change on redeployment)
6. Review Cloud Run logs: `gcloud logging read 'resource.labels.service_name="crm-gmail"' --project=$PROJECT_ID --limit=20`

### Database connection issues

1. Verify DATABASE_URL environment variable is set
2. Check Cloud SQL instance is running
3. Verify network connectivity (Cloud Run to Cloud SQL)
4. Check database credentials

### OAuth issues

1. Verify OAuth client ID and secret are correct
2. Check redirect URIs match exactly
3. Ensure Gmail API is enabled
4. Verify refresh token is not expired

## Security Recommendations

1. **Use Secret Manager** for sensitive data (database passwords, OAuth secrets)
2. **Enable VPC Connector** for secure database connections
3. **Restrict Cloud Run ingress** to Pub/Sub and load balancer only
4. **Enable audit logging** for compliance
5. **Use service accounts** with minimal required permissions
6. **Implement encryption** for sensitive data in database (currently disabled for simplicity)

## Cost Optimization

1. **Set minimum instances to 0** for Cloud Run services (scale to zero when idle)
2. **Use Cloud SQL read replicas** only if needed
3. **Set Pub/Sub message retention** to reasonable period (7 days default)
4. **Monitor quota usage** to avoid unexpected charges
5. **Use preemptible VMs** for batch processing if applicable

## Maintenance

### Daily Auto-Renewal

The `renewWatch` Inngest function runs daily at 2 AM UTC to renew Gmail watch subscriptions before they expire (7-day expiration).

### Manual Watch Renewal

If needed, manually renew a watch:

```bash
# Use your application's admin API or run a script
pnpm exec tsx scripts/renew-watch.ts
```

### Update Deployments

```bash
# Redeploy a service after code changes
gcloud run deploy SERVICE_NAME \
  --source ./apps/SERVICE_NAME \
  --region=$REGION \
  --project=$PROJECT_ID
```
