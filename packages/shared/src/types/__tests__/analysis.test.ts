import { describe, it, expect } from 'vitest';
import { ANALYSIS_TYPES, analysisTypeSchema, Signal, validateSignalSelection } from '../analysis';

describe('analysisTypeSchema', () => {
  it('accepts every value in ANALYSIS_TYPES', () => {
    for (const type of ANALYSIS_TYPES) {
      expect(analysisTypeSchema.safeParse(type).success).toBe(true);
    }
  });

  it('rejects removed pseudo-analysis types', () => {
    // domain-extraction and contact-extraction were removed when extraction
    // moved out of the LLM pipeline into the /analyze response payload.
    // Old callers sending them must get a clean validation error, not a
    // partial-success response.
    expect(analysisTypeSchema.safeParse('domain-extraction').success).toBe(false);
    expect(analysisTypeSchema.safeParse('contact-extraction').success).toBe(false);
  });

  it('rejects arbitrary strings', () => {
    expect(analysisTypeSchema.safeParse('unknown-type').success).toBe(false);
    expect(analysisTypeSchema.safeParse('').success).toBe(false);
    expect(analysisTypeSchema.safeParse('SENTIMENT').success).toBe(false); // case-sensitive
  });

  it('rejects non-strings', () => {
    expect(analysisTypeSchema.safeParse(null).success).toBe(false);
    expect(analysisTypeSchema.safeParse(undefined).success).toBe(false);
    expect(analysisTypeSchema.safeParse(42).success).toBe(false);
  });

  it('error message mentions the valid options on rejection', () => {
    const result = analysisTypeSchema.safeParse('domain-extraction');
    expect(result.success).toBe(false);
    if (!result.success) {
      // Zod includes the enum options in the issue. Sanity check that at
      // least one valid value appears in the formatted error.
      const formatted = JSON.stringify(result.error.issues);
      expect(formatted).toMatch(/sentiment|escalation|signature-extraction/);
    }
  });
});

describe('validateSignalSelection', () => {
  it('accepts an empty selection', () => {
    expect(validateSignalSelection([])).toBeNull();
  });

  it('accepts the customer-complaint case: negative sentiment without churn', () => {
    expect(validateSignalSelection([Signal.SENTIMENT_NEGATIVE])).toBeNull();
  });

  it('accepts one signal from each single-select group plus boolean tags', () => {
    expect(
      validateSignalSelection([
        Signal.SENTIMENT_NEGATIVE,
        Signal.CHURN_LOW,
        Signal.CLASSIFICATION_BUSINESS,
        Signal.UPSELL,
        Signal.ESCALATION,
      ])
    ).toBeNull();
  });

  it('rejects unknown signal values', () => {
    expect(validateSignalSelection([9999])).toMatch(/unknown/i);
  });

  it('rejects duplicate signals', () => {
    expect(
      validateSignalSelection([Signal.SENTIMENT_NEGATIVE, Signal.SENTIMENT_NEGATIVE])
    ).toMatch(/duplicate/i);
  });

  it('rejects more than one sentiment', () => {
    expect(
      validateSignalSelection([Signal.SENTIMENT_POSITIVE, Signal.SENTIMENT_NEGATIVE])
    ).toMatch(/sentiment/i);
  });

  it('rejects more than one churn level', () => {
    expect(validateSignalSelection([Signal.CHURN_LOW, Signal.CHURN_HIGH])).toMatch(/churn/i);
  });

  it('rejects more than one classification', () => {
    expect(
      validateSignalSelection([Signal.CLASSIFICATION_SPAM, Signal.CLASSIFICATION_BUSINESS])
    ).toMatch(/classification/i);
  });
});
