import { describe, it, expect } from 'vitest';
import { score, prepare, shouldAnalyze, prefilterMeta } from './score';
import vectors from './parity-vectors.json';

/**
 * The model was fitted in scikit-learn and is scored here in TypeScript. Those
 * are two implementations of the same arithmetic, and only one of them was
 * tested against the training data — so the threshold is only meaningful while
 * they agree.
 *
 * parity-vectors.json holds real emails with the score Python produced for
 * each. If tokenisation, sublinear tf, idf or L2 normalisation drift apart,
 * these fail rather than the gate silently starting to drop the wrong mail.
 */
describe('prefilter parity with the Python model', () => {
  it('reproduces scikit-learn scores', () => {
    for (const v of vectors as Array<{ text: string; score: number }>) {
      expect(score(v.text)).toBeCloseTo(v.score, 4);
    }
  });

  it('has a model with the expected shape', () => {
    expect(prefilterMeta.terms).toBeGreaterThan(100_000);
    expect(Number.isFinite(prefilterMeta.threshold)).toBe(true);
  });
});

describe('the gate fails open', () => {
  it('sends empty and unparseable messages to the LLM', () => {
    // A screen that drops what it cannot read turns a parser bug into missing
    // escalations. Spending a call is the cheaper mistake.
    expect(shouldAnalyze(null, null)).toBe(true);
    expect(shouldAnalyze('', '')).toBe(true);
    expect(shouldAnalyze('Hi', 'ok')).toBe(true);
    expect(shouldAnalyze(null, '<div><br></div>')).toBe(true);
  });

  it('strips markup and the quoted chain before scoring', () => {
    const withQuote = prepare('Re: invoice', '<div>This is wrong.</div>On Mon, X wrote:\nold text here');
    expect(withQuote).not.toContain('<div>');
    expect(withQuote).not.toContain('old text here');
    expect(withQuote).toContain('This is wrong.');
  });
});

describe('it separates complaints from routine mail', () => {
  it('scores an asserted failure above a routine acknowledgement', () => {
    const complaint = score(
      prepare(
        'Re: 1099 filings',
        "This is the third time I have asked. The numbers are still wrong and no one has responded. This is not acceptable."
      )
    );
    const routine = score(
      prepare('Re: schedules', 'Thanks for sending this over. Sounds good, I will review and get back to you.')
    );
    expect(complaint).toBeGreaterThan(routine);
  });
});
