import { describe, it, expect } from 'vitest';
import { CONNECTORS, suggestConnector } from './connectors';

describe('connector catalogue', () => {
  it('pulls exactly one fact per system', () => {
    // The discipline that keeps the panel a decision rather than a dashboard.
    for (const c of CONNECTORS) {
      expect(c.pull, c.name).not.toMatch(/\band\b.*\band\b/);
      expect(c.changesTheReply.length, c.name).toBeGreaterThan(10);
    }
  });

  it('never suggests anything on a thread with no customer', () => {
    // Promising a Canopy lookup for a client we cannot identify is a promise we
    // could not keep even if Canopy were connected.
    expect(suggestConnector({ mode: 'complaint', connected: [], hasCustomer: false })).toBeNull();
  });

  it('suggests nothing when the mode is unknown', () => {
    expect(suggestConnector({ mode: undefined, connected: [], hasCustomer: true })).toBeNull();
  });

  it('matches the suggestion to the kind of thread', () => {
    // Close status on a scheduling thread is noise, and noise is how a section
    // teaches users to skip it.
    const s = suggestConnector({ mode: 'scheduling', connected: [], hasCustomer: true });
    expect(['canopy', 'calendar']).toContain(s!.key);
    expect(CONNECTORS.find((c) => c.key === 'qbo')!.modes).not.toContain('scheduling');
  });

  it('is the stack this firm actually runs', () => {
    // An earlier version listed Jira, Stripe, HubSpot and Slack — a catalogue of
    // a generic SaaS company rather than a spec for this one.
    const keys = CONNECTORS.map((c) => c.key);
    expect(keys).toEqual(expect.arrayContaining(['canopy', 'qbo', 'streak', 'gchat']));
    for (const dead of ['jira', 'stripe', 'hubspot', 'slack']) {
      expect(keys).not.toContain(dead);
    }
  });

  it('never suggests something already connected', () => {
    const first = suggestConnector({ mode: 'complaint', connected: [], hasCustomer: true })!;
    const next = suggestConnector({ mode: 'complaint', connected: [first.key], hasCustomer: true })!;
    expect(next.key).not.toBe(first.key);
  });

  it('returns one connector, not a list', () => {
    // A list of things you have not connected is a nag bar.
    const s = suggestConnector({ mode: 'complaint', connected: [], hasCustomer: true });
    expect(Array.isArray(s)).toBe(false);
  });

  it('says nothing on an fyi thread', () => {
    // Nothing is owed, so nothing is worth looking up.
    expect(suggestConnector({ mode: 'fyi', connected: [], hasCustomer: true })).toBeNull();
  });
});
