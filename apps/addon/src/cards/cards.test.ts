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
 * The unallocated row must NAME the customers behind it.
 *
 * A management review's biggest bucket being "16 threads, nobody allocated"
 * prompts no action, because the bucket is not one kind of thing: measured on
 * live data it mixes real clients absent from the allocation sheet
 * (Truefoundry, Minerra, Elemind) with our own vendors and counterparties
 * (SVB, Rippling, Bill). Those need opposite responses — assign an owner
 * versus stop treating a vendor as a client — and only the names distinguish
 * them. See ADR-020 for how this population is scoped.
 */
describe('unallocated account-manager row', () => {
  const ownerLoad = {
    webUrl: 'https://example.test',
    owners: [
      {
        name: '(not allocated)',
        threads: 16,
        oldestDays: 12,
        unassigned: true,
        customers: [
          { name: 'Truefoundry', threads: 3 },
          // The real customer name, verbatim — the length is the point.
          { name: 'Minerra Health Inc (Twenty30 Health Inc.)', threads: 2 },
          { name: 'Rippling', threads: 2 },
          { name: 'Svb', threads: 1 },
          { name: 'Elemind', threads: 1 },
        ],
      },
      { name: 'Amanda Tabb', threads: 2, oldestDays: 5, unassigned: false },
    ],
  };

  const text = (): string =>
    JSON.stringify(buildHomepageCard(null, undefined, undefined, undefined, undefined, ownerLoad));

  it('names the customers rather than only counting them', () => {
    expect(text()).toContain('Truefoundry');
    expect(text()).toContain('Rippling');
  });

  it('caps the list, because bottomLabel is single-line and Gmail clips it', () => {
    // Fourth and fifth names must not render — the cap is what keeps the row
    // legible in a panel that clips rather than wraps.
    expect(text()).not.toContain('Svb');
    expect(text()).not.toContain('Elemind');
  });

  /**
   * A long legal name must not eat the row.
   *
   * The real top four render as 70 characters, most of it one client's
   * "... Inc (Twenty30 Health Inc.)". Gmail clips that mid-name and the later
   * entries — the vendors, which are the reason to read the list at all —
   * never appear. Clipping ourselves is what keeps them visible.
   */
  it('truncates a long customer name instead of letting Gmail clip the row', () => {
    expect(text()).toContain('Minerra Health In…');
    expect(text()).not.toContain('Minerra Health Inc');
  });

  it('does not attach customer names to a real manager row', () => {
    const amanda = JSON.stringify(
      (buildHomepageCard(null, undefined, undefined, undefined, undefined, {
        ...ownerLoad,
        owners: [ownerLoad.owners[1]],
      }) as unknown as { sections: unknown[] }).sections,
    );
    expect(amanda).toContain('Amanda Tabb');
    expect(amanda).not.toContain('Truefoundry');
  });
});
