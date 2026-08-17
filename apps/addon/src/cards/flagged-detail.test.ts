import { describe, it, expect } from 'vitest';
import { buildFlaggedDetailCard } from './flagged-detail';
import { extractBodyText, stripQuotedReply } from '../gmail/gmail-api';
import type { FlaggedMessage } from './flagged';

const message: FlaggedMessage = {
  messageId: '19f7fc0a4fd52871',
  fromEmail: 'oliver@peak.insure',
  fromName: 'Oliver Hahn',
  receivedAt: '2026-05-26T00:00:00Z',
  subject: 'Re: TR 2025',
  severity: 84,
  flags: [
    {
      type: 'churn',
      label: 'Churn risk · High',
      detail: 'Client is frustrated and blaming us for the delay.',
      provenance: 'AI · 95%',
    },
  ],
};

const b64url = (s: string): string => Buffer.from(s, 'utf8').toString('base64url');

describe('buildFlaggedDetailCard', () => {
  it('leads with why it was flagged, then the message, then its content', () => {
    const card = buildFlaggedDetailCard({ message, body: 'We are still waiting on the filing.' });
    expect(card.sections.map((s) => s.header)).toEqual([
      '<b>Why this was flagged</b>',
      '<b>Message</b>',
      '<b>Content</b>',
      undefined, // the Open-in-Gmail button row
    ]);
    const flat = JSON.stringify(card);
    expect(flat).toContain('Churn risk · High');
    expect(flat).toContain('frustrated and blaming us');
    expect(flat).toContain('AI · 95%');
    expect(flat).toContain('We are still waiting on the filing.');
    expect(flat).toContain('Oliver Hahn <oliver@peak.insure>');
  });

  it('still renders the flags when the body could not be fetched', () => {
    const flat = JSON.stringify(buildFlaggedDetailCard({ message }));
    expect(flat).toContain('Churn risk · High');
    expect(flat).toContain("Couldn't load this message's content");
  });

  it('truncates a very long body rather than blowing up the card', () => {
    const card = buildFlaggedDetailCard({ message, body: 'x'.repeat(5000) });
    const content = (card.sections[2].widgets[0] as { textParagraph: { text: string } }).textParagraph.text;
    expect(content.length).toBeLessThan(1300);
    expect(content.endsWith('…')).toBe(true);
  });

  it('keeps an Open in Gmail escape hatch pointed at the viewer’s account', () => {
    const card = buildFlaggedDetailCard({ message, viewerEmail: 'v.mohan@mystartupcfo.com' });
    expect(JSON.stringify(card)).toContain(
      'https://mail.google.com/mail/?authuser=v.mohan%40mystartupcfo.com#all/19f7fc0a4fd52871',
    );
  });
});

describe('stripQuotedReply', () => {
  it('drops the quoted chain below the attribution line', () => {
    const body = 'Any update?\n\nOn Mon, May 25, 2026 at 9:00 AM Someone <a@b.com> wrote:\n> earlier text\n> more';
    expect(stripQuotedReply(body)).toBe('Any update?');
  });

  it('drops bare quoted lines even with no attribution', () => {
    expect(stripQuotedReply('Thanks!\n> old message')).toBe('Thanks!');
  });
});

describe('extractBodyText', () => {
  it('prefers the text/plain part', () => {
    const payload = {
      mimeType: 'multipart/alternative',
      parts: [
        { mimeType: 'text/plain', body: { data: b64url('plain wins') } },
        { mimeType: 'text/html', body: { data: b64url('<p>html loses</p>') } },
      ],
    };
    expect(extractBodyText(payload)).toBe('plain wins');
  });

  it('falls back to text/html, stripped of markup', () => {
    const payload = {
      mimeType: 'multipart/alternative',
      parts: [{ mimeType: 'text/html', body: { data: b64url('<p>Hello <b>there</b></p>') } }],
    };
    expect(extractBodyText(payload)).toBe('Hello there');
  });

  it('finds a part nested inside multipart/related', () => {
    const payload = {
      mimeType: 'multipart/mixed',
      parts: [
        {
          mimeType: 'multipart/related',
          parts: [{ mimeType: 'text/plain', body: { data: b64url('nested body') } }],
        },
      ],
    };
    expect(extractBodyText(payload)).toBe('nested body');
  });

  it('is empty-safe on a payload with no usable part', () => {
    expect(extractBodyText(undefined)).toBe('');
    expect(extractBodyText({ mimeType: 'text/plain' })).toBe('');
  });
});

describe('what the wording means', () => {
  const base = {
    messageId: 'm1',
    subject: 'Re: March close',
    fromEmail: 'cfo@client.com',
    receivedAt: '2026-08-01T09:00:00Z',
    flags: [],
  } as never;

  it('teaches the register when a reliable pattern is present', () => {
    const card = buildFlaggedDetailCard({
      message: base,
      body: 'Not good to have so many iterations on this.',
    });
    const json = JSON.stringify(card);
    expect(json).toContain('What the wording means');
    expect(json).toContain('Understatement used as criticism');
    // The quote anchors the lesson to the text the reader is looking at.
    expect(json).toContain('Not good');
  });

  it('stays silent rather than guessing on ordinary mail', () => {
    const card = buildFlaggedDetailCard({
      message: base,
      body: 'Attaching the March bank statements as requested. Thanks!',
    });
    expect(JSON.stringify(card)).not.toContain('What the wording means');
  });

  it('never shows a pattern that infers what the writer meant', () => {
    // "holding up" and "get on a call" both match the lexicon but scored 6 of 10
    // held out. A confident wrong lesson is worse than no lesson.
    const card = buildFlaggedDetailCard({
      message: base,
      body: 'This is holding up our KYC — can we get on a call today?',
    });
    expect(JSON.stringify(card)).not.toContain('What the wording means');
  });

  it('shows at most three, so the section stays readable on a phone', () => {
    const card = buildFlaggedDetailCard({
      message: base,
      body:
        'Not good. As I mentioned last week this is wrong. I thought we agreed. ' +
        'Why would you need that? We have not received the file. Sorry, but this is a mess.',
    });
    const section = JSON.stringify(card).split('What the wording means')[1] ?? '';
    expect((section.match(/reads as:/g) ?? []).length).toBeLessThanOrEqual(3);
  });

  it('says nothing when the body could not be fetched', () => {
    const card = buildFlaggedDetailCard({ message: base });
    expect(JSON.stringify(card)).not.toContain('What the wording means');
  });
});
