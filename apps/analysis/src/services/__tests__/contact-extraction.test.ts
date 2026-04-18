import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import { ContactExtractionService } from '../contact-extraction';
import type { Email } from '@crm/shared';

const svc = new ContactExtractionService();

function email(overrides: Partial<Email> = {}): Email {
  return {
    provider: 'gmail',
    messageId: 'm-1',
    threadId: 't-1',
    subject: 's',
    body: 'b',
    from: { email: 'sender@acme.com', name: 'Sender' },
    tos: [],
    ccs: [],
    bccs: [],
    receivedAt: new Date(),
    ...overrides,
  };
}

describe('extractContacts', () => {
  it('returns the sender as the first contact', () => {
    const result = svc.extractContacts(email());
    expect(result[0]).toEqual({ email: 'sender@acme.com', name: 'Sender', customerDomain: 'acme.com' });
  });

  it('attaches a pseudo-domain customerDomain for personal-email participants', () => {
    const result = svc.extractContacts(email({
      from: { email: 'uzi.dutta@gmail.com', name: 'Uzi Dutta' },
      tos: [{ email: 'work@acme.com' }],
    }));
    const by = Object.fromEntries(result.map((c) => [c.email, c.customerDomain]));
    expect(by).toEqual({
      'uzi.dutta@gmail.com': 'uzi.dutta-gmail.com',
      'work@acme.com': 'acme.com',
    });
  });

  it('includes recipients across to / cc / bcc', () => {
    const result = svc.extractContacts(email({
      tos: [{ email: 'to@x.com', name: 'TO' }],
      ccs: [{ email: 'cc@y.com', name: 'CC' }],
      bccs: [{ email: 'bcc@z.com' }],
    }));
    const emails = result.map((c) => c.email);
    expect(emails).toEqual(['sender@acme.com', 'to@x.com', 'cc@y.com', 'bcc@z.com']);
  });

  it('preserves the display name when present', () => {
    const result = svc.extractContacts(email({
      tos: [{ email: 'jane@x.com', name: 'Jane Doe' }],
    }));
    expect(result.find((c) => c.email === 'jane@x.com')?.name).toBe('Jane Doe');
  });

  it('omits the name field when not provided', () => {
    const result = svc.extractContacts(email({
      from: { email: 'sender@acme.com' }, // no name
      tos: [{ email: 'plain@x.com' }],
    }));
    expect(result[0]).toEqual({ email: 'sender@acme.com', name: undefined, customerDomain: 'acme.com' });
    expect(result[1]).toEqual({ email: 'plain@x.com', name: undefined, customerDomain: 'x.com' });
  });

  it('dedupes by lowercase email — different cases of the same address collapse', () => {
    const result = svc.extractContacts(email({
      from: { email: 'Sender@ACME.com', name: 'A' },
      tos: [{ email: 'sender@acme.com', name: 'A2' }, { email: 'other@x.com' }],
    }));
    const emails = result.map((c) => c.email);
    expect(emails).toEqual(['Sender@ACME.com', 'other@x.com']);
    // The first-seen variant wins (preserves whichever case was sent).
    expect(result[0].name).toBe('A');
  });

  it('dedupes a recipient that exactly matches the sender', () => {
    const result = svc.extractContacts(email({
      from: { email: 'a@x.com' },
      tos: [{ email: 'a@x.com' }, { email: 'b@x.com' }],
    }));
    expect(result.map((c) => c.email)).toEqual(['a@x.com', 'b@x.com']);
  });

  it('skips entries with empty/missing email', () => {
    const result = svc.extractContacts(email({
      from: { email: '' as any, name: 'Empty' },
      tos: [{ email: 'good@x.com' }, { email: undefined as any, name: 'Bad' }],
    }));
    expect(result).toEqual([{ email: 'good@x.com', name: undefined, customerDomain: 'x.com' }]);
  });

  it('handles missing recipient arrays without throwing', () => {
    const result = svc.extractContacts(email({
      from: { email: 'a@x.com' },
      tos: undefined as any,
      ccs: undefined as any,
      bccs: undefined as any,
    }));
    expect(result).toEqual([{ email: 'a@x.com', name: undefined, customerDomain: 'x.com' }]);
  });

  it('returns an empty array when the email has no usable participants', () => {
    const result = svc.extractContacts(email({
      from: { email: '' as any },
      tos: [],
      ccs: [],
      bccs: [],
    }));
    expect(result).toEqual([]);
  });
});
