# OAuth Integration

This module provides OAuth 2.0 authorization endpoints for integrating with Gmail API.

## Endpoints

### `GET /oauth/gmail/authorize`

Initiates the OAuth authorization flow. Redirects the user to Google's consent screen.

**Query Parameters:**

- `tenantId` (required): The tenant ID to authorize Gmail for

**Example:**

```
https://crm-api-yn7zwaf2za-uc.a.run.app/oauth/gmail/authorize?tenantId=019a8e88-7fcb-7235-b427-25b77fed0563
```

**Flow:**

1. User clicks the authorization link
2. User is redirected to Google's consent screen
3. User authorizes the application
4. Google redirects back to `/oauth/gmail/callback` with an authorization code
5. The API exchanges the code for a refresh token and saves it to the database
6. User sees a success page

### `GET /oauth/gmail/callback`

OAuth callback endpoint. Google redirects here after user authorization.

**Query Parameters:**

- `code`: Authorization code from Google
- `state`: CSRF protection token

**Note:** This endpoint is called automatically by Google. Users should not call it directly.

## Configuration

### Environment Variables

- `SERVICE_API_URL`: The base URL of your API service (e.g., `https://crm-api-yn7zwaf2za-uc.a.run.app`)
  - Used to construct the OAuth redirect URI
  - Defaults to `http://localhost:{PORT}` if not set

### Google Cloud Console Setup

To use these OAuth endpoints in production, you need to add the callback URL to your Google OAuth consent screen:

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Select your project
3. Navigate to **APIs & Services** > **Credentials**
4. Click on your OAuth 2.0 Client ID
5. Under **Authorized redirect URIs**, add:
   ```
   https://crm-api-yn7zwaf2za-uc.a.run.app/oauth/gmail/callback
   ```
6. Click **Save**

**For local development**, add:

```
http://localhost:4000/oauth/gmail/callback
```

## Required Scopes

The OAuth flow requests the following Gmail API scopes:

- `https://www.googleapis.com/auth/gmail.readonly` - Read Gmail messages
- `https://www.googleapis.com/auth/gmail.modify` - Modify Gmail messages (labels, etc.)

## Security Features

- **CSRF Protection**: Uses state tokens to prevent cross-site request forgery
- **State Expiration**: OAuth states expire after 10 minutes
- **Token Storage**: Refresh tokens are securely stored in the database (encrypted at rest)

## Usage Examples

### In a Web Application

Add an "Authorize Gmail" button in your web UI:

```html
<a
  href="https://crm-api-yn7zwaf2za-uc.a.run.app/oauth/gmail/authorize?tenantId=YOUR_TENANT_ID"
>
  Authorize Gmail Access
</a>
```

### For Testing (cURL)

```bash
# This will redirect, so use a browser instead
curl "http://localhost:4000/oauth/gmail/authorize?tenantId=019a8e88-7fcb-7235-b427-25b77fed0563"
```

## Comparison with Script-based OAuth

| Feature             | API Service OAuth          | Script-based OAuth        |
| ------------------- | -------------------------- | ------------------------- |
| User-facing         | ✅ Yes (web UI)            | ❌ No (developer only)    |
| Redirect URI        | Production URL             | localhost:3000            |
| Use case            | Self-service authorization | One-time token refresh    |
| Requires deployment | ✅ Yes                     | ❌ No                     |
| End-user friendly   | ✅ Yes                     | ❌ No (requires terminal) |

## Error Handling

The endpoints return user-friendly HTML error pages with:

- Authorization errors (e.g., user denied access)
- Missing refresh token (e.g., need to revoke previous access)
- Invalid state tokens (CSRF protection)
- Missing credentials in database

All errors are logged to the application logs with structured logging for debugging.
