# OAuth Integration

This module provides OAuth 2.0 authorization endpoints for integrating with Gmail API.

## Endpoints

### `GET /oauth/gmail/authorize`

Initiates the OAuth authorization flow. Redirects the user to Google's consent screen.

**Requires a signed-in session.** The tenant is taken from that session, not from
the URL. `tenantId` may still be passed and is then checked against the session —
a mismatch is refused with 403 — but it cannot select the tenant. Before that, any
caller could aim a victim's consent at a tenant of their choosing.

**Query Parameters:**

- `tenantId` (optional): asserted against the session's tenant; refused on mismatch

Identity is never taken from the URL. `createdBy` is resolved from the session to a
`users.id` — a different id space from the better-auth id the browser holds, and a
`uuid` column, so forwarding the client's id both misattributed the connection and
made Postgres reject the write.

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

## The `state` parameter

`state` is a signed, self-contained token (`state.ts`), not a key into a server-side
store:

```
base64url({ v, t: tenantId, u: userId, iat, n: nonce }) . base64url(HMAC-SHA256)
```

**It used to be an in-process `Map`, and that was a production bug.** `/authorize`
and `/callback` are two separate browser requests with Google's consent screen
between them, so Cloud Run routes them independently. crm-api runs
`--min-instances 3`, so the callback landed on the instance that held the state
roughly one time in three; the rest returned
`Invalid or expired authorization request` after Google had already authorized the
user. Any deploy mid-flow did the same. Nothing about an in-flight authorization is
retained in a process now — `state.test.ts` reads `routes.ts` and fails if a `Map`,
`Set` or sweeper timer reappears.

- **Signing key**: `ENCRYPTION_SECRET`, from Secret Manager, so every instance
  derives the same key. There is deliberately **no default and no fallback to a
  second variable** — either would let one instance derive a key no other instance
  derives, which is the same cross-instance failure the `Map` had. Absent it, the
  flow throws rather than signing something unverifiable.
- **Expiration**: 10 minutes (`OAUTH_STATE_TTL_SECONDS`), plus 60s of tolerated
  clock skew.
- **Replay**: a state is replayable inside its TTL, which the single-use `Map` entry
  was not. The backstop is Google's authorization code, which is itself single-use —
  a replayed state arrives with a code `getToken` rejects.
- **Credentials are not in the token.** The callback re-resolves them through
  `resolveOAuthCredentials(tenantId)`, the same function `/authorize` used, so both
  ends present the same `client_id` to Google. Passing a client secret as a query
  parameter is no longer supported: it put a secret in the Cloud Run request log,
  and nothing called it.
- **Token Storage**: Refresh tokens are securely stored in the database (encrypted at
  rest)

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

The callback redirects to `${WEB_URL}/settings?tab=integrations` with an `oauth` and
a `reason` parameter. It links that route directly because `/integrations` is a
`<Navigate ... replace>` in the web router that **drops the query string**, which
discarded the outcome.

| `reason` | Meaning | What the user should do |
|---|---|---|
| — (`oauth=success`) | Connected | nothing |
| `denied` | Declined consent at Google | nothing; reconnect when ready |
| `expired` | Sat on the consent screen longer than the TTL | press Connect again |
| `invalid` | State failed signature checks, or `code`/`state` was missing | start again from Settings; if it repeats, the signing secret differs between instances |
| `google-error` | Google returned an error other than a decline | try again |
| `tenant-mismatch` | `tenantId` disagreed with the session's tenant | retry from Settings; a stale client, or a crafted link |
| `no-tenant` | Session has no tenant | contact support |
| `setup-failed` | Server is missing OAuth configuration | contact support; the detail is in the logs, never in the response |
| `exchange-failed` | Google accepted the user but the token exchange or setup failed | read `error`; commonly a missing refresh token needing [access revoked](https://myaccount.google.com/permissions) first |

`expired` and `invalid` are reported separately on purpose: only the first is fixed
by pressing the button again, and the single merged message they replaced could not
tell a user which situation they were in.

A caller with no session is sent to `/login?next=/settings?tab=integrations` rather
than to a result page: `/settings` is behind `ProtectedRoute`, so a "please sign in"
toast there would only ever be read by someone who had just signed in.

**Nothing reflects caller input into markup or into a response body.** The callback
used to interpolate its `error` query parameter into an HTML page served from the
crm-api origin, which is also `BETTER_AUTH_URL` — so a crafted link ran script
against the victim's session cookies. Every outcome is now a redirect carrying one
of the `reason` values above and a message chosen here. `/authorize` likewise
returns a fixed message on failure: its internal errors name environment variables
and the route is reachable without a session, so the detail stays in the logs.

All errors are logged to the application logs with structured logging for debugging.
