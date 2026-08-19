import { describe, it, expect } from 'vitest';
import { sanitizeGmailQuery, participantAddresses } from '../query-sanitizer';

/** The real participant set from the "US New joiners / Sandeep" thread. */
const ALLOWED = new Set([
  'kunal@cillierscpa.com',
  'sshroff@mystartupcfo.com',
  'npradhan@mystartupcfo.com',
  'ea-to-ceo@mystartupcfo.com',
  'msun@mytaxfiler.com',
]);

describe('participantAddresses', () => {
  it('collects from, to and cc, lowercased', () => {
    const addresses = participantAddresses({
      from: { email: 'Kunal@CillierSCPA.com' },
      tos: [{ email: 'sshroff@mystartupcfo.com' }],
      ccs: [{ email: 'npradhan@mystartupcfo.com' }],
    });

    expect(addresses).toEqual(
      new Set(['kunal@cillierscpa.com', 'sshroff@mystartupcfo.com', 'npradhan@mystartupcfo.com'])
    );
  });

  it('excludes bcc so a blind recipient can never leak into a query', () => {
    const addresses = participantAddresses({
      from: { email: 'a@x.com' },
      tos: [{ email: 'b@x.com' }],
      ccs: [],
      // @ts-expect-error bccs is deliberately not part of the accepted shape
      bccs: [{ email: 'secret@x.com' }],
    });

    expect(addresses.has('secret@x.com')).toBe(false);
  });

  it('tolerates missing and empty fields', () => {
    expect(participantAddresses({}).size).toBe(0);
    expect(participantAddresses({ from: null, tos: null, ccs: null }).size).toBe(0);
  });
});

describe('sanitizeGmailQuery', () => {
  it('leaves a query with only real participants untouched', () => {
    const query = 'subject:"US New joiners" from:kunal@cillierscpa.com';
    const result = sanitizeGmailQuery(query, ALLOWED);

    expect(result.query).toBe(query);
    expect(result.removed).toEqual([]);
  });

  it('drops the operator term carrying an invented address', () => {
    // The exact v1.1 failure: sandeep@ was invented, sshroff@ is the real one.
    const result = sanitizeGmailQuery(
      'subject:"US New joiners / Sandeep" from:kunal@cillierscpa.com to:sandeep@mystartupcfo.com',
      ALLOWED
    );

    expect(result.query).toBe('subject:"US New joiners / Sandeep" from:kunal@cillierscpa.com');
    expect(result.removed).toEqual(['to:sandeep@mystartupcfo.com']);
  });

  it('removes the whole term, never leaving a bare operator', () => {
    const result = sanitizeGmailQuery('from:ghost@nowhere.com InboxPulse', ALLOWED);

    expect(result.query).toBe('InboxPulse');
    expect(result.query).not.toContain('from:');
  });

  it('drops a bare address that is not a participant', () => {
    const result = sanitizeGmailQuery('InboxPulse ghost@nowhere.com design', ALLOWED);
    expect(result.query).toBe('InboxPulse design');
  });

  it('is case-insensitive about addresses', () => {
    const result = sanitizeGmailQuery('from:KUNAL@CillierSCPA.com', ALLOWED);
    expect(result.removed).toEqual([]);
  });

  it('keeps names untouched — Gmail partial-matches them and they are unverifiable', () => {
    const result = sanitizeGmailQuery('(from:Gaurav OR from:Manish) subject:"InboxPulse design"', ALLOWED);

    expect(result.query).toBe('(from:Gaurav OR from:Manish) subject:"InboxPulse design"');
    expect(result.removed).toEqual([]);
  });

  it('prunes one operand out of a group and drops the dangling OR', () => {
    const result = sanitizeGmailQuery(
      '(from:kunal@cillierscpa.com OR from:ghost@nowhere.com) subject:"joiners"',
      ALLOWED
    );

    expect(result.query).toBe('from:kunal@cillierscpa.com subject:"joiners"');
  });

  it('removes a group entirely when every operand is unverifiable', () => {
    const result = sanitizeGmailQuery(
      '(from:ghost@nowhere.com OR from:phantom@nowhere.com) InboxPulse',
      ALLOWED
    );

    expect(result.query).toBe('InboxPulse');
  });

  it('prunes inside an operator-group value, keeping the operator', () => {
    const result = sanitizeGmailQuery(
      'from:(kunal@cillierscpa.com OR ghost@nowhere.com) InboxPulse',
      ALLOWED
    );

    expect(result.query).toBe('from:(kunal@cillierscpa.com) InboxPulse');
  });

  it('drops an operator-group whose every operand is unverifiable', () => {
    const result = sanitizeGmailQuery(
      'from:(ghost@nowhere.com OR phantom@nowhere.com) InboxPulse',
      ALLOWED
    );

    expect(result.query).toBe('InboxPulse');
  });

  it('never leaves a leading or trailing boolean', () => {
    const result = sanitizeGmailQuery('from:ghost@nowhere.com OR InboxPulse OR to:phantom@nowhere.com', ALLOWED);

    expect(result.query).toBe('InboxPulse');
  });

  it('collapses consecutive booleans left by adjacent removals', () => {
    const result = sanitizeGmailQuery(
      'a@nowhere.com OR InboxPulse OR b@nowhere.com OR design',
      ALLOWED
    );

    expect(result.query).toBe('InboxPulse OR design');
  });

  it('preserves negation on a surviving term', () => {
    const result = sanitizeGmailQuery('-from:kunal@cillierscpa.com InboxPulse', ALLOWED);
    expect(result.query).toBe('-from:kunal@cillierscpa.com InboxPulse');
  });

  it('drops a negated term carrying an invented address', () => {
    const result = sanitizeGmailQuery('-from:ghost@nowhere.com InboxPulse', ALLOWED);
    expect(result.query).toBe('InboxPulse');
  });

  it('checks addresses hidden inside quoted phrases', () => {
    const result = sanitizeGmailQuery('"ghost@nowhere.com" InboxPulse', ALLOWED);
    expect(result.query).toBe('InboxPulse');
  });

  it('returns empty rather than inventing a replacement when nothing survives', () => {
    const result = sanitizeGmailQuery('from:ghost@nowhere.com to:phantom@nowhere.com', ALLOWED);

    expect(result.query).toBe('');
    expect(result.removed).toHaveLength(2);
  });

  it('handles empty and whitespace input', () => {
    expect(sanitizeGmailQuery('', ALLOWED).query).toBe('');
    expect(sanitizeGmailQuery('   ', ALLOWED).query).toBe('');
  });

  it('does not lose text to an unbalanced parenthesis', () => {
    const result = sanitizeGmailQuery('(from:kunal@cillierscpa.com OR InboxPulse', ALLOWED);
    expect(result.query).toContain('kunal@cillierscpa.com');
    expect(result.query).toContain('InboxPulse');
  });

  it('keeps subject phrases containing an @ that is not an address', () => {
    const result = sanitizeGmailQuery('subject:"Q3 @ risk" InboxPulse', ALLOWED);
    expect(result.query).toBe('subject:"Q3 @ risk" InboxPulse');
  });
});

describe('sanitizeGmailQuery — conjunctions pinning both ends', () => {
  it('drops the recipient when the sender is already pinned', () => {
    // The measured case: this pair matched exactly one message, itself.
    const result = sanitizeGmailQuery(
      'from:msun@mytaxfiler.com to:kunal@cillierscpa.com',
      ALLOWED
    );

    expect(result.query).toBe('from:msun@mytaxfiler.com');
    expect(result.removed).toEqual(['to:kunal@cillierscpa.com']);
  });

  it('keeps the rest of the conjunction intact', () => {
    const result = sanitizeGmailQuery(
      'subject:"US New joiners" from:msun@mytaxfiler.com to:kunal@cillierscpa.com',
      ALLOWED
    );

    expect(result.query).toBe('subject:"US New joiners" from:msun@mytaxfiler.com');
  });

  it('leaves a union alone — OR widens, it does not collapse', () => {
    const query = 'from:msun@mytaxfiler.com OR to:kunal@cillierscpa.com';
    const result = sanitizeGmailQuery(query, ALLOWED);

    expect(result.query).toBe(query);
    expect(result.removed).toEqual([]);
  });

  it('keeps a lone to: when no sender is pinned', () => {
    const query = 'to:kunal@cillierscpa.com subject:"US New joiners"';
    expect(sanitizeGmailQuery(query, ALLOWED).query).toBe(query);
  });

  it('handles an explicit AND the same as an implicit one', () => {
    const result = sanitizeGmailQuery(
      'from:msun@mytaxfiler.com AND to:kunal@cillierscpa.com',
      ALLOWED
    );

    expect(result.query).toBe('from:msun@mytaxfiler.com');
  });

  it('drops every recipient term in the conjunction, not just the first', () => {
    const result = sanitizeGmailQuery(
      'from:msun@mytaxfiler.com to:kunal@cillierscpa.com to:npradhan@mystartupcfo.com',
      ALLOWED
    );

    expect(result.query).toBe('from:msun@mytaxfiler.com');
    expect(result.removed).toHaveLength(2);
  });

  it('treats a group of only from: operands as pinning the sender', () => {
    const result = sanitizeGmailQuery(
      '(from:msun@mytaxfiler.com OR from:kunal@cillierscpa.com) to:npradhan@mystartupcfo.com',
      ALLOWED
    );

    expect(result.query).toBe('(from:msun@mytaxfiler.com OR from:kunal@cillierscpa.com)');
  });

  it('does not treat a mixed group as pinning either end', () => {
    const query = '(from:msun@mytaxfiler.com OR to:kunal@cillierscpa.com) subject:"joiners"';
    const result = sanitizeGmailQuery(query, ALLOWED);

    expect(result.query).toBe(query);
    expect(result.removed).toEqual([]);
  });

  it('recognises the operator-group form of from:', () => {
    const result = sanitizeGmailQuery(
      'from:(msun@mytaxfiler.com OR kunal@cillierscpa.com) to:npradhan@mystartupcfo.com',
      ALLOWED
    );

    expect(result.query).toBe('from:(msun@mytaxfiler.com OR kunal@cillierscpa.com)');
  });

  it('applies per conjunction, not across the whole query', () => {
    // Left side pins both ends; right side is a bare to: and must survive.
    const result = sanitizeGmailQuery(
      'from:msun@mytaxfiler.com to:kunal@cillierscpa.com OR to:npradhan@mystartupcfo.com',
      ALLOWED
    );

    expect(result.query).toBe('from:msun@mytaxfiler.com OR to:npradhan@mystartupcfo.com');
  });

  it('leaves negated recipients alone — they exclude rather than pin', () => {
    const query = 'from:msun@mytaxfiler.com -to:kunal@cillierscpa.com';
    expect(sanitizeGmailQuery(query, ALLOWED).query).toBe(query);
  });

  it('is not fooled by to: appearing inside a quoted phrase', () => {
    const query = 'from:msun@mytaxfiler.com subject:"to: the board"';
    expect(sanitizeGmailQuery(query, ALLOWED).query).toBe(query);
  });

  it('composes with address sanitization', () => {
    // to: is dropped for pinning; the invented from: address is dropped too.
    const result = sanitizeGmailQuery(
      'from:ghost@nowhere.com to:kunal@cillierscpa.com InboxPulse',
      ALLOWED
    );

    expect(result.query).toBe('InboxPulse');
    expect(result.removed).toHaveLength(2);
  });

  it('reaches into a group to resolve a pair nested inside it', () => {
    const result = sanitizeGmailQuery(
      '(from:msun@mytaxfiler.com to:kunal@cillierscpa.com) OR InboxPulse',
      ALLOWED
    );

    expect(result.query).toBe('from:msun@mytaxfiler.com OR InboxPulse');
  });

  it('is idempotent — re-running changes nothing', () => {
    const once = sanitizeGmailQuery(
      'subject:"joiners" from:msun@mytaxfiler.com to:kunal@cillierscpa.com',
      ALLOWED
    );
    const twice = sanitizeGmailQuery(once.query, ALLOWED);

    expect(twice.query).toBe(once.query);
    expect(twice.removed).toEqual([]);
  });
});
