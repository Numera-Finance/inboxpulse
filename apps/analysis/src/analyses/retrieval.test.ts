import { describe, expect, it, vi, beforeEach } from 'vitest';

const execute = vi.fn();
vi.mock('../db', () => ({ getDb: () => ({ execute }) }));
vi.mock('../utils/logger', () => ({ logger: { warn: vi.fn(), info: vi.fn() } }));

const { retrieveExamples, formatExamples, toPlainText } = await import('./retrieval');

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

describe('retrieveExamples', () => {
  it('scopes the query to the tenant and excludes the email being judged', async () => {
    execute.mockResolvedValue([]);
    await retrieveExamples({
      tenantId: 'tenant-a',
      embedding: [0.1, 0.2],
      excludeEmailId: 'email-1',
    });

    // These rows are pasted verbatim into a prompt. A missing tenant scope would
    // put one customer's mail inside another customer's analysis, so the filter
    // has to be in the query rather than applied to the results.
    const query = execute.mock.calls[0][0];
    const params = JSON.stringify(query.queryChunks ?? query);
    expect(params).toContain('tenant_id');
    expect(params).toContain('id <>');
    // One analyses row per type; without this filter the join returns churn and
    // escalation rows too and every verdict comes back null.
    expect(params).toContain('analysis_type');
  });

  it('returns nothing rather than throwing when the query fails', async () => {
    // An unpopulated embedding column is the normal state before backfill, not
    // an error. The caller falls back to the written instructions.
    execute.mockRejectedValue(new Error('column "embedding" does not exist'));
    await expect(
      retrieveExamples({ tenantId: 't', embedding: [0.1], excludeEmailId: 'e' })
    ).resolves.toEqual([]);
  });

  it('does not query at all without an embedding', async () => {
    expect(
      await retrieveExamples({ tenantId: 't', embedding: [], excludeEmailId: 'e' })
    ).toEqual([]);
    expect(execute).not.toHaveBeenCalled();
  });

  it('drops rows with no subject or body', async () => {
    execute.mockResolvedValue([
      { subject: 'Re: close', body: 'a'.repeat(300), sentiment_value: 'negative', distance: 0.1 },
      { subject: null, body: 'orphan', sentiment_value: 'neutral', distance: 0.2 },
    ]);
    const out = await retrieveExamples({ tenantId: 't', embedding: [0.1], excludeEmailId: 'e' });
    expect(out).toHaveLength(1);
    expect(out[0].verdict).toBe('negative');
  });
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
