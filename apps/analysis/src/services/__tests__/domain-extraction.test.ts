import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import { DomainExtractionService } from '../domain-extraction';
import type { Email } from '@crm/shared';

const svc = new DomainExtractionService();

function email(overrides: Partial<Email> = {}): Email {
  return {
    provider: 'gmail',
    messageId: 'm-1',
    threadId: 't-1',
    subject: 's',
    body: 'b',
    from: { email: 'sender@acme.com' },
    tos: [{ email: 'to@bar.com' }],
    ccs: [],
    bccs: [],
    receivedAt: new Date(),
    ...overrides,
  };
}

describe('extractTopLevelDomain', () => {
  it('strips the local part and returns the registrable domain', () => {
    expect(svc.extractTopLevelDomain('john@acme.com')).toBe('acme.com');
  });

  it('reduces a subdomain to its last two parts', () => {
    expect(svc.extractTopLevelDomain('john@mail.acme.com')).toBe('acme.com');
    expect(svc.extractTopLevelDomain('alice@deep.subdomain.example.org')).toBe('example.org');
  });

  it('returns null for personal-email providers', () => {
    expect(svc.extractTopLevelDomain('foo@gmail.com')).toBeNull();
    expect(svc.extractTopLevelDomain('foo@yahoo.co.in')).toBeNull();
    expect(svc.extractTopLevelDomain('foo@hey.com')).toBeNull();
  });

  it('lowercases the result', () => {
    expect(svc.extractTopLevelDomain('USER@Acme.COM')).toBe('acme.com');
  });

  it('returns null for malformed input', () => {
    expect(svc.extractTopLevelDomain('')).toBeNull();
    expect(svc.extractTopLevelDomain('not-an-email')).toBeNull();
    expect(svc.extractTopLevelDomain('@')).toBeNull();
    expect(svc.extractTopLevelDomain(null as unknown as string)).toBeNull();
    expect(svc.extractTopLevelDomain(undefined as unknown as string)).toBeNull();
  });

  it('returns the bare hostname when no dot is present (single-label TLD)', () => {
    // Edge case — not real-world, but the regex should not crash.
    expect(svc.extractTopLevelDomain('user@localhost')).toBe('localhost');
  });

  // Documented limitation: naive last-two-parts heuristic doesn't handle
  // multi-part TLDs. Fixing requires the Public Suffix List (e.g. tldts).
  it('KNOWN LIMITATION: multi-part TLDs are reduced to the wrong domain', () => {
    expect(svc.extractTopLevelDomain('john@something.co.uk')).toBe('co.uk');
    expect(svc.extractTopLevelDomain('john@something.com.au')).toBe('com.au');
  });
});

describe('extractDomains', () => {
  it('extracts the from-domain when no recipients overlap', () => {
    const result = svc.extractDomains(email({ from: { email: 'a@acme.com' }, tos: [], ccs: [], bccs: [] }));
    expect(result).toEqual([{ domain: 'acme.com', inferredName: 'Acme' }]);
  });

  it('extracts unique domains across from / tos / ccs / bccs', () => {
    const result = svc.extractDomains(email({
      from: { email: 'a@acme.com' },
      tos: [{ email: 'b@bar.com' }, { email: 'c@bar.com' }], // dup domain
      ccs: [{ email: 'd@baz.io' }],
      bccs: [{ email: 'e@qux.dev' }],
    }));
    const domains = result.map((d) => d.domain).sort();
    expect(domains).toEqual(['acme.com', 'bar.com', 'baz.io', 'qux.dev']);
  });

  it('attaches the domain-derived inferredName to each result', () => {
    const result = svc.extractDomains(email({
      from: { email: 'a@acme-corp.com' },
      tos: [],
    }));
    expect(result).toEqual([{ domain: 'acme-corp.com', inferredName: 'Acme Corp' }]);
  });

  it('emits a per-address pseudo-domain for personal-email participants', () => {
    const result = svc.extractDomains(email({
      from: { email: 'kira@gmail.com', name: 'Kira Tanaka' },
      tos: [{ email: 'work@acme.com' }],
      ccs: [{ email: 'friend@yahoo.com' }],
    }));
    const byDomain = Object.fromEntries(result.map((r) => [r.domain, r.inferredName]));
    expect(byDomain).toEqual({
      'kira-gmail.com': 'Kira Tanaka',
      'acme.com': 'Acme',
      'friend-yahoo.com': 'Friend',
    });
  });

  it('prefers the participant header name over a local-part-derived name', () => {
    const result = svc.extractDomains(email({
      from: { email: 'uzi.dutta@gmail.com', name: '  Uzi Dutta  ' },
      tos: [],
    }));
    expect(result).toEqual([{ domain: 'uzi.dutta-gmail.com', inferredName: 'Uzi Dutta' }]);
  });

  it('falls back to the email local part when no header name is provided', () => {
    const result = svc.extractDomains(email({
      from: { email: 'uzi.dutta@gmail.com' },
      tos: [],
    }));
    expect(result).toEqual([{ domain: 'uzi.dutta-gmail.com', inferredName: 'Uzi Dutta' }]);
  });

  it('creates one pseudo-domain per personal-email sender, no collapsing', () => {
    const result = svc.extractDomains(email({
      from: { email: 'a@gmail.com' },
      tos: [{ email: 'b@yahoo.com' }],
      ccs: [{ email: 'c@hotmail.com' }],
    }));
    const domains = result.map((d) => d.domain).sort();
    expect(domains).toEqual(['a-gmail.com', 'b-yahoo.com', 'c-hotmail.com']);
  });

  it('handles missing/empty recipient arrays without throwing', () => {
    const result = svc.extractDomains(email({
      from: { email: 'a@acme.com' },
      tos: undefined as any,
      ccs: undefined as any,
      bccs: undefined as any,
    }));
    expect(result).toEqual([{ domain: 'acme.com', inferredName: 'Acme' }]);
  });

  it('treats different cases as the same domain (dedupe)', () => {
    const result = svc.extractDomains(email({
      from: { email: 'a@ACME.COM' },
      tos: [{ email: 'b@acme.com' }],
    }));
    expect(result).toEqual([{ domain: 'acme.com', inferredName: 'Acme' }]);
  });
});
