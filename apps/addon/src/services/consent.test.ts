import { describe, it, expect, beforeEach } from 'vitest';
import { hasConsent, grantConsent, revokeConsent, __resetConsent } from './consent';

/**
 * Reading is off until the person turns it on, and the record is per person.
 *
 * The panel used to send the open thread to a model the instant it rendered,
 * with nobody asked. This is the switch that makes the card's copy true rather
 * than decorative.
 */
describe('consent', () => {
  beforeEach(() => __resetConsent());

  it('is off by default — the whole point', () => {
    expect(hasConsent('sshroff@mystartupcfo.com')).toBe(false);
  });

  it('is per person, not global', () => {
    grantConsent('a@x.com');
    expect(hasConsent('a@x.com')).toBe(true);
    expect(hasConsent('b@x.com')).toBe(false);
  });

  it('can be withdrawn', () => {
    grantConsent('a@x.com');
    revokeConsent('a@x.com');
    expect(hasConsent('a@x.com')).toBe(false);
  });

  it('ignores case and whitespace, since the address comes from a token', () => {
    grantConsent('  A@X.com ');
    expect(hasConsent('a@x.com')).toBe(true);
  });

  /** An unverified viewer must never be treated as having agreed. */
  it('never grants consent to a missing address', () => {
    grantConsent(undefined);
    expect(hasConsent(undefined)).toBe(false);
    expect(hasConsent('')).toBe(false);
  });
});
