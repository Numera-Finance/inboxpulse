import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchMessageHeaders, normalizeGmailMessageId } from './gmail-api';

afterEach(() => vi.restoreAllMocks());

describe('normalizeGmailMessageId', () => {
  it('converts a msg-f:<decimal> id to the canonical hex form', () => {
    // Real "US New joiners" message: DB stores hex 19f7fc0a4fd52871.
    const hex = '19f7fc0a4fd52871';
    const decimal = BigInt('0x' + hex).toString(); // what the event would carry
    expect(normalizeGmailMessageId(`msg-f:${decimal}`)).toBe(hex);
  });

  it('handles msg-a: / msg-r: prefixes too', () => {
    expect(normalizeGmailMessageId('msg-a:100')).toBe('64');
    expect(normalizeGmailMessageId('msg-r:255')).toBe('ff');
  });

  it('passes a bare hex id through unchanged', () => {
    expect(normalizeGmailMessageId('19f7fc0a4fd52871')).toBe('19f7fc0a4fd52871');
  });

  it('is undefined-safe', () => {
    expect(normalizeGmailMessageId(undefined)).toBeUndefined();
  });
});

describe('fetchMessageHeaders', () => {
  const respondWith = (headers: { name: string; value: string }[]): void => {
    global.fetch = vi.fn(
      async () => new Response(JSON.stringify({ payload: { headers } }), { status: 200 }),
    ) as unknown as typeof fetch;
  };

  it('extracts the Message-Id header from the Gmail metadata response', async () => {
    respondWith([
      { name: 'Delivered-To', value: 'x@y.com' },
      { name: 'Message-ID', value: '<abc123@mail.gmail.com>' },
    ]);
    const h = await fetchMessageHeaders('msg-1', 'oauth-tok', 'access-tok');
    expect(h?.rfcMessageId).toBe('<abc123@mail.gmail.com>');
  });

  it('extracts subject / from / to / cc / bcc for the Open message section', async () => {
    respondWith([
      { name: 'Subject', value: 'Re: TR 2025 filing' },
      { name: 'From', value: 'Oliver Hahn <oliver@peak.insure>' },
      { name: 'To', value: 'v.mohan@mystartupcfo.com' },
      { name: 'Cc', value: 'ap@peak.insure, cfo@peak.insure' },
      { name: 'Bcc', value: 'audit@mystartupcfo.com' },
    ]);
    const h = await fetchMessageHeaders('msg-1', 'oauth-tok', 'access-tok');
    expect(h).toMatchObject({
      subject: 'Re: TR 2025 filing',
      from: 'Oliver Hahn <oliver@peak.insure>',
      to: 'v.mohan@mystartupcfo.com',
      cc: 'ap@peak.insure, cfo@peak.insure',
      bcc: 'audit@mystartupcfo.com',
    });
  });

  it('requests every header the card needs in a single call', async () => {
    const spy = vi.fn(async () => new Response(JSON.stringify({ payload: { headers: [] } }), { status: 200 }));
    global.fetch = spy as unknown as typeof fetch;
    await fetchMessageHeaders('msg-1', 'oauth-tok', 'access-tok');
    expect(spy).toHaveBeenCalledTimes(1);
    const url = String(spy.mock.calls[0][0]);
    for (const h of ['Message-Id', 'Subject', 'From', 'To', 'Cc', 'Bcc']) {
      expect(url).toContain(`metadataHeaders=${h}`);
    }
  });

  it('returns undefined when no token is available (no Gmail call possible)', async () => {
    const spy = vi.fn();
    global.fetch = spy as unknown as typeof fetch;
    expect(await fetchMessageHeaders('msg-1', undefined, undefined)).toBeUndefined();
    expect(spy).not.toHaveBeenCalled();
  });

  it('returns undefined on non-OK responses (graceful fallback)', async () => {
    global.fetch = vi.fn(async () => new Response('forbidden', { status: 403 })) as unknown as typeof fetch;
    expect(await fetchMessageHeaders('msg-1', 'oauth-tok', 'access-tok')).toBeUndefined();
  });

  it('omits fields whose headers are absent (e.g. Bcc on a received message)', async () => {
    respondWith([{ name: 'Subject', value: 'hi' }]);
    const h = await fetchMessageHeaders('msg-1', 'oauth-tok', 'access-tok');
    expect(h?.subject).toBe('hi');
    expect(h?.rfcMessageId).toBeUndefined();
    expect(h?.bcc).toBeUndefined();
  });
});
