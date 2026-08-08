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
  it('shows live stats when connected', () => {
    const flat = JSON.stringify(buildHomepageCard({ total: 174109, analyzed: 54477 }));
    expect(flat).toContain('174,109');
    expect(flat).toContain('54,477');
  });

  it('shows preview copy when not connected', () => {
    expect(JSON.stringify(buildHomepageCard(null))).toContain('Preview mode');
  });
});

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

  it('opens with a bold "Open message" section describing the email, not its id', () => {
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
    const [open] = card.sections;
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
    const [open] = buildThreadCard({
      messageId: 'm',
      status: 'resolved',
      subject: 'Unhappy with the delays',
      fromEmail: 'cfo@acme.com',
    }).sections;
    const rows = rowsOf(open);
    expect(rows.map((r) => r.topLabel)).toEqual(['Title', 'From']);
    expect(rows[0].text).toBe('Unhappy with the delays');
  });

  it('says so plainly when nothing is known about the open message', () => {
    const [open] = buildThreadCard({ status: 'preview' }).sections;
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
    expect(JSON.stringify(buildThreadCard({ messageId: 'x', status: 'untracked' }))).toContain(
      "isn't a tracked",
    );
  });

  it('shows the open message even when the thread is untracked', () => {
    const flat = JSON.stringify(
      buildThreadCard({ messageId: 'x', status: 'untracked', headers: { subject: 'Internal note' } }),
    );
    expect(flat).toContain('Internal note');
    expect(flat).toContain("isn't a tracked");
  });

  it('shows the unidentified-workspace state', () => {
    expect(JSON.stringify(buildThreadCard({ status: 'unidentified' }))).toContain(
      "Couldn't match your Google account",
    );
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
