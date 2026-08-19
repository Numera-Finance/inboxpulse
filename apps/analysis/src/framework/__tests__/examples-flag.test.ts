import 'reflect-metadata';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

/**
 * The feature must be invisible until switched on, and harmless when it breaks.
 *
 * Retrieval exists to improve an analysis. An analysis that would have succeeded
 * must never fail because the thing meant to improve it did — so every failure
 * path here has to end at the written instructions, which is what production
 * already runs today.
 */

const retrieveExamplesForEmail = vi.fn();
vi.mock('../../analyses/retrieval', async (orig) => ({
  ...(await orig<typeof import('../../analyses/retrieval')>()),
  retrieveExamplesForEmail,
}));
vi.mock('../../utils/logger', () => ({
  logger: { warn: vi.fn(), debug: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

const { AnalysisExecutor } = await import('../executor');

const email = { messageId: 'msg-1', subject: 'Re: close', body: 'any update?' } as never;
const sentimentDef = { module: { name: 'sentiment' }, type: 'sentiment' } as never;

function executor() {
  return new AnalysisExecutor({} as never, {} as never);
}

/** buildExamples is private; the behaviour it guards is what matters. */
function buildExamples(defs: unknown[], mail: unknown, tenant: string) {
  return (executor() as unknown as {
    buildExamples: (d: unknown[], e: unknown, t: string) => Promise<string | undefined>;
  }).buildExamples(defs, mail, tenant);
}

const ORIGINAL = { ...process.env };

beforeEach(() => {
  retrieveExamplesForEmail.mockReset();
  process.env.DATABASE_URL = 'postgres://x';
  process.env.SERVICE_API_URL = 'http://x';
});
afterEach(() => {
  process.env = { ...ORIGINAL };
});

describe('sentiment examples flag', () => {
  it('does nothing at all when the flag is unset', async () => {
    delete process.env.SENTIMENT_EXAMPLES_ENABLED;
    expect(await buildExamples([sentimentDef], email, 't')).toBeUndefined();
    expect(retrieveExamplesForEmail).not.toHaveBeenCalled();
  });

  it('does nothing when the flag is any value other than true', async () => {
    // Guards against a deploy that sets the variable to '1' or 'yes' and quietly
    // turns a feature on that nobody meant to enable.
    for (const v of ['1', 'yes', 'TRUE', 'false', '']) {
      process.env.SENTIMENT_EXAMPLES_ENABLED = v;
      expect(await buildExamples([sentimentDef], email, 't')).toBeUndefined();
    }
    expect(retrieveExamplesForEmail).not.toHaveBeenCalled();
  });

  it('does not retrieve for analyses other than sentiment', async () => {
    process.env.SENTIMENT_EXAMPLES_ENABLED = 'true';
    const churn = { module: { name: 'churn' }, type: 'churn' } as never;
    expect(await buildExamples([churn], email, 't')).toBeUndefined();
    expect(retrieveExamplesForEmail).not.toHaveBeenCalled();
  });

  it('falls back to instructions when retrieval throws', async () => {
    process.env.SENTIMENT_EXAMPLES_ENABLED = 'true';
    retrieveExamplesForEmail.mockRejectedValue(new Error('pgvector missing'));
    await expect(buildExamples([sentimentDef], email, 't')).resolves.toBeUndefined();
  });

  it('does not read the flag through getEnv', async () => {
    // getEnv() validates the whole environment and calls process.exit(1) on a
    // miss — it does not throw, so no try/catch could contain it. If the flag
    // were read that way, an unrelated missing variable would kill the service
    // on a cold path. Here a broken environment is simply irrelevant.
    process.env.SENTIMENT_EXAMPLES_ENABLED = 'true';
    delete process.env.DATABASE_URL;
    delete process.env.SERVICE_API_URL;
    retrieveExamplesForEmail.mockResolvedValue([]);
    await expect(buildExamples([sentimentDef], email, 't')).resolves.toBeUndefined();
    expect(retrieveExamplesForEmail).toHaveBeenCalled();
  });

  it('falls back when too few examples come back to be worth showing', async () => {
    process.env.SENTIMENT_EXAMPLES_ENABLED = 'true';
    retrieveExamplesForEmail.mockResolvedValue([
      { subject: 'a', body: 'x'.repeat(300), verdict: 'negative', distance: 0.1 },
    ]);
    expect(await buildExamples([sentimentDef], email, 't')).toBeUndefined();
  });

  it('returns rendered examples once there are enough', async () => {
    process.env.SENTIMENT_EXAMPLES_ENABLED = 'true';
    retrieveExamplesForEmail.mockResolvedValue(
      Array.from({ length: 6 }, () => ({
        subject: 'Re: March close',
        body: 'Could you share an update on the expected timeline for the financials?',
        verdict: 'negative' as const,
        distance: 0.2,
      }))
    );
    const out = await buildExamples([sentimentDef], email, 't');
    expect(out).toContain('VERDICT: negative');
    expect(out).toContain('already been judged');
  });
});

describe('buildBatchedPrompt', () => {
  it('is byte-identical to today when no examples are supplied', async () => {
    const defs = [{ name: 'Sentiment', module: { name: 'sentiment', instructions: 'RULES' } }] as never;
    const ex = executor();
    const withoutArg = ex.buildBatchedPrompt(defs, email, undefined);
    const withUndefined = ex.buildBatchedPrompt(defs, email, undefined, undefined);
    expect(withUndefined).toEqual(withoutArg);
    expect(String(withoutArg)).not.toContain('already been judged');
  });

  it('places examples between the instructions and the email', async () => {
    const defs = [{ name: 'Sentiment', module: { name: 'sentiment', instructions: 'RULES' } }] as never;
    // buildBatchedPrompt gained a `participants` roster ahead of `examples` when
    // the participant-roster branch merged; this call names the slot it means.
    const out = String(executor().buildBatchedPrompt(defs, email, undefined, undefined, 'EXAMPLES-HERE'));
    expect(out.indexOf('RULES')).toBeLessThan(out.indexOf('EXAMPLES-HERE'));
    expect(out.indexOf('EXAMPLES-HERE')).toBeLessThan(out.indexOf('Re: close'));
  });
});
