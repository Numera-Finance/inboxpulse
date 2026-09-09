import { describe, it, expect } from 'vitest';
import { detectCapitalEvent } from './capital-event';

/**
 * Every negative case here is a REAL false positive from the corpus, not an
 * invented one. They are the reason the requested sixteen categories became
 * three flags, and a test built from imagined inputs would have caught none of
 * them.
 */

const from = (fromEmail: string, body: string, subject = '') => ({ subject, body, fromEmail });

describe('the three flags fire on what they are for', () => {
  it('flags a data room, the strongest signal at 97% over 30 threads', () => {
    const hit = detectCapitalEvent(
      from('cfo@stepsecurity.io', 'while preparing our series a data room, we found calculation errors'),
    );
    expect(hit?.flag).toBe('data-room');
  });

  it('flags a term sheet', () => {
    const hit = detectCapitalEvent(
      from('founder@babbacare.com', "i recently received an investment term sheet that i'd like reviewed before signing"),
    );
    expect(hit?.flag).toBe('term-sheet');
  });

  it('flags an outright declaration', () => {
    const hit = detectCapitalEvent(
      from('ceo@visolisbio.com', "we're starting to put together the investor data room for our next fundraise"),
    );
    expect(hit).not.toBeNull();
  });

  it('quotes the phrase it matched, so the panel shows evidence not a verdict', () => {
    const hit = detectCapitalEvent(from('x@client.com', 'sharing the draft term sheet and the liabilities document'));
    expect(hit?.phrase).toBe('term sheet');
  });

  it('treats M&A as a capital event, because it is', () => {
    // 5 of 20 term-sheet threads were acquisitions. DeepSource, mid-acquisition,
    // generates more controller work than most Series A preparation.
    const hit = detectCapitalEvent(
      from('cto@deepsource.io', "the buyer's finance team has sent a set of questions through the data room"),
    );
    expect(hit?.flag).toBe('data-room');
  });

  it('treats debt as a capital event too', () => {
    const hit = detectCapitalEvent(
      from('banker@avidbank.com', 'please see the attached term sheet outlining the restructure of the loc'),
    );
    expect(hit).not.toBeNull();
  });
});

describe('the excluded classes stay excluded', () => {
  it('does not fire on cap table, which is 627 threads at 5% event precision', () => {
    expect(detectCapitalEvent(from('a@falconx.io', 'to ensure our cap table remains clean and reconciled'))).toBeNull();
  });

  it('does not fire on 409a, an annual obligation for anyone with an option plan', () => {
    expect(detectCapitalEvent(from('a@lumian.ai', 'we are conducting our 409a valuation, i need the latest balance sheet'))).toBeNull();
  });

  it('does not fire on convertible-note accounting for a round closed years ago', () => {
    expect(detectCapitalEvent(from('a@etherdyne.net', 'convertible notes were converted; reclassify to account 2910'))).toBeNull();
  });

  it('does not fire on a SAFE collected to close the books', () => {
    expect(detectCapitalEvent(from('a@stomio.io', 'please use the same old table. all safe agreements we shared'))).toBeNull();
  });
});

describe('it does not alert on Numera itself', () => {
  it('ignores our own retainer language selling due diligence as a service', () => {
    // Verbatim from a Numera retainer found in the corpus.
    expect(
      detectCapitalEvent(
        from('ops@pegbo.com', 'income tax filings, business registrations, audit / due diligence support, finance operations'),
      ),
    ).toBeNull();
  });

  it('ignores a retainer that also happens to mention a term sheet', () => {
    expect(
      detectCapitalEvent(from('x@sensorup.com', 'included in this retainer are cfo services, financial modeling, audit / due diligence')),
    ).toBeNull();
  });

  it('ignores internal Google Chat and Notes, the largest false-positive class at 10.5%', () => {
    expect(detectCapitalEvent(from('notifications@google.com', 'hi harshit, do we have the term sheet too or just the spa?'))).toBeNull();
  });

  it('ignores the disprz LMS advertising a cap-table course', () => {
    expect(
      detectCapitalEvent(from('learning@disprz.com', "thank you for enrolling to the numera module 'cap table reconciliation training session'")),
    ).toBeNull();
  });
});

describe('it does not alert on other companies', () => {
  it('ignores a newsletter announcing somebody else round', () => {
    expect(detectCapitalEvent(from('hi@mail.beehiiv.com', "🦄 $73b series b: inside software's last major frontier"))).toBeNull();
  });

  it('ignores a LinkedIn deal feed', () => {
    expect(detectCapitalEvent(from('news@linkedin.com', 'GridCARE secures $64M series a funding to tackle one of the grid'))).toBeNull();
  });
});

describe('substring traps that cost two published numbers a retraction', () => {
  it('does not match 409a inside a hex GUID', () => {
    // startupgenome.com matched on `...4ab083e2409a` in a Google Docs GUID.
    expect(detectCapitalEvent(from('a@startupgenome.com', 'docs-internal-guid-4aff5028-7fff-2f12-5311-4ab083e2409a'))).toBeNull();
  });

  it('does not treat warranty as a warrant', () => {
    // 274 of 278 `warrant` threads were "warranty" or "warrants" as a verb.
    expect(detectCapitalEvent(from('a@client.com', 'the warranty period expires next month and this warrants a review'))).toBeNull();
  });

  it('does not fire on "series" as an ordinary word', () => {
    expect(detectCapitalEvent(from('a@client.com', 'this training series aligned the team on 52 series accounts'))).toBeNull();
  });

  it('does not let a client name match itself', () => {
    // fundraisly.com contributed 8 threads on its company name alone.
    expect(
      detectCapitalEvent({
        subject: 'Monthly financials',
        body: 'attached are the march numbers from the fundraisly team',
        fromEmail: 'ap@fundraisly.com',
        customerDomain: 'fundraisly.com',
      }),
    ).toBeNull();
  });
});

describe('the vendor domain is NOT evidence, after three misfires', () => {
  it('does not flag a data-room vendor emailing us', () => {
    // suralink.com produced 109 of 239 backfilled emails, 46% of the signal, all
    // "N New Notifications for <Numera staff>". It is the auditor's tool that we
    // use, not something the client bought.
    expect(detectCapitalEvent(from('notify@suralink.com', '2 New Notifications for Sneha Suralikal'))).toBeNull();
  });

  it('still catches the client forwarding a data-room invoice, via the phrase', () => {
    const hit = detectCapitalEvent(from('finance@firebird.ai', 'FW: DFIN Venue invoice approved. data room cost, payment should be setup'));
    expect(hit?.flag).toBe('data-room');
  });

  it('does not flag Carta, cap-table software used continuously', () => {
    expect(detectCapitalEvent(from('no-reply@carta.com', 'Ryan Kim requests access to your cap table'))).toBeNull();
  });
});

describe('shape', () => {
  it('returns null rather than throwing on empty input', () => {
    expect(detectCapitalEvent({ subject: null, body: null, fromEmail: null })).toBeNull();
    expect(detectCapitalEvent({ subject: '', body: '', fromEmail: 'a@b.com' })).toBeNull();
  });
});

describe('the artifact class cannot re-enter through the vendor door', () => {
  it('does not flag a 409A valuation provider, whose reports are an annual obligation', () => {
    // A first pass listed etonvs.com as a capital-event vendor. The corpus check
    // caught it: six of sixty-eight hits were annual IRC409A FMV reports.
    expect(
      detectCapitalEvent(from('reports@etonvs.com', 'please find attached our final 409a report, which covers the irc409a')),
    ).toBeNull();
  });
});
