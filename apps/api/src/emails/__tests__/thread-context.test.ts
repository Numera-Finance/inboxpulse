import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import { buildThreadContext, type ThreadContextEmail } from '../thread-context';
import { buildParticipantRoster } from '../participant-roles';

const TENANT_DOMAINS = ['mystartupcfo.com'];

function message(overrides: Partial<ThreadContextEmail> & { messageId: string }): ThreadContextEmail {
  return {
    subject: 'Weekly Statement',
    fromEmail: 'jonathan@acme-client.com',
    fromName: 'Jonathan Tang',
    tos: [{ email: 'mbala@mystartupcfo.com', name: 'Manju Bala' }],
    body: 'Plain body text.',
    receivedAt: new Date('2026-07-27T17:57:00Z'),
    ...overrides,
  };
}

describe('buildThreadContext', () => {
  it('reports no history for an empty thread', () => {
    expect(buildThreadContext([], 'm1').threadContext).toBe('No thread history available');
  });

  it('orders messages oldest-first and marks the current one', () => {
    const context = buildThreadContext(
      [
        message({ messageId: 'm2', receivedAt: new Date('2026-07-28T00:00:00Z'), body: 'second' }),
        message({ messageId: 'm1', receivedAt: new Date('2026-07-27T00:00:00Z'), body: 'first' }),
      ],
      'm2'
    ).threadContext;

    expect(context.indexOf('first')).toBeLessThan(context.indexOf('second'));
    expect(context).toContain('[CURRENT] From: Jonathan Tang <jonathan@acme-client.com>');
    expect(context.match(/\[CURRENT\]/g)).toHaveLength(1);
  });

  it('includes up to 8 messages, keeping the most recent', () => {
    const messages = Array.from({ length: 12 }, (_, i) =>
      message({
        messageId: `m${i}`,
        body: `body-${i}`,
        receivedAt: new Date(Date.UTC(2026, 6, i + 1)),
      })
    );

    const context = buildThreadContext(messages, 'm11').threadContext;

    expect(context).toContain('showing the 8 most recent of 12 messages');
    expect(context).not.toContain('body-3');
    expect(context).toContain('body-4');
    expect(context).toContain('body-11');
  });

  it('announces the full count when the thread fits in the window', () => {
    const context = buildThreadContext([message({ messageId: 'm1' })], 'm1').threadContext;
    expect(context).toContain('Thread History (1 messages)');
  });

  // The previous implementation truncated at 300 characters, which cut most real
  // messages mid-sentence.
  it('does not truncate long bodies', () => {
    const longBody = `START ${'x'.repeat(2000)} END`;
    const context = buildThreadContext([message({ messageId: 'm1', body: longBody })], 'm1')
      .threadContext;

    expect(context).toContain('END');
    expect(context).not.toContain('...');
  });

  // Bodies are stored as raw Gmail HTML; without conversion the model reads markup.
  it('converts HTML bodies to text', () => {
    const context = buildThreadContext(
      [message({ messageId: 'm1', body: '<div dir="ltr"><p>Hello <b>there</b></p></div>' })],
      'm1'
    ).threadContext;

    expect(context).toContain('Hello');
    expect(context).toContain('there');
    expect(context).not.toContain('<div');
  });

  // Every turn embeds the whole prior chain; including it verbatim would repeat
  // the thread once per message.
  it('strips quoted history from each message', () => {
    const quoted = [
      'My actual reply.',
      '',
      'On Mon, Jul 27, 2026 at 5:57 PM Manju Bala <mbala@mystartupcfo.com> wrote:',
      '> An earlier message that should not be repeated.',
    ].join('\n');

    const context = buildThreadContext([message({ messageId: 'm1', body: quoted })], 'm1')
      .threadContext;

    expect(context).toContain('My actual reply.');
    expect(context).not.toContain('should not be repeated');
  });

  it('keeps the raw body when dequoting would leave nothing behind', () => {
    const onlyQuote = '> Entirely quoted content.';
    const context = buildThreadContext([message({ messageId: 'm1', body: onlyQuote })], 'm1')
      .threadContext;

    expect(context).toContain('Entirely quoted content.');
  });

  describe('with a participant roster', () => {
    const messages: ThreadContextEmail[] = [
      message({
        messageId: 'm1',
        fromEmail: 'reginacheung@talapparel.com',
        fromName: 'Regina Cheung',
        tos: [{ email: 'jonathan@acme-client.com', name: 'Jonathan Tang' }],
        ccs: [{ email: 'mbala@mystartupcfo.com', name: 'Manju Bala' }],
        body: 'Please settle the overdue balance.',
      }),
    ];

    const roster = buildParticipantRoster(
      messages,
      TENANT_DOMAINS,
      new Set(['acme-client.com'])
    );

    it('heads the block with the roster', () => {
      const context = buildThreadContext(messages, 'm1', roster).threadContext;
      expect(context).toContain('Participants:');
      expect(context).toContain('  mbala@mystartupcfo.com Manju Bala [US]');
      expect(context).toContain('  jonathan@acme-client.com Jonathan Tang [CUSTOMER]');
      expect(context).toContain('  reginacheung@talapparel.com Regina Cheung [UNKNOWN_EXTERNAL]');
    });

    // Being in To vs Cc is what separates "addressed to us" from "we are copied".
    it('renders per-message To and Cc with role labels', () => {
      const context = buildThreadContext(messages, 'm1', roster).threadContext;
      expect(context).toContain('To: Jonathan Tang <jonathan@acme-client.com> [CUSTOMER]');
      expect(context).toContain('Cc: Manju Bala <mbala@mystartupcfo.com> [US]');
      expect(context).toContain(
        'From: Regina Cheung <reginacheung@talapparel.com> [UNKNOWN_EXTERNAL]'
      );
    });

    it('omits role labels entirely when no roster is supplied', () => {
      const context = buildThreadContext(messages, 'm1').threadContext;
      expect(context).not.toContain('Participants:');
      expect(context).not.toContain('[US]');
      expect(context).toContain('To: Jonathan Tang <jonathan@acme-client.com>');
    });

    it('omits the Cc line when a message has no Cc', () => {
      const noCc = [message({ messageId: 'm1', ccs: null })];
      const context = buildThreadContext(noCc, 'm1', roster).threadContext;
      expect(context).not.toContain('Cc:');
    });
  });
});
