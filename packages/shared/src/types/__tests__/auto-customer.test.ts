import { describe, it, expect } from 'vitest';
import {
  AUTO_CUSTOMER_NAME_SUFFIX,
  withAutoCustomerSuffix,
  inferCustomerNameFromDomain,
} from '../auto-customer';

describe('withAutoCustomerSuffix', () => {
  it('appends the canonical " (Auto)" suffix to a plain name', () => {
    expect(withAutoCustomerSuffix('Acme')).toBe('Acme (Auto)');
    expect(withAutoCustomerSuffix('Acme Corp')).toBe('Acme Corp (Auto)');
  });

  it('trims input before appending', () => {
    expect(withAutoCustomerSuffix('  Acme  ')).toBe('Acme (Auto)');
  });

  it('returns the empty string when given empty input', () => {
    expect(withAutoCustomerSuffix('')).toBe('');
    expect(withAutoCustomerSuffix('   ')).toBe('');
  });

  describe('idempotency (does not double-append)', () => {
    it('detects an already-suffixed name with canonical formatting', () => {
      expect(withAutoCustomerSuffix('Acme (Auto)')).toBe('Acme (Auto)');
    });

    it('detects regardless of letter case', () => {
      expect(withAutoCustomerSuffix('Acme (AUTO)')).toBe('Acme (AUTO)');
      expect(withAutoCustomerSuffix('Acme (auto)')).toBe('Acme (auto)');
      expect(withAutoCustomerSuffix('ACME CORP (Auto)')).toBe('ACME CORP (Auto)');
    });

    it('detects when the leading space is missing — "Foo(Auto)" is treated as suffixed', () => {
      // Without this tolerance, `withAutoCustomerSuffix("Foo(Auto)")` would
      // produce `"Foo(Auto) (Auto)"`.
      expect(withAutoCustomerSuffix('Foo(Auto)')).toBe('Foo(Auto)');
    });

    it('still appends the canonical suffix when the input has unrelated trailing parens', () => {
      // Input doesn't end with the suffix — append normally.
      expect(withAutoCustomerSuffix('Foo (something else)')).toBe('Foo (something else) (Auto)');
      expect(withAutoCustomerSuffix('Foo (AutoX)')).toBe('Foo (AutoX) (Auto)');
    });

    it('round-trips: applying twice yields the same string', () => {
      const once = withAutoCustomerSuffix('Acme Corp');
      const twice = withAutoCustomerSuffix(once);
      const thrice = withAutoCustomerSuffix(twice);
      expect(once).toBe('Acme Corp (Auto)');
      expect(twice).toBe('Acme Corp (Auto)');
      expect(thrice).toBe('Acme Corp (Auto)');
    });
  });

  it('does not depend on the suffix constant being mutable', () => {
    expect(AUTO_CUSTOMER_NAME_SUFFIX).toBe(' (Auto)');
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
