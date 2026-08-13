import { describe, it, expect } from 'vitest';
import { buildFlaggedSection, type FlaggedMessage } from './flagged';
import { buildThreadCard } from './thread';

const msg = (over: Partial<FlaggedMessage>): FlaggedMessage => ({
  messageId: 'm1',
  fromEmail: 'oliver@peak.insure',
  fromName: 'Oliver Hahn',
  receivedAt: '2026-05-26T00:00:00Z',
  subject: 'Re: TR 2025',
  severity: 84,
  flags: [{ type: 'churn', label: 'Churn risk · High', detail: 'Client is frustrated and blaming us.', provenance: 'AI · 95%' }],
  ...over,
});

describe('buildFlaggedSection', () => {
  it('returns null when nothing is flagged', () => {
    expect(buildFlaggedSection([])).toBeNull();
  });

  it('renders flag label(s), the why reason, and provenance', () => {
    const section = buildFlaggedSection([msg({})])!;
    const d = (section.widgets[0] as { decoratedText: { topLabel: string; text: string; bottomLabel: string } }).decoratedText;
    // Flag labels live in `text`, not topLabel: only `text` renders the HTML
    // subset, so a coloured label in topLabel would print its <font> tag.
    expect(d.text).toContain('Churn risk · High');
    expect(d.text).toContain('#c5221f');
    expect(d.topLabel).toContain('Oliver Hahn');
    expect(d.text).toContain('frustrated');
    expect(d.bottomLabel).toContain('AI · 95%');
    expect(d.topLabel).toContain('2026-05-26');
  });

  it('surfaces keyword-rule provenance verbatim', () => {
    const section = buildFlaggedSection([
      msg({ flags: [{ type: 'escalation', label: 'At risk', detail: 'blocked on integration', provenance: 'Keyword rule match' }] }),
    ])!;
    const d = (section.widgets[0] as { decoratedText: { bottomLabel: string } }).decoratedText;
    expect(d.bottomLabel).toContain('Keyword rule match');
  });

  it('caps the list and summarises the remainder', () => {
    const many = Array.from({ length: 8 }, (_, i) => msg({ messageId: `m${i}` }));
    const section = buildFlaggedSection(many, { max: 5 })!;
    // 5 message widgets + 1 "+3 more" summary
    expect(section.widgets).toHaveLength(6);
    const last = section.widgets[5] as { textParagraph: { text: string } };
    expect(last.textParagraph.text).toContain('+ 3 more flagged messages');
  });

  it('lists messages oldest first, newest last', () => {
    const section = buildFlaggedSection([
      msg({ messageId: 'mid', receivedAt: '2026-05-20T00:00:00Z', severity: 90 }),
      msg({ messageId: 'newest', receivedAt: '2026-06-02T00:00:00Z', severity: 40 }),
      msg({ messageId: 'oldest', receivedAt: '2026-05-04T00:00:00Z', severity: 70 }),
    ])!;
    const days = section.widgets.map(
      (w) => (w as { decoratedText: { topLabel: string } }).decoratedText.topLabel,
    );
    expect(days[0]).toContain('2026-05-04');
    expect(days[1]).toContain('2026-05-20');
    expect(days[2]).toContain('2026-06-02');
  });

  it('keeps the most severe messages when capping, then orders them chronologically', () => {
    const section = buildFlaggedSection(
      [
        msg({ messageId: 'severe-late', receivedAt: '2026-06-01T00:00:00Z', severity: 100 }),
        msg({ messageId: 'severe-early', receivedAt: '2026-05-01T00:00:00Z', severity: 90 }),
        msg({ messageId: 'mild', receivedAt: '2026-05-15T00:00:00Z', severity: 10 }),
      ],
      { max: 2 },
    )!;
    const urls = section.widgets
      .slice(0, 2)
      .map((w) => (w as { decoratedText: { onClick: { openLink: { url: string } } } }).decoratedText.onClick.openLink.url);
    expect(urls[0]).toContain('severe-early');
    expect(urls[1]).toContain('severe-late');
  });

  it('deep-links each row to its message in the viewer’s Gmail account', () => {
    const section = buildFlaggedSection([msg({ messageId: '19f7fc0a4fd52871' })], { viewerEmail: 'v.mohan@mystartupcfo.com' })!;
    const { onClick } = (section.widgets[0] as { decoratedText: { onClick: { openLink: { url: string } } } }).decoratedText;
    expect(onClick.openLink.url).toBe(
      'https://mail.google.com/mail/?authuser=v.mohan%40mystartupcfo.com#all/19f7fc0a4fd52871',
    );
  });

  it('never puts an email in the /u/ path segment (that segment takes an index, and Gmail 404s)', () => {
    const section = buildFlaggedSection([msg({ messageId: 'abc' })], { viewerEmail: 'v.mohan@mystartupcfo.com' })!;
    const { onClick } = (section.widgets[0] as { decoratedText: { onClick: { openLink: { url: string } } } }).decoratedText;
    expect(onClick.openLink.url).not.toMatch(/\/mail\/u\/[^0-9]/);
  });

  it('falls back to the default Gmail account when the viewer is unknown', () => {
    const section = buildFlaggedSection([msg({ messageId: 'abc' })])!;
    const { onClick } = (section.widgets[0] as { decoratedText: { onClick: { openLink: { url: string } } } }).decoratedText;
    expect(onClick.openLink.url).toBe('https://mail.google.com/mail/u/0/#all/abc');
  });

  it('opens as an overlay so the reader stays in the thread instead of losing a tab', () => {
    const section = buildFlaggedSection([msg({})])!;
    const { openLink } = (
      section.widgets[0] as { decoratedText: { onClick: { openLink: { openAs: string; onClose?: string } } } }
    ).decoratedText.onClick;
    expect(openLink.openAs).toBe('OVERLAY');
    // onClose must stay unset: where a client can't honour both, it wins over openAs.
    expect(openLink.onClose).toBeUndefined();
  });

  it('expands in the panel via an action callback when a base URL is available', () => {
    const section = buildFlaggedSection([msg({ messageId: 'm-9' })], {
      baseUrl: 'https://crm-addon.example.run.app/',
      threadId: 'thread-uuid',
    })!;
    const { onClick } = (
      section.widgets[0] as {
        decoratedText: {
          onClick: {
            action?: { function: string; parameters: { key: string; value: string }[] };
            openLink?: unknown;
          };
        };
      }
    ).decoratedText;
    // Trailing slash normalized; no navigation — the row calls us back.
    expect(onClick.action?.function).toBe('https://crm-addon.example.run.app/gmail/flagged/detail');
    expect(onClick.action?.parameters).toEqual([
      { key: 'messageId', value: 'm-9' },
      { key: 'threadId', value: 'thread-uuid' },
    ]);
    expect(onClick.openLink).toBeUndefined();
  });
});

describe('thread card integration', () => {
  it('includes Flagged messages only when present', () => {
    const withFlagged = JSON.stringify(buildThreadCard({ status: 'resolved', flagged: [msg({})] }));
    expect(withFlagged).toContain('Flagged messages');
    const without = JSON.stringify(buildThreadCard({ status: 'resolved' }));
    expect(without).not.toContain('Flagged messages');
  });
});
