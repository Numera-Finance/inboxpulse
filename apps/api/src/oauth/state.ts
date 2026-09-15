import * as crypto from 'crypto';

/**
 * OAuth state tokens.
 *
 * The state parameter is written by `/oauth/gmail/authorize` and read back by
 * `/oauth/gmail/callback` — but the browser makes those two requests separately,
 * with a trip through Google's consent screen in between, so Cloud Run is free to
 * route them to different instances. crm-api runs `--min-instances 3`, which made
 * an in-process Map lose the state roughly two times in three and fail the callback
 * with "Invalid or expired authorization request" after Google had already
 * authorized the user.
 *
 * So the state carries its own contents and its own integrity proof, and no
 * instance has to remember anything:
 *
 *   base64url(JSON payload) . base64url(HMAC-SHA256 of that payload)
 *
 * The payload is not secret — it is a tenant id and a user id, both of which the
 * caller already supplied in the URL that produced it. What it needs is to be
 * unforgeable (that is the CSRF defence the state parameter exists for) and fresh.
 * Credentials are deliberately NOT carried here; the callback re-resolves them from
 * the same source `/authorize` used.
 *
 * Replay within the TTL is possible in a way a single-use Map entry prevented. The
 * backstop is Google's authorization code, which is itself single-use: a replayed
 * state arrives with a code that has already been exchanged, and `getToken` rejects
 * it.
 */

const TOKEN_VERSION = 1;

/** How long a user may sit on Google's consent screen before the state goes stale. */
export const OAUTH_STATE_TTL_SECONDS = 10 * 60;

export interface OAuthState {
  tenantId: string;
  userId?: string;
}

/**
 * Verification distinguishes the two failures rather than merging them: a state
 * that went stale on a consent screen is the user's to retry, and a state that does
 * not verify is a forged or corrupted request. They call for different responses,
 * so they are different results.
 */
export type OAuthStateResult =
  | { status: 'valid'; state: OAuthState }
  | { status: 'expired'; ageSeconds: number }
  | { status: 'invalid'; reason: string };

interface StatePayload {
  v: number;
  t: string;
  u?: string;
  iat: number;
  /** Random per-token, so two authorize calls for the same tenant differ. */
  n: string;
}

/**
 * The signing key must be byte-identical on every instance, because the instance
 * that verifies a token is almost never the one that signed it. That rules out any
 * per-process default — a randomly generated fallback would reintroduce exactly the
 * cross-instance failure this module replaces, while looking like it worked in
 * single-instance local dev. So: no default, and a loud throw when it is absent.
 *
 * ENCRYPTION_SECRET and BETTER_AUTH_SECRET are both mounted on crm-api from Secret
 * Manager (see .github/workflows/deploy.yml), so either is shared fleet-wide.
 */
function getSigningKey(): Buffer {
  const secret = process.env.ENCRYPTION_SECRET || process.env.BETTER_AUTH_SECRET;

  if (!secret) {
    throw new Error(
      'Cannot sign OAuth state: set ENCRYPTION_SECRET (or BETTER_AUTH_SECRET). ' +
      'It must be the same value on every crm-api instance.'
    );
  }

  return crypto.createHash('sha256').update(secret).digest();
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

function sign(encodedPayload: string): string {
  return crypto.createHmac('sha256', getSigningKey()).update(encodedPayload).digest('base64url');
}

export function signOAuthState(state: OAuthState, now: Date = new Date()): string {
  const payload: StatePayload = {
    v: TOKEN_VERSION,
    t: state.tenantId,
    u: state.userId,
    iat: Math.floor(now.getTime() / 1000),
    n: crypto.randomBytes(9).toString('base64url'),
  };

  const encodedPayload = base64url(JSON.stringify(payload));

  return `${encodedPayload}.${sign(encodedPayload)}`;
}

export function verifyOAuthState(token: string, now: Date = new Date()): OAuthStateResult {
  if (!token) {
    return { status: 'invalid', reason: 'empty state' };
  }

  const parts = token.split('.');
  if (parts.length !== 2) {
    return { status: 'invalid', reason: 'malformed state' };
  }

  const [encodedPayload, providedSignature] = parts;

  // Compare before parsing: an unverified payload is attacker-controlled bytes.
  const expected = Buffer.from(sign(encodedPayload), 'utf8');
  const provided = Buffer.from(providedSignature, 'utf8');

  if (expected.length !== provided.length || !crypto.timingSafeEqual(expected, provided)) {
    return { status: 'invalid', reason: 'signature mismatch' };
  }

  let payload: StatePayload;
  try {
    payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
  } catch {
    return { status: 'invalid', reason: 'unreadable payload' };
  }

  if (payload.v !== TOKEN_VERSION) {
    return { status: 'invalid', reason: `unsupported state version ${payload.v}` };
  }

  if (typeof payload.t !== 'string' || payload.t.length === 0) {
    return { status: 'invalid', reason: 'missing tenantId' };
  }

  if (typeof payload.iat !== 'number' || !Number.isFinite(payload.iat)) {
    return { status: 'invalid', reason: 'missing issue time' };
  }

  const ageSeconds = Math.floor(now.getTime() / 1000) - payload.iat;

  // A token issued in the future is clock skew or tampering, not freshness. Allow a
  // small skew between instances and reject the rest rather than reading it as fresh.
  if (ageSeconds < -60) {
    return { status: 'invalid', reason: 'issued in the future' };
  }

  if (ageSeconds > OAUTH_STATE_TTL_SECONDS) {
    return { status: 'expired', ageSeconds };
  }

  return {
    status: 'valid',
    state: { tenantId: payload.t, userId: payload.u },
  };
}
