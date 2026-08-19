import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import { requireServiceAuth, requireInternalAuth, INTERNAL_API_KEY_HEADER } from './service-auth';
import { ErrorCode } from '../errors/types';

/**
 * These three refusals returned `error` as a bare string for as long as they
 * existed, and nothing objected: no test covered this file, and `c.json` accepts
 * any shape. The cost was borne by the caller — `safeErrorDetail` in the add-on
 * reads `error.code`, found a string, and logged "json body, no error object",
 * so a mis-keyed internal call reported that something failed without reporting
 * what.
 *
 * The assertions below are on the SHAPE, not the wording, because the shape is
 * the contract a client parses.
 */
describe.each([
  ['requireServiceAuth', requireServiceAuth],
  ['requireInternalAuth', requireInternalAuth],
])('%s refuses in the documented envelope', (_name, middleware) => {
  const original = process.env.SERVICE_API_KEY;
  const app = () => {
    const a = new Hono();
    a.use('*', middleware());
    a.get('/', (c) => c.json({ success: true, data: 'reached' }));
    return a;
  };

  beforeEach(() => {
    process.env.SERVICE_API_KEY = 'correct-key';
  });
  afterEach(() => {
    if (original === undefined) delete process.env.SERVICE_API_KEY;
    else process.env.SERVICE_API_KEY = original;
  });

  it('answers a missing key with a structured 401', async () => {
    const res = await app().request('/');
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.success).toBe(false);
    // The point of the fix: an object, not a string.
    expect(typeof body.error).toBe('object');
    expect(body.error.code).toBe(ErrorCode.UNAUTHORIZED);
    expect(body.error.message).toBe('Missing internal API key');
    expect(body.error.statusCode).toBe(401);
  });

  it('answers a wrong key with a structured 401', async () => {
    const res = await app().request('/', { headers: { [INTERNAL_API_KEY_HEADER]: 'wrong' } });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe(ErrorCode.UNAUTHORIZED);
    expect(body.error.message).toBe('Invalid internal API key');
  });

  it('answers an unconfigured server with a structured 500, and does not let the request through', async () => {
    delete process.env.SERVICE_API_KEY;
    const res = await app().request('/', { headers: { [INTERNAL_API_KEY_HEADER]: 'anything' } });
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.code).toBe(ErrorCode.INTERNAL_ERROR);
    expect(body.error.statusCode).toBe(500);
    // An unset key must fail closed. Failing open would expose every internal route.
    expect(body.data).toBeUndefined();
  });

  it('lets a correct key through', async () => {
    const res = await app().request('/', { headers: { [INTERNAL_API_KEY_HEADER]: 'correct-key' } });
    expect(res.status).toBe(200);
    expect((await res.json()).data).toBe('reached');
  });
});
