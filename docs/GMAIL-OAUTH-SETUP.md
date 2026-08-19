# Gmail OAuth Setup Guide

> **Corrected 2026-08-18.** Every command in this file used to name the
> **retired** project `health-474623`, and the tooling it calls still runs — so
> following it executed real commands against a dead project. Pointing gcloud
> there fails as a *permission* error rather than "no such project", because
> the account can only see the live one, so the symptom reads like missing IAM.
> The live project is `project-y-email-sentiment` (`203731638840`) and the live
> OAuth client is `crm-oauth` (`203731638840-…`), not `505023465535-…`.

This guide helps you set up Gmail API access using OAuth for personal Gmail accounts without publishing an app.

## Overview

The setup supports two modes:
1. **Personal Mode**: OAuth credentials stored in Secret Manager (simpler, for single user)
2. **Multi-tenant Mode**: Credentials stored in database (for multiple users)

This guide covers Personal Mode setup.

## Prerequisites

- Google Cloud Project with billing enabled
- Personal Gmail account
- `gcloud` CLI installed and authenticated

## Step 1: Run Pub/Sub Setup Script

This creates the Pub/Sub topic and grants Gmail permission to publish notifications.

```bash
./scripts/setup-gmail-pubsub.sh project-y-email-sentiment
```

**Note**: You'll create the subscription later once you have the Cloud Run URL.

## Step 2: Create OAuth 2.0 Credentials

### 2.1 Configure OAuth Consent Screen

1. Go to [APIs & Credentials](https://console.cloud.google.com/apis/credentials?project=project-y-email-sentiment)
2. Click **"OAuth consent screen"** in the left sidebar
3. Choose **"External"** user type (required for personal Gmail)
4. Fill in the required fields:
   - **App name**: CRM Gmail Sync
   - **User support email**: your@gmail.com
   - **Developer contact**: your@gmail.com
5. Click **"Save and Continue"**
6. On **"Scopes"** page, click **"Save and Continue"** (we'll add scopes programmatically)
7. On **"Test users"** page:
   - Click **"+ ADD USERS"**
   - Add your Gmail address
   - Click **"Save and Continue"**
8. Review and click **"Back to Dashboard"**

### 2.2 Create OAuth Client ID

1. Go back to **"Credentials"** tab
2. Click **"+ CREATE CREDENTIALS"** → **"OAuth client ID"**
3. Choose **Application type**:
   - **Desktop app** (recommended for personal use)
   - OR **Web application** (if you prefer web-based auth)
4. **Name**: CRM Gmail OAuth
5. For Web application, add **Authorized redirect URIs**:
   - `http://localhost:3000/oauth/callback`
6. Click **"Create"**
7. **Download the JSON** file (click the download button)
8. Save it somewhere safe (e.g., `~/Downloads/gmail-oauth-credentials.json`)

## Step 3: Run OAuth Setup Script

This script will:
1. Open OAuth flow in your browser
2. Get your authorization
3. Store credentials in Secret Manager

```bash
pnpm oauth:setup ~/Downloads/gmail-oauth-credentials.json project-y-email-sentiment default
```

Follow the prompts:
1. Click the URL that appears
2. Sign in with your Gmail account
3. Click **"Continue"** on the unverified app warning (this is safe for your own app)
4. Grant the requested permissions
5. Copy the authorization code
6. Paste it into the terminal

✅ Your OAuth credentials are now stored in Secret Manager as `gmail-oauth-default`

## Step 4: Create Pub/Sub Subscription

Once your Gmail service is deployed to Cloud Run, create the subscription:

```bash
# Get your Cloud Run URL
CLOUD_RUN_URL=$(gcloud run services describe crm-gmail --region us-central1 --format 'value(status.url)')

# Create subscription
gcloud pubsub subscriptions create gmail-notifications-sub \
  --topic=gmail-notifications \
  --push-endpoint=${CLOUD_RUN_URL}/webhooks/gmail \
  --project=project-y-email-sentiment
```

## Step 5: Set Up Gmail Watch

Use the Gmail service API to enable push notifications:

```bash
curl -X POST "${CLOUD_RUN_URL}/api/sync/start" \
  -H "X-Tenant-ID: default" \
  -H "Content-Type: application/json"
```

This will:
1. Get the current history ID
2. Set up Gmail watch on your inbox
3. Gmail will now send notifications to your Pub/Sub topic

## Testing

Send yourself a test email and check the logs:

```bash
gcloud run logs read crm-gmail --region us-central1 --limit 50
```

You should see:
- "Received Gmail webhook notification"
- "Processing history changes"
- Email being parsed and stored

## Troubleshooting

### "No refresh token received"

**Solution**: Revoke previous access and try again:
1. Go to https://myaccount.google.com/permissions
2. Find "CRM Gmail Sync" and click **"Remove Access"**
3. Run `pnpm oauth:setup` again

### "App not verified" warning

This is expected for apps in Testing mode. Click **"Continue"** to proceed (safe for your own app).

### "Access blocked: This app's request is invalid"

Check that:
1. Your email is added as a test user in OAuth consent screen
2. Redirect URI matches exactly (including http:// vs https://)

### "Webhook not receiving notifications"

Check that:
1. Pub/Sub subscription is created with correct endpoint
2. Gmail watch is active (expires after 7 days, need to renew)
3. Cloud Run service has `--allow-unauthenticated` flag

## Reusing for Another Project

To set up Gmail OAuth on a different Google Cloud project:

```bash
# 1. Run Pub/Sub setup
./scripts/setup-gmail-pubsub.sh <new-project-id>

# 2. Create OAuth credentials in new project's console
# 3. Run OAuth setup
pnpm oauth:setup ~/Downloads/new-credentials.json <new-project-id> default

# 4. Deploy your services
# 5. Create Pub/Sub subscription with new Cloud Run URL
```

## Secret Manager Reference

The OAuth setup stores credentials in this format:

```json
{
  "client_id": "...",
  "client_secret": "...",
  "refresh_token": "..."
}
```

**Secret name**: `gmail-oauth-{tenantId}`

For personal use, use `tenantId = "default"` which creates `gmail-oauth-default`.

## Security Notes

1. **Keep credentials.json safe** - It contains your OAuth client secret
2. **Testing mode** - Your app stays in testing mode, limiting to test users only
3. **Refresh tokens** - Never expire unless revoked, rotate periodically
4. **Secret Manager** - Credentials are encrypted at rest
5. **Allow-unauthenticated** - Anyone can call webhooks, but they're verified by Pub/Sub signature

## Gmail API Quotas

Free tier quotas (per day):
- **Queries**: 1 billion
- **Send mail**: 2,000 (not used in this app)
- **Push notifications**: Unlimited

Should be plenty for personal use!
