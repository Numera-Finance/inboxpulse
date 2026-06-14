import { describe, it, expect } from 'vitest';
import {
  withAutoSuffix,
  inferCustomerNameFromDomain,
} from '../auto-customer';

describe('withAutoSuffix', () => {
  it('appends the canonical " (Auto)" suffix to a plain name', () => {
    expect(withAutoSuffix('Acme')).toBe('Acme (Auto)');
    expect(withAutoSuffix('Acme Corp')).toBe('Acme Corp (Auto)');
  });

  it('trims input before appending', () => {
    expect(withAutoSuffix('  Acme  ')).toBe('Acme (Auto)');
  });

  it('returns "(Auto)" alone when given empty input', () => {
    expect(withAutoSuffix('')).toBe('(Auto)');
    expect(withAutoSuffix('   ')).toBe('(Auto)');
  });

  describe('idempotency (does not double-append)', () => {
    it('detects an already-suffixed name with canonical formatting', () => {
      expect(withAutoSuffix('Acme (Auto)')).toBe('Acme (Auto)');
    });

    it('detects regardless of letter case', () => {
      expect(withAutoSuffix('Acme (AUTO)')).toBe('Acme (AUTO)');
      expect(withAutoSuffix('Acme (auto)')).toBe('Acme (auto)');
      expect(withAutoSuffix('ACME CORP (Auto)')).toBe('ACME CORP (Auto)');
    });

    it('detects when the leading space is missing — "Foo(Auto)" is treated as suffixed', () => {
      // Without this tolerance, `withAutoSuffix("Foo(Auto)")` would
      // produce `"Foo(Auto) (Auto)"`.
      expect(withAutoSuffix('Foo(Auto)')).toBe('Foo(Auto)');
    });

    it('still appends the canonical suffix when the input has unrelated trailing parens', () => {
      // Input doesn't end with the suffix — append normally.
      expect(withAutoSuffix('Foo (something else)')).toBe('Foo (something else) (Auto)');
      expect(withAutoSuffix('Foo (AutoX)')).toBe('Foo (AutoX) (Auto)');
    });

    it('round-trips: applying twice yields the same string', () => {
      const once = withAutoSuffix('Acme Corp');
      const twice = withAutoSuffix(once);
      const thrice = withAutoSuffix(twice);
      expect(once).toBe('Acme Corp (Auto)');
      expect(twice).toBe('Acme Corp (Auto)');
      expect(thrice).toBe('Acme Corp (Auto)');
    });
  });
});

describe('inferCustomerNameFromDomain', () => {
  it('capitalizes the first label of the domain', () => {
    expect(inferCustomerNameFromDomain('acme.com')).toBe('Acme');
    expect(inferCustomerNameFromDomain('foo.io')).toBe('Foo');
  });

  it('splits on hyphens and title-cases each segment', () => {
    expect(inferCustomerNameFromDomain('acme-corp.com')).toBe('Acme Corp');
    expect(inferCustomerNameFromDomain('global-tech-solutions.io')).toBe('Global Tech Solutions');
    expect(inferCustomerNameFromDomain('a-b-c-d-e.io')).toBe('A B C D E');
  });

  it('preserves an already-capitalized label', () => {
    expect(inferCustomerNameFromDomain('ACME.com')).toBe('ACME');
  });

  it('handles single-label hostnames', () => {
    expect(inferCustomerNameFromDomain('localhost')).toBe('Localhost');
  });

  it('returns the raw input for empty / malformed inputs', () => {
    expect(inferCustomerNameFromDomain('')).toBe('');
    expect(inferCustomerNameFromDomain('.com')).toBe('.com'); // first label is empty
  });

  it('does not lowercase domain TLDs (operates on the first label only)', () => {
    expect(inferCustomerNameFromDomain('mystartupcfo.COM')).toBe('Mystartupcfo');
  });

  // Documented behaviour: the function does not know about multi-part TLDs.
  // Caller is expected to give it a registrable domain (e.g., output of
  // extractTopLevelDomain). Given a multi-part TLD that's already collapsed
  // upstream, the inference still produces something sensible:
  it('on a multi-part TLD result (e.g. "co.uk") returns the first label', () => {
    expect(inferCustomerNameFromDomain('co.uk')).toBe('Co');
  });
});
