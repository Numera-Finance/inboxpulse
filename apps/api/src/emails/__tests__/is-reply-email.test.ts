import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import type { Email } from '@crm/shared';
import { isReplyEmail } from '../converter';

// isReplyEmail decides which messages are treated as outbound "replies".
// Replies are never stored or analyzed — only their timestamp is used to set
// firstReplyAt (time-to-response) on the customer email they answer.
describe('isReplyEmail', () => {
  const baseEmail: Email = {
    provider: 'gmail',
    messageId: 'm1',
    threadId: 't1',
    subject: 'Re: issue',
    body: 'body',
    from: { email: 'customer@acme-customer.com' },
    tos: [{ email: 'support@tenant.com' }],
    receivedAt: new Date('2026-01-01T00:00:00Z'),
  };

  const tenantDomains = ['tenant.com', 'tenant.io'];

  it('classifies an email with the SENT label as a reply', () => {
    const email: Email = { ...baseEmail, labels: ['SENT'] };
    expect(isReplyEmail(email, tenantDomains)).toBe(true);
  });

  it('classifies an email from a tenant domain as a reply', () => {
    const email: Email = { ...baseEmail, from: { email: 'agent@tenant.com' }, labels: ['INBOX'] };
    expect(isReplyEmail(email, tenantDomains)).toBe(true);
  });

  it('is case-insensitive on the tenant-domain match', () => {
    const email: Email = { ...baseEmail, from: { email: 'Agent@Tenant.COM' } };
    expect(isReplyEmail(email, tenantDomains)).toBe(true);
  });

  it('matches any of the configured tenant domains', () => {
    const email: Email = { ...baseEmail, from: { email: 'agent@tenant.io' } };
    expect(isReplyEmail(email, tenantDomains)).toBe(true);
  });

  it('treats an inbound customer email as NOT a reply', () => {
    const email: Email = { ...baseEmail, from: { email: 'customer@acme-customer.com' }, labels: ['INBOX'] };
    expect(isReplyEmail(email, tenantDomains)).toBe(false);
  });

  it('does not match on a domain that merely contains a tenant domain as a substring', () => {
    const email: Email = { ...baseEmail, from: { email: 'attacker@nottenant.com' } };
    expect(isReplyEmail(email, tenantDomains)).toBe(false);
  });

  it('falls back to SENT-label only when tenant domains are not configured', () => {
    const inbound: Email = { ...baseEmail, from: { email: 'agent@tenant.com' }, labels: ['INBOX'] };
    expect(isReplyEmail(inbound, null)).toBe(false);

    const sent: Email = { ...baseEmail, labels: ['SENT'] };
    expect(isReplyEmail(sent, null)).toBe(true);
  });

  it('handles emails with no labels', () => {
    const email: Email = { ...baseEmail, labels: undefined, from: { email: 'customer@acme-customer.com' } };
    expect(isReplyEmail(email, tenantDomains)).toBe(false);
  });
});
