import { describe, expect, it, vi, beforeEach } from 'vitest';

const execute = vi.fn();
vi.mock('../db', () => ({ getDb: () => ({ execute }) }));
vi.mock('../utils/logger', () => ({ logger: { warn: vi.fn(), info: vi.fn() } }));

const { formatExamples, toPlainText } = await import('./retrieval');

function example(over: Partial<Parameters<typeof formatExamples>[0][number]> = {}) {
  return {
    subject: 'Re: March close',
    body: 'Could you provide an update on the expected timeline for the March financials?',
    verdict: 'negative' as const,
    distance: 0.2,
    ...over,
  };
}

beforeEach(() => {
  execute.mockReset();
});

describe('formatExamples', () => {
  it('returns empty when there are too few to teach anything', () => {
    // Three examples is not a pattern, it is three anecdotes; better to fall
    // back to the written instructions than to imply a pattern from noise.
    expect(formatExamples([example(), example(), example()])).toBe('');
  });

  it('renders each example as the email followed by its verdict', () => {
    const out = formatExamples(Array.from({ length: 5 }, () => example()));
    expect(out).toContain('VERDICT: negative');
    expect(out.match(/EMAIL:/g)).toHaveLength(5);
  });

  it('never leaks the distance to the model', () => {
    const out = formatExamples(Array.from({ length: 5 }, () => example({ distance: 0.4242 })));
    expect(out).not.toContain('0.4242');
    expect(out).not.toMatch(/distance/i);
  });

  it('excludes examples too short to carry a lesson', () => {
    const short = Array.from({ length: 5 }, () => example({ subject: 'ok', body: 'thanks' }));
    expect(formatExamples(short)).toBe('');
  });
});

describe('toPlainText', () => {
  it('strips markup, entities and the quoted chain', () => {
    const t = toPlainText(
      'Re: close',
      '<div>Any update on this?</div>&nbsp;On Mon, 1 Jan 2026 someone wrote: older stuff'
    );
    expect(t).toContain('Any update on this?');
    expect(t).not.toContain('<div>');
    expect(t).not.toContain('older stuff');
  });

  it('strips Outlook style blocks rather than passing CSS off as text', () => {
    // Mail composed in Outlook opens with font declarations wrapped in a comment.
    // Left in, they fill the example with @font-face noise and teach nothing.
    const t = toPlainText('Re: filing', '<style><!-- @font-face {font-family:Calibri;} --></style>Where are we on this?');
    expect(t).not.toContain('font-face');
    expect(t).toContain('Where are we on this?');
  });

  it('caps length so ten examples cannot crowd out the email being judged', () => {
    expect(toPlainText('s', 'x'.repeat(5000)).length).toBeLessThanOrEqual(380);
  });
});
