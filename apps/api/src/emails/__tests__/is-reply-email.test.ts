import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import type { Email } from '@crm/shared';
import {
  isReplyEmail,
  isFromTenantDomain,
  isAutoSubmitted,
  hasExternalRecipient,
  isCountableReply,
  toReplyAttribution,
} from '../converter';

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

// isFromTenantDomain is the shared helper that backs both reply detection and the
// isCustomerEmail classification, so they can never drift.
describe('isFromTenantDomain', () => {
  const tenantDomains = ['tenant.com', 'tenant.io'];

  it('matches a sender on a tenant domain (case-insensitive)', () => {
    expect(isFromTenantDomain('agent@tenant.com', tenantDomains)).toBe(true);
    expect(isFromTenantDomain('Agent@Tenant.COM', tenantDomains)).toBe(true);
    expect(isFromTenantDomain('x@tenant.io', tenantDomains)).toBe(true);
  });

  it('does not match a non-tenant sender', () => {
    expect(isFromTenantDomain('customer@acme-customer.com', tenantDomains)).toBe(false);
  });

  it('does not match a domain that only contains a tenant domain as a substring', () => {
    expect(isFromTenantDomain('attacker@nottenant.com', tenantDomains)).toBe(false);
  });

  it('returns false when tenant domains are not configured', () => {
    expect(isFromTenantDomain('agent@tenant.com', null)).toBe(false);
    expect(isFromTenantDomain('agent@tenant.com', [])).toBe(false);
    expect(isFromTenantDomain('agent@tenant.com', undefined)).toBe(false);
  });

  it('is the exact complement used by isReplyEmail (minus the SENT label)', () => {
    const inbound: Email = {
      provider: 'gmail',
      messageId: 'm2',
      threadId: 't2',
      subject: 'hi',
      from: { email: 'agent@tenant.com' },
      tos: [{ email: 'customer@acme-customer.com' }],
      receivedAt: new Date('2026-01-01T00:00:00Z'),
      labels: ['INBOX'],
    };
    expect(isReplyEmail(inbound, tenantDomains)).toBe(isFromTenantDomain(inbound.from.email, tenantDomains));
  });
});

// A sent/reply email only counts toward time-to-response if it's a genuine
// customer-facing human reply — not automated and addressed to the customer.
describe('isCountableReply (TAT first-reply qualification)', () => {
  const tenantDomains = ['tenant.com'];
  const reply = (over: Partial<Email>): Email => ({
    provider: 'gmail',
    messageId: 'r',
    threadId: 't',
    subject: 'Re: issue',
    from: { email: 'agent@tenant.com' },
    tos: [{ email: 'customer@acme-customer.com' }],
    receivedAt: new Date('2026-01-01T10:00:00Z'),
    labels: ['SENT'],
    ...over,
  });

  it('counts a human reply addressed to the customer', () => {
    expect(isCountableReply(reply({}), tenantDomains)).toBe(true);
  });

  it('rejects an internal-only message (all recipients on tenant domains)', () => {
    const internal = reply({ tos: [{ email: 'colleague@tenant.com' }], ccs: [{ email: 'boss@tenant.com' }] });
    expect(hasExternalRecipient(internal, tenantDomains)).toBe(false);
    expect(isCountableReply(internal, tenantDomains)).toBe(false);
  });

  it('rejects auto-submitted mail via the Auto-Submitted header', () => {
    const auto = reply({ metadata: { autoSubmitted: 'auto-replied' } });
    expect(isAutoSubmitted(auto)).toBe(true);
    expect(isCountableReply(auto, tenantDomains)).toBe(false);
  });

  it('rejects bulk/auto Precedence', () => {
    expect(isAutoSubmitted(reply({ metadata: { precedence: 'bulk' } }))).toBe(true);
    expect(isAutoSubmitted(reply({ metadata: { precedence: 'auto_reply' } }))).toBe(true);
    expect(isCountableReply(reply({ metadata: { precedence: 'bulk' } }), tenantDomains)).toBe(false);
  });

  it('rejects noreply@-style senders', () => {
    expect(isAutoSubmitted(reply({ from: { email: 'no-reply@tenant.com' } }))).toBe(true);
    expect(isCountableReply(reply({ from: { email: 'noreply@tenant.com' } }), tenantDomains)).toBe(false);
  });

  it('treats Auto-Submitted: no as a normal (countable) reply', () => {
    expect(isAutoSubmitted(reply({ metadata: { autoSubmitted: 'no' } }))).toBe(false);
    expect(isCountableReply(reply({ metadata: { autoSubmitted: 'no' } }), tenantDomains)).toBe(true);
  });

  it('counts a reply to the customer even when a colleague is cc’d', () => {
    const mixed = reply({
      tos: [{ email: 'customer@acme-customer.com' }],
      ccs: [{ email: 'colleague@tenant.com' }],
    });
    expect(isCountableReply(mixed, tenantDomains)).toBe(true);
  });

  it('is message-level only — it does not check WHICH customer the reply answers', () => {
    // The originator rule (reply must address the customer email's own sender)
    // is enforced per row in the first-reply UPDATE, not here. A reply to any
    // external address still qualifies as a countable reply at this stage.
    const otherContact = reply({ tos: [{ email: 'somebody-else@acme-customer.com' }] });
    expect(isCountableReply(otherContact, tenantDomains)).toBe(true);
  });
});

// toReplyAttribution reduces a reply to what the first-reply UPDATE joins on.
// Address normalization matters: emails.from_email casing is not ours to control.
describe('toReplyAttribution', () => {
  const at = new Date('2026-01-01T10:00:00Z');

  it('lowercases the sender and merges To + Cc into recipients', () => {
    const result = toReplyAttribution(
      {
        from: { email: 'Agent@Tenant.com' },
        tos: [{ email: 'Customer@Acme.com' }],
        ccs: [{ email: 'BOSS@tenant.com' }],
      },
      at
    );

    expect(result.fromEmail).toBe('agent@tenant.com');
    expect(result.recipients).toEqual(['customer@acme.com', 'boss@tenant.com']);
    expect(result.receivedAt).toBe(at);
  });

  it('de-duplicates recipients and drops empty addresses', () => {
    const result = toReplyAttribution(
      {
        from: { email: 'agent@tenant.com' },
        tos: [{ email: 'customer@acme.com' }, { email: '' }],
        ccs: [{ email: 'CUSTOMER@acme.com' }],
      },
      at
    );

    expect(result.recipients).toEqual(['customer@acme.com']);
  });

  it('yields no recipients when the reply has none', () => {
    const result = toReplyAttribution({ from: { email: 'agent@tenant.com' } }, at);
    expect(result.recipients).toEqual([]);
  });
});
