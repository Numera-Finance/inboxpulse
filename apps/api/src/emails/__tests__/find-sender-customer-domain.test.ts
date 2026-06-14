import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import { findSenderCustomerDomain } from '../analysis-service';

// These tests pin the lookup used by refineCustomerNameFromSignature, which is
// what lets a personal-email sender's auto-created customer get renamed from
// "Uzi Dutta (Auto)" to "Acme Corp (Auto)" when the signature has a company.
describe('findSenderCustomerDomain', () => {
  const contacts = [
    { email: 'uzi.dutta@gmail.com', customerDomain: 'uzi.dutta-gmail.com' },
    { email: 'alice@acme.com', customerDomain: 'acme.com' },
    { email: 'Bob@ACME.com', customerDomain: 'acme.com' },
  ];

  it('returns the pseudo-domain for a personal-email sender', () => {
    expect(findSenderCustomerDomain('uzi.dutta@gmail.com', contacts)).toBe('uzi.dutta-gmail.com');
  });

  it('returns the top-level domain for a corporate sender', () => {
    expect(findSenderCustomerDomain('alice@acme.com', contacts)).toBe('acme.com');
  });

  it('is case-insensitive on the sender email', () => {
    expect(findSenderCustomerDomain('UZI.Dutta@Gmail.COM', contacts)).toBe('uzi.dutta-gmail.com');
    expect(findSenderCustomerDomain('bob@acme.com', contacts)).toBe('acme.com');
  });

  it('returns null when the sender is not present in extractedContacts', () => {
    expect(findSenderCustomerDomain('stranger@example.com', contacts)).toBeNull();
  });

  it('returns null for missing/empty sender input', () => {
    expect(findSenderCustomerDomain(null, contacts)).toBeNull();
    expect(findSenderCustomerDomain(undefined, contacts)).toBeNull();
    expect(findSenderCustomerDomain('', contacts)).toBeNull();
  });

  it('returns null when extractedContacts is empty', () => {
    expect(findSenderCustomerDomain('alice@acme.com', [])).toBeNull();
  });
});
