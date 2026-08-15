import { describe, it, expect } from 'vitest';
import { pushCard, type CardSection, type Widget } from './widgets';
import { buildHomepageCard } from './homepage';
import { buildThreadCard } from './thread';
import { signalNames } from './signals';

/** A section's real widgets, with the blank-line spacers dropped. */
const content = (section: CardSection): Widget[] =>
  section.widgets.filter((w) => !('textParagraph' in w && w.textParagraph.text.trim() === ''));

const rowsOf = (section: CardSection): { topLabel: string; text: string }[] =>
  content(section).map((w) => (w as { decoratedText: { topLabel: string; text: string } }).decoratedText);

describe('response envelope', () => {
  it('wraps a card in a bare RenderActions: action -> navigations -> pushCard (no renderActions key)', () => {
    const env = pushCard(buildHomepageCard(null));
    expect('renderActions' in env).toBe(false);
    const nav = env.action.navigations[0];
    expect(nav.pushCard).toBeDefined();
    expect(nav.pushCard.sections.length).toBeGreaterThan(0);
  });

  it('never prints the product name on the card — the add-on toolbar already shows it', () => {
    for (const card of [buildHomepageCard(null), buildThreadCard({ status: 'resolved', accountName: 'Acme' })]) {
      expect(card.header).toBeUndefined();
      expect(card.sections.map((s) => s.header)).not.toContain('InboxPulse');
    }
  });
});

describe('homepage card', () => {
  it('does not show pipeline volume', () => {
    // "Emails ingested 264,437 / Analyzed 82,782" was removed: it is a fact
    // about our pipeline, not the reader's day, and it cannot change what
    // anyone does next — the same test the label policy applies. It was also
    // occupying the space directly under the numbers that CAN be acted on.
    const flat = JSON.stringify(buildHomepageCard({ total: 174109, analyzed: 54477 }));
    expect(flat).not.toContain('174,109');
    expect(flat).not.toContain('54,477');
    expect(flat).not.toContain('This workspace');
  });

  it('shows preview copy when not connected', () => {
    expect(JSON.stringify(buildHomepageCard(null))).toContain('Preview mode');
  });
});

const openMessageSection = (card: { sections: Array<{ header?: string }> }) =>
  card.sections.find((s) => s.header === '<b>Open message</b>');

describe('thread card', () => {
  it('renders a resolved account + flags + escalation + message', () => {
    const flat = JSON.stringify(
      buildThreadCard({
        messageId: 'msg-f:123',
        status: 'resolved',
        accountName: 'Acme Inc',
        flags: ['At risk', 'Churn risk'],
        subject: 'Unhappy with the delays',
        fromEmail: 'cfo@acme.com',
        receivedAt: '2026-07-20T12:00:00.000Z',
        task: { done: false, assignee: 'V Mohan' },
      }),
    );
    expect(flat).toContain('Acme Inc');
    expect(flat).toContain('At risk, Churn risk');
    expect(flat).toContain('Unhappy with the delays');
    expect(flat).toContain('cfo@acme.com');
    expect(flat).toContain('Assigned to V Mohan');
    expect(flat).toContain('2026-07-20');
  });

  it('puts the envelope LAST, not first — Gmail already shows it', () => {
    const card = buildThreadCard({
      messageId: 'msg-f:123',
      status: 'resolved',
      accountName: 'Acme Inc',
      headers: {
        subject: 'Re: TR 2025 filing',
        from: 'Oliver Hahn <oliver@peak.insure>',
        to: 'v.mohan@mystartupcfo.com',
        cc: 'ap@peak.insure',
        bcc: 'audit@mystartupcfo.com',
      },
    });
    // The answer leads; the envelope is reference and comes last. Gmail shows
    // subject and sender inches away, so opening with them wasted the fold.
    const open = card.sections[card.sections.length - 1];
    expect(open.header).toBe('<b>Open message</b>');

    const rows = rowsOf(open);
    expect(rows.map((r) => r.topLabel)).toEqual(['Title', 'From', 'To', 'Cc', 'Bcc']);
    expect(rows[0].text).toBe('Re: TR 2025 filing');
    expect(rows[2].text).toBe('v.mohan@mystartupcfo.com');

    // The raw Gmail id is no longer surfaced anywhere on the card.
    expect(JSON.stringify(card)).not.toContain('msg-f:123');
  });

  it('renders every section heading in bold — the only emphasis Cards v2 offers', () => {
    const card = buildThreadCard({
      status: 'resolved',
      accountName: 'Acme Inc',
      subject: 'Re: TR 2025 filing',
      flags: ['At risk'],
      task: { done: false },
    });
    const headers = card.sections.map((s) => s.header).filter((h): h is string => Boolean(h));
    expect(headers.length).toBeGreaterThan(2);
    for (const h of headers) expect(h).toMatch(/^<b>.+<\/b>$/);
  });

  it('falls back to InboxPulse-side subject/sender when Gmail headers are unavailable', () => {
    const card = buildThreadCard({
      messageId: 'm',
      status: 'resolved',
      subject: 'Unhappy with the delays',
      fromEmail: 'cfo@acme.com',
    });
    const open = openMessageSection(card)!;
    const rows = rowsOf(open);
    expect(rows.map((r) => r.topLabel)).toEqual(['Title', 'From']);
    expect(rows[0].text).toBe('Unhappy with the delays');
  });

  it('says so plainly when nothing is known about the open message', () => {
    const open = openMessageSection(buildThreadCard({ status: 'preview' }))!;
    expect((open.widgets[0] as { textParagraph: { text: string } }).textParagraph.text).toContain(
      'No details available',
    );
  });

  it('marks a resolved escalation done', () => {
    const flat = JSON.stringify(
      buildThreadCard({ messageId: 'm', status: 'resolved', accountName: 'X', task: { done: true } }),
    );
    expect(flat).toContain('✓ Resolved');
    expect(flat).toContain('Unassigned');
  });

  it('shows preview text when not connected', () => {
    expect(JSON.stringify(buildThreadCard({ status: 'preview' }))).toContain('Preview mode');
  });

  it('shows the untracked-message state', () => {
    const flat = JSON.stringify(buildThreadCard({ messageId: 'x', status: 'untracked' }));
    // Assert the state is explained, not the exact sentence — the copy is
    // deliberately editable, but an untracked message must always say why it is
    // untracked and what would change that.
    expect(flat).toContain('Not a tracked client thread');
    expect(flat).toContain('Open a thread with a customer');
  });

  it('shows the open message even when the thread is untracked', () => {
    const flat = JSON.stringify(
      buildThreadCard({ messageId: 'x', status: 'untracked', headers: { subject: 'Internal note' } }),
    );
    expect(flat).toContain('Internal note');
    expect(flat).toContain('Not a tracked client thread');
  });

  it('shows the unidentified-workspace state', () => {
    const flat = JSON.stringify(buildThreadCard({ status: 'unidentified' }));
    expect(flat).toContain("isn't linked to an InboxPulse workspace");
    expect(flat).toContain('add-on homepage');
  });
});

describe('signalNames', () => {
  it('dedupes and maps codes to design labels', () => {
    expect(signalNames([2, 10, 30, 31])).toEqual(['Negative', 'At risk', 'Churn risk']);
  });
  it('is empty-safe', () => {
    expect(signalNames()).toEqual([]);
    expect(signalNames([999])).toEqual([]);
  });
});

/**
 * The management sections must name people and clients, not just count them.
 *
 * "Account managers carrying it" was retired here. It counted unanswered angry
 * threads per person and had stopped saying anything — its top real manager
 * carried two. What a manager actually asks is where the damage is and who to
 * call about it, so the same population is now shown by CLIENT with the owner
 * named on the row, alongside a per-person reply-time median.
 */
describe('where the fires are', () => {
  const fires = {
    webUrl: 'https://example.test',
    fires: [
      {
        customerId: 'c1',
        customer: 'Deserve, Inc.',
        negative: 18,
        unanswered: 8,
        oldestDays: 74,
        owner: 'Sukrati Gupta',
      },
      {
        customerId: 'c2',
        customer: 'Truefoundry',
        negative: 9,
        unanswered: 6,
        oldestDays: 59,
        owner: null,
      },
    ],
  };
  const card = (): string =>
    JSON.stringify(
      buildHomepageCard(null, undefined, undefined, undefined, undefined, fires),
    );

  it('names the client and the damage', () => {
    expect(card()).toContain('Deserve, Inc.');
    expect(card()).toContain('8 unanswered');
  });

  /** A fire without a name attached is an observation, not an action. */
  it('names the account manager to call', () => {
    expect(card()).toContain('Sukrati Gupta');
  });

  /**
   * An unallocated client with six unanswered complaints is a WORSE finding
   * than an allocated one. Hiding the null would hide the worst cases.
   */
  it('says so when nobody owns the client, rather than omitting the row', () => {
    expect(card()).toContain('Truefoundry');
    expect(card()).toContain('no account manager');
  });

  /**
   * The escalations page reads `customer`, not `customerId`. A wrong param does
   * not error — the page loads unfiltered — so the link would look like it
   * worked while showing everything.
   */
  it('deep-links with the param name the escalations route reads', () => {
    expect(card()).toContain('customer=c1');
    expect(card()).not.toContain('customerId=');
  });
});

describe('slowest to answer angry mail', () => {
  const slow = {
    firmMedianH: 12.9,
    people: [
      { name: 'Ganesh Shankar', threads: 10, medianH: 79.3 },
      { name: 'Meghana Muralidhar Murthy', threads: 22, medianH: 50.1 },
    ],
  };
  const card = (): string =>
    JSON.stringify(
      buildHomepageCard(null, undefined, undefined, undefined, undefined, undefined, slow),
    );

  it('names the person and compares them to the firm', () => {
    expect(card()).toContain('Ganesh Shankar');
    expect(card()).toContain('12.9h firm-wide');
  });

  /**
   * The sample size is not optional. A median over ten threads is thin, and a
   * person named as slowest cannot argue with a number whose basis is hidden.
   */
  it('shows the sample the median rests on', () => {
    expect(card()).toContain('10 answered threads');
  });

  /**
   * Only ANSWERED threads have a duration, so someone who never replies at all
   * cannot appear here and looks better than someone who replies slowly. That
   * limitation has to be on the card, not just in a comment.
   */
  it('states that unanswered mail is excluded', () => {
    expect(card()).toContain('Answered threads only');
  });
});
