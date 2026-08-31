import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The Chrome extension renders these same cards in Gmail's rail and cannot mint
 * a Google-signed ID token, so it tells the add-on who is looking via
 * `event.devViewerEmail`. That is a CLAIM from an unauthenticated caller.
 *
 * It is safe only because it is read inside the branch that has already decided
 * not to verify anything. Above that guard it would be an impersonation route
 * into `/homepage`'s entitlement-scoped sections — say any colleague's address
 * and read the clients they are assigned.
 *
 * Two kinds of check, deliberately:
 *
 *  - BEHAVIOUR, that the claim is honoured with verification off and refused
 *    with it on.
 *  - ORDER, on the source text, in the style of consent-gate.test.ts. The
 *    behavioural test passes against a version that reads the claim in both
 *    paths and merely happens to reject for another reason; only the source
 *    check states the actual property, which is WHERE the field may be read.
 */
describe('verifyRequest: the viewer address a caller asserts', () => {
  const saved = { ...process.env };

  beforeEach(() => {
    vi.resetModules(); // getEnv() memoises into a module-level `_env`.
    delete process.env.ADDON_VERIFY_ID_TOKEN;
    delete process.env.ADDON_DEV_VIEWER_EMAIL;
  });
  afterEach(() => {
    process.env = { ...saved };
  });

  const load = async () => (await import('./verify')).verifyRequest;

  it('honours a per-request address when verification is off', async () => {
    const verifyRequest = await load();
    const r = await verifyRequest(undefined, { devViewerEmail: 'ana@example.com' });
    expect(r).toEqual({ ok: true, email: 'ana@example.com' });
  });

  it('falls back to ADDON_DEV_VIEWER_EMAIL when the request names nobody', async () => {
    process.env.ADDON_DEV_VIEWER_EMAIL = 'pinned@example.com';
    const verifyRequest = await load();
    const r = await verifyRequest(undefined, {});
    expect(r.email).toBe('pinned@example.com');
  });

  it('lets the request outrank the pinned default, so one add-on serves several testers', async () => {
    process.env.ADDON_DEV_VIEWER_EMAIL = 'pinned@example.com';
    const verifyRequest = await load();
    const r = await verifyRequest(undefined, { devViewerEmail: 'ana@example.com' });
    expect(r.email).toBe('ana@example.com');
  });

  it('reports nobody rather than the empty string when neither is set', async () => {
    process.env.ADDON_DEV_VIEWER_EMAIL = '';
    const verifyRequest = await load();
    const r = await verifyRequest(undefined, {});
    // undefined means "no one said", which makes /homepage SKIP resolveViewer.
    // '' would instead be asked about and come back `unreachable`, so the panel
    // would claim it tried to identify the viewer and failed. It never asked.
    expect(r.email).toBeUndefined();
  });

  it('IGNORES the claim once ADDON_VERIFY_ID_TOKEN is on', async () => {
    process.env.ADDON_VERIFY_ID_TOKEN = 'true';
    process.env.ADDON_DEV_VIEWER_EMAIL = 'pinned@example.com';
    const verifyRequest = await load();
    const r = await verifyRequest(undefined, { devViewerEmail: 'ceo@example.com' });
    // No Google-signed token in the request, so the caller is not Google —
    // and naming a mailbox does not make them Google.
    expect(r.ok).toBe(false);
    expect(r.email).toBeUndefined();
  });
});

describe('verifyRequest source: where the claim may be read', () => {
  const src = readFileSync(join(__dirname, 'verify.ts'), 'utf8');

  it('reads devViewerEmail only inside the unverified branch', () => {
    const guard = src.indexOf("ADDON_VERIFY_ID_TOKEN !== 'true'");
    // Everything from here down is the enforced path: origin is being proven.
    const enforced = src.indexOf('let originOk');

    expect(guard).toBeGreaterThan(-1);
    expect(enforced).toBeGreaterThan(guard);

    const reads = [...src.matchAll(/devViewerEmail/g)].map((m) => m.index ?? -1);
    expect(reads.length).toBeGreaterThan(0);
    for (const at of reads) {
      expect(at).toBeGreaterThan(guard);
      expect(at).toBeLessThan(enforced);
    }
  });
});
