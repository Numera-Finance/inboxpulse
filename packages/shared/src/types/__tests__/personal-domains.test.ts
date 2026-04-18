import { describe, it, expect } from 'vitest';
import { PERSONAL_DOMAINS, isPersonalEmailDomain } from '../personal-domains';

describe('isPersonalEmailDomain', () => {
  it('returns true for the major consumer providers', () => {
    expect(isPersonalEmailDomain('gmail.com')).toBe(true);
    expect(isPersonalEmailDomain('yahoo.com')).toBe(true);
    expect(isPersonalEmailDomain('outlook.com')).toBe(true);
    expect(isPersonalEmailDomain('hotmail.com')).toBe(true);
    expect(isPersonalEmailDomain('icloud.com')).toBe(true);
    expect(isPersonalEmailDomain('protonmail.com')).toBe(true);
    expect(isPersonalEmailDomain('proton.me')).toBe(true);
    expect(isPersonalEmailDomain('hey.com')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(isPersonalEmailDomain('GMAIL.COM')).toBe(true);
    expect(isPersonalEmailDomain('Gmail.Com')).toBe(true);
    expect(isPersonalEmailDomain('  gmail.com  ')).toBe(false); // does NOT trim
  });

  it('returns false for company domains', () => {
    expect(isPersonalEmailDomain('acme.com')).toBe(false);
    expect(isPersonalEmailDomain('mystartupcfo.com')).toBe(false);
    expect(isPersonalEmailDomain('foo-corp.io')).toBe(false);
  });

  it('returns false for null / undefined / empty', () => {
    expect(isPersonalEmailDomain(null)).toBe(false);
    expect(isPersonalEmailDomain(undefined)).toBe(false);
    expect(isPersonalEmailDomain('')).toBe(false);
  });

  it('returns false for subdomains of personal providers', () => {
    // Conservative behaviour: "mail.gmail.com" is not in the canonical list,
    // so we don't classify it as personal. Caller is responsible for
    // top-level-domain extraction first.
    expect(isPersonalEmailDomain('mail.gmail.com')).toBe(false);
  });

  it('exposes a frozen-by-convention canonical Set', () => {
    expect(PERSONAL_DOMAINS).toBeInstanceOf(Set);
    expect(PERSONAL_DOMAINS.size).toBeGreaterThan(15);
    // Spot-check key entries — anything missing here would be a regression.
    for (const d of [
      'gmail.com',
      'googlemail.com',
      'yahoo.com',
      'yahoo.co.uk',
      'yahoo.co.in',
      'outlook.com',
      'hotmail.com',
      'live.com',
      'icloud.com',
      'me.com',
      'mac.com',
      'aol.com',
      'protonmail.com',
      'proton.me',
      'hey.com',
    ]) {
      expect(PERSONAL_DOMAINS.has(d)).toBe(true);
    }
  });
});
