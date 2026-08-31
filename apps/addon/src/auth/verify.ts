import { OAuth2Client } from 'google-auth-library';
import { getEnv } from '../env';
import { logger } from '../utils/logger';
import type { AddonEvent } from '../gmail/event';

const oauth = new OAuth2Client();

export interface VerifiedRequest {
  ok: boolean;
  /** The signed-in Gmail user's verified email, when available. */
  email?: string;
  reason?: string;
}

async function verifyToken(idToken: string, audience: string) {
  // audience '' -> undefined: verify Google signature + issuer + expiry, skip aud.
  const ticket = await oauth.verifyIdToken({ idToken, audience: audience || undefined });
  return ticket.getPayload();
}

function bearerOf(authHeader?: string): string | undefined {
  return authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : undefined;
}

/** Best-effort email from an UNVERIFIED JWT — dev-mode only. */
function unsafeEmail(jwt?: string): string | undefined {
  if (!jwt) return undefined;
  try {
    return JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString('utf8')).email;
  } catch {
    return undefined;
  }
}

/**
 * Confirm a trigger request genuinely came from Google, and extract the
 * signed-in user's email.
 *
 * Only Google can mint an ID token that verifies against Google's public certs
 * with issuer accounts.google.com — so verifying ANY Google-signed token in the
 * request proves the caller is Google. We try, in order, the Authorization
 * bearer, the event `systemIdToken`, then `userIdToken` (robust to however
 * Google delivers it). The user's email comes from the signature-verified
 * `userIdToken`.
 *
 * ADDON_AUDIENCE, when set, tightens the origin check to that exact audience;
 * blank verifies signature + issuer only — looser, but immune to audience
 * guesswork. Tighten it once the real `aud` claim shows up in the logs.
 *
 * When ADDON_VERIFY_ID_TOKEN !== 'true' (local dev), enforcement is skipped.
 */
export async function verifyRequest(
  authHeader: string | undefined,
  event: AddonEvent,
): Promise<VerifiedRequest> {
  const env = getEnv();
  const auth = event.authorizationEventObject ?? {};
  const userIdToken = auth.userIdToken;

  if (env.ADDON_VERIFY_ID_TOKEN !== 'true') {
    // Dev only, and everything here is unverified by construction — this branch
    // has already decided not to check anything.
    //
    // Order matters. A real (if unverified) token still describes the actual
    // signed-in mailbox, so it outranks a caller's assertion; the caller's
    // assertion outranks the pinned env default, so one add-on can serve several
    // testers without a restart. `|| undefined` and not `?? undefined`: an empty
    // ADDON_DEV_VIEWER_EMAIL must read as "nobody said", or resolveViewer is
    // called with '' and returns `unreachable` instead of being skipped.
    //
    // NOTHING BELOW THIS RETURN MAY READ devViewerEmail. Once verification is
    // on, identity comes from Google's signature alone — a caller-supplied
    // address there would be an impersonation route into entitlement-scoped
    // data.
    const claimed =
      unsafeEmail(userIdToken) || event.devViewerEmail || env.ADDON_DEV_VIEWER_EMAIL;
    return { ok: true, email: claimed || undefined };
  }

  // 1) Prove Google origin via any Google-signed token present in the request.
  const candidates = [bearerOf(authHeader), auth.systemIdToken, userIdToken].filter(
    (t): t is string => Boolean(t),
  );
  let originOk = false;
  for (const tok of candidates) {
    try {
      const payload = await verifyToken(tok, env.ADDON_AUDIENCE);
      // The email is deliberately NOT logged. Cloud Logging is readable by
      // every project owner, and a log of which mailbox opened which panel is
      // a record of behaviour the user never agreed to share with colleagues.
      logger.info(
        { aud: payload?.aud, iss: payload?.iss },
        'add-on request: Google token verified',
      );
      originOk = true;
      break;
    } catch (err) {
      logger.warn({ err: String(err) }, 'add-on request: a token failed verification');
    }
  }
  if (!originOk) return { ok: false, reason: 'no valid Google-signed token in request' };

  // 2) Extract the user's email from the signature-verified userIdToken.
  let email: string | undefined;
  if (userIdToken) {
    try {
      email = (await verifyToken(userIdToken, ''))?.email;
    } catch {
      /* origin already proven; leave email undefined and fall back to dev tenant */
    }
  }
  return { ok: true, email };
}
