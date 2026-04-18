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

// `extractTopLevelDomain` used to be a public method on DomainExtractionService
// but was dropped when all branching moved into
// `@crm/shared.resolveCustomerKeyForEmail`. See that helper's tests in
// `packages/shared/src/types/__tests__/personal-domains.test.ts` for the
// per-case behaviour (corporate top-level, personal pseudo, malformed input,
// known multi-part TLD limitation).

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
