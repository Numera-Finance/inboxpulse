import { describe, it, expect } from 'vitest';
import {
  PERSONAL_DOMAINS,
  isPersonalEmailDomain,
  personalEmailToPseudoDomain,
  inferNameFromEmailLocalPart,
  resolveCustomerKeyForEmail,
} from '../personal-domains';

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

describe('personalEmailToPseudoDomain', () => {
  it('joins local part and provider with a dash', () => {
    expect(personalEmailToPseudoDomain('uzi.dutta@gmail.com')).toBe('uzi.dutta-gmail.com');
    expect(personalEmailToPseudoDomain('alice@yahoo.co.uk')).toBe('alice-yahoo.co.uk');
  });

  it('lowercases both sides', () => {
    expect(personalEmailToPseudoDomain('ALICE@Gmail.COM')).toBe('alice-gmail.com');
  });

  it('preserves gmail plus-addressing (no normalization)', () => {
    // Gmail treats alice+work@gmail.com and alice@gmail.com as the same
    // inbox, but we intentionally keep them as distinct pseudo-domains so
    // the user can merge later. Normalizing here would be provider-specific.
    expect(personalEmailToPseudoDomain('alice+work@gmail.com')).toBe('alice+work-gmail.com');
  });

  it('returns null for malformed input', () => {
    expect(personalEmailToPseudoDomain('')).toBeNull();
    expect(personalEmailToPseudoDomain(null)).toBeNull();
    expect(personalEmailToPseudoDomain(undefined)).toBeNull();
    expect(personalEmailToPseudoDomain('no-at-sign')).toBeNull();
    expect(personalEmailToPseudoDomain('@gmail.com')).toBeNull();   // no local part
    expect(personalEmailToPseudoDomain('alice@')).toBeNull();        // no domain
  });
});

describe('inferNameFromEmailLocalPart', () => {
  it('title-cases dot-separated local parts', () => {
    expect(inferNameFromEmailLocalPart('uzi.dutta@gmail.com')).toBe('Uzi Dutta');
    expect(inferNameFromEmailLocalPart('first.middle.last@foo.com')).toBe('First Middle Last');
  });

  it('handles underscore and dash separators', () => {
    expect(inferNameFromEmailLocalPart('john_doe@yahoo.com')).toBe('John Doe');
    expect(inferNameFromEmailLocalPart('firstname-lastname@gmail.com')).toBe('Firstname Lastname');
  });

  it('strips gmail-style +tag segments', () => {
    expect(inferNameFromEmailLocalPart('alice+work@gmail.com')).toBe('Alice Work');
  });

  it('falls back to the local part when not splittable', () => {
    expect(inferNameFromEmailLocalPart('alice@gmail.com')).toBe('Alice');
  });

  it('returns empty string for malformed input', () => {
    expect(inferNameFromEmailLocalPart('')).toBe('');
    expect(inferNameFromEmailLocalPart(null)).toBe('');
    expect(inferNameFromEmailLocalPart(undefined)).toBe('');
    expect(inferNameFromEmailLocalPart('@gmail.com')).toBe('');
  });

  it('treats input without @ as the whole local part', () => {
    expect(inferNameFromEmailLocalPart('alice.smith')).toBe('Alice Smith');
  });
});

describe('resolveCustomerKeyForEmail', () => {
  it('returns the top-level domain + domain-derived name for corporate addresses', () => {
    expect(resolveCustomerKeyForEmail('alice@acme.com')).toEqual({
      domain: 'acme.com',
      defaultName: 'Acme',
    });
  });

  it('reduces subdomains to the last two parts', () => {
    expect(resolveCustomerKeyForEmail('alice@mail.acme.com')).toEqual({
      domain: 'acme.com',
      defaultName: 'Acme',
    });
  });

  it('splits hyphenated corporate names into title case', () => {
    expect(resolveCustomerKeyForEmail('user@acme-corp.io')).toEqual({
      domain: 'acme-corp.io',
      defaultName: 'Acme Corp',
    });
  });

  it('emits a per-address pseudo-domain for personal-email addresses', () => {
    expect(resolveCustomerKeyForEmail('uzi.dutta@gmail.com')).toEqual({
      domain: 'uzi.dutta-gmail.com',
      defaultName: 'Uzi Dutta',
    });
  });

  it('prefers the header name over the local-part-derived name for personal addresses', () => {
    expect(resolveCustomerKeyForEmail('uzi.dutta@gmail.com', '  Uzi Dutta Pro  ')).toEqual({
      domain: 'uzi.dutta-gmail.com',
      defaultName: 'Uzi Dutta Pro',
    });
  });

  it('ignores the header name for corporate addresses (domain decides the customer row)', () => {
    // The defaultName on the corporate path is derived from the domain so
    // that two senders from the same company don't fight to rename the row.
    expect(resolveCustomerKeyForEmail('alice@acme.com', 'Alice Smith')).toEqual({
      domain: 'acme.com',
      defaultName: 'Acme',
    });
  });

  it('lowercases the domain half', () => {
    expect(resolveCustomerKeyForEmail('Alice@ACME.com')).toEqual({
      domain: 'acme.com',
      defaultName: 'Acme',
    });
    expect(resolveCustomerKeyForEmail('UZI@Gmail.COM')).toEqual({
      domain: 'uzi-gmail.com',
      defaultName: 'Uzi',
    });
  });

  it('falls back to an empty header name and still produces a key', () => {
    expect(resolveCustomerKeyForEmail('plain@gmail.com', '')).toEqual({
      domain: 'plain-gmail.com',
      defaultName: 'Plain',
    });
  });

  it('returns null for malformed input', () => {
    expect(resolveCustomerKeyForEmail('')).toBeNull();
    expect(resolveCustomerKeyForEmail(null)).toBeNull();
    expect(resolveCustomerKeyForEmail(undefined)).toBeNull();
    expect(resolveCustomerKeyForEmail('no-at-sign')).toBeNull();
    expect(resolveCustomerKeyForEmail('alice@')).toBeNull();
  });

  // Documented limitation shared with the old extractTopLevelDomain path:
  // naive last-two-parts heuristic mis-handles multi-part TLDs. Fixing
  // requires the Public Suffix List (e.g. tldts).
  it('KNOWN LIMITATION: multi-part TLDs are reduced to the wrong domain', () => {
    expect(resolveCustomerKeyForEmail('john@something.co.uk')).toEqual({
      domain: 'co.uk',
      defaultName: 'Co',
    });
  });
});
