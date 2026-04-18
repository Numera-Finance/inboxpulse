import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import { signatureBelongsToSender } from '../service';

describe('signatureBelongsToSender', () => {
  describe('accepts (returns true)', () => {
    it('when the signature has no email at all (nothing to verify)', () => {
      expect(signatureBelongsToSender(undefined, 'mike@remedyscientific.com')).toBe(true);
      expect(signatureBelongsToSender(null, 'mike@remedyscientific.com')).toBe(true);
      expect(signatureBelongsToSender('', 'mike@remedyscientific.com')).toBe(true);
      expect(signatureBelongsToSender('   ', 'mike@remedyscientific.com')).toBe(true);
    });

    it('when the signature email matches the sender exactly', () => {
      expect(signatureBelongsToSender('mike@foo.com', 'mike@foo.com')).toBe(true);
    });

    it('case-insensitively, ignoring whitespace', () => {
      expect(signatureBelongsToSender('  Mike@Foo.COM  ', 'mike@foo.com')).toBe(true);
    });

    it('when mailbox differs but the domain matches (alias on the same domain)', () => {
      // sender = mike@remedyscientific.com, sig says mike.r@remedyscientific.com — same person
      expect(signatureBelongsToSender('mike.r@remedyscientific.com', 'mike@remedyscientific.com')).toBe(true);
      expect(signatureBelongsToSender('contact@foo.com', 'sales@foo.com')).toBe(true);
    });

    it('when sender or signature email is malformed (no domain) — fail-open, do not reject', () => {
      // We refuse to make a guess when the input doesn't even have an @ — letting
      // the LLM-extracted sig through is safer than blocking enrichment outright.
      expect(signatureBelongsToSender('weird-no-at', 'mike@foo.com')).toBe(true);
      expect(signatureBelongsToSender('mike@foo.com', 'broken')).toBe(true);
    });
  });

  describe('rejects (returns false)', () => {
    it('when the signature email is on a clearly different domain (forwarded sig)', () => {
      // Kira's reply quoted Sanjeevani's signature; sig email is mystartupcfo, sender is nudsskincare
      expect(signatureBelongsToSender('sshah01@mystartupcfo.com', 'kira@nudsskincare.com')).toBe(false);
    });

    it('when sender is on a personal provider and sig email is on a different domain', () => {
      expect(signatureBelongsToSender('ed@mycfoplan.com', 'accounting@mothandflamevr.com')).toBe(false);
    });

    it('when sender email itself is missing', () => {
      // Without a sender we can't validate — return false so caller skips enrichment.
      expect(signatureBelongsToSender('anything@x.com', '')).toBe(false);
      expect(signatureBelongsToSender('anything@x.com', undefined as unknown as string)).toBe(false);
    });
  });
});
