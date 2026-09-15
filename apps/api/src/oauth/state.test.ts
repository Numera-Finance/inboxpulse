import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  signOAuthState,
  verifyOAuthState,
  OAUTH_STATE_TTL_SECONDS,
  type OAuthState,
} from './state';

const SECRET = 'a-test-signing-secret-of-sufficient-length';

beforeAll(() => {
  process.env.ENCRYPTION_SECRET = SECRET;
});

const at = (offsetSeconds: number): Date => new Date(Date.UTC(2026, 0, 1) + offsetSeconds * 1000);
const ISSUED = at(0);

const state: OAuthState = {
  tenantId: '019a8e88-7fcb-7235-b427-25b77fed0563',
  userId: '019a8e88-7fcb-7235-b427-25b77fed0999',
};

describe('a state survives the trip through Google', () => {
  it('round-trips tenantId and userId', () => {
    const result = verifyOAuthState(signOAuthState(state, ISSUED), at(30));
    expect(result).toEqual({ status: 'valid', state });
  });

  it('round-trips without a userId', () => {
    const result = verifyOAuthState(signOAuthState({ tenantId: state.tenantId }, ISSUED), at(30));
    expect(result).toEqual({ status: 'valid', state: { tenantId: state.tenantId, userId: undefined } });
  });

  it('is URL-safe, so Google echoes back exactly what we signed', () => {
    const token = signOAuthState(state, ISSUED);
    expect(token).toBe(encodeURIComponent(token));
  });

  /**
   * The bug this module replaces. `/authorize` and `/callback` are separate
   * requests and crm-api runs --min-instances 3, so the instance that verifies is
   * usually not the one that signed. Nothing may be carried between them except
   * the token itself and the shared secret.
   */
  it('verifies a token the verifying call was handed nothing else about', () => {
    const signedElsewhere = signOAuthState(state, ISSUED);
    expect(verifyOAuthState(signedElsewhere, at(30))).toEqual({ status: 'valid', state });
  });

  it('two authorize calls for the same tenant produce different states', () => {
    expect(signOAuthState(state, ISSUED)).not.toBe(signOAuthState(state, ISSUED));
  });
});

describe('expired and invalid are different answers', () => {
  it('accepts a state one second inside the TTL', () => {
    const result = verifyOAuthState(signOAuthState(state, ISSUED), at(OAUTH_STATE_TTL_SECONDS - 1));
    expect(result.status).toBe('valid');
  });

  it('expires a state one second past the TTL', () => {
    const result = verifyOAuthState(signOAuthState(state, ISSUED), at(OAUTH_STATE_TTL_SECONDS + 1));
    expect(result.status).toBe('expired');
  });

  /**
   * A slow consent screen and a forged request rendered identically before, and
   * only one of them is fixed by pressing the button again.
   */
  it('calls a stale consent screen expired, not invalid', () => {
    const result = verifyOAuthState(signOAuthState(state, ISSUED), at(20 * 60));
    expect(result.status).toBe('expired');
    if (result.status === 'expired') {
      expect(result.ageSeconds).toBe(20 * 60);
    }
  });

  it('rejects a tampered payload', () => {
    const [payload, signature] = signOAuthState(state, ISSUED).split('.');
    const forged = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    forged.t = 'some-other-tenant';
    const tampered = `${Buffer.from(JSON.stringify(forged)).toString('base64url')}.${signature}`;

    expect(verifyOAuthState(tampered, at(30)).status).toBe('invalid');
  });

  it('rejects a state signed with a different secret', () => {
    process.env.ENCRYPTION_SECRET = 'a-completely-different-secret-value';
    const foreign = signOAuthState(state, ISSUED);
    process.env.ENCRYPTION_SECRET = SECRET;

    expect(verifyOAuthState(foreign, at(30)).status).toBe('invalid');
  });

  it.each([
    ['empty', ''],
    ['no signature', 'abc'],
    ['too many parts', 'a.b.c'],
    ['unreadable payload', `${Buffer.from('not json').toString('base64url')}.x`],
  ])('rejects a %s state as invalid, never as valid', (_label, token) => {
    expect(verifyOAuthState(token, at(30)).status).toBe('invalid');
  });

  it('rejects a state issued in the future rather than reading it as fresh', () => {
    const result = verifyOAuthState(signOAuthState(state, at(3600)), ISSUED);
    expect(result.status).toBe('invalid');
  });

  it('tolerates small clock skew between instances', () => {
    const result = verifyOAuthState(signOAuthState(state, at(10)), ISSUED);
    expect(result.status).toBe('valid');
  });
});

/**
 * The signing key must be byte-identical fleet-wide. A per-process fallback would
 * pass every test above — signing and verifying in one process — and fail in
 * production exactly the way the Map did.
 */
describe('the signing key is never invented', () => {
  it('throws instead of defaulting when no shared secret is configured', () => {
    delete process.env.ENCRYPTION_SECRET;
    try {
      expect(() => signOAuthState(state, ISSUED)).toThrow(/ENCRYPTION_SECRET/);
    } finally {
      process.env.ENCRYPTION_SECRET = SECRET;
    }
  });

  /**
   * A fallback to a second variable is the same bug in a different hat: on an
   * instance where the first is absent and the second present, `A || B` derives a
   * key nobody else derives, and states cross-reject as `invalid`.
   */
  it('reads exactly one named variable, with no fallback to another', () => {
    process.env.BETTER_AUTH_SECRET = 'a-different-secret-that-must-not-be-used';
    delete process.env.ENCRYPTION_SECRET;
    try {
      expect(() => signOAuthState(state, ISSUED)).toThrow();
    } finally {
      delete process.env.BETTER_AUTH_SECRET;
      process.env.ENCRYPTION_SECRET = SECRET;
    }
  });

  it('names the variable it wants without prescribing configuration in the message', () => {
    const src = readFileSync(join(__dirname, 'state.ts'), 'utf8');
    expect(src).not.toMatch(/process\.env\.\w+\s*\|\|\s*process\.env\./);
  });

  it('does not fall back to a random or hard-coded key', () => {
    const src = readFileSync(join(__dirname, 'state.ts'), 'utf8');
    expect(src).not.toMatch(/randomBytes\s*\([^)]*\)\s*(?:\.toString\([^)]*\))?\s*;?\s*\/\/\s*key/i);
    expect(src).toMatch(/if\s*\(!secret\)\s*\{\s*throw new Error/);
  });
});

/**
 * The whole point is that no crm-api instance remembers an in-flight authorization.
 * Derived from the source so a Map reintroduced next month is caught here rather
 * than by a user who cannot connect their mailbox.
 */
describe('the oauth module keeps no per-instance state', () => {
  const routes = readFileSync(join(__dirname, 'routes.ts'), 'utf8');

  it('holds no module-level Map, Set or cache object', () => {
    expect(routes).not.toMatch(/new (Map|Set|WeakMap)\s*[(<]/);
  });

  it('runs no sweeper timer for expiring states', () => {
    expect(routes).not.toMatch(/setInterval|setTimeout/);
  });

  it('signs and verifies through this module rather than re-implementing it', () => {
    expect(routes).toMatch(/signOAuthState/);
    expect(routes).toMatch(/verifyOAuthState/);
  });
});
