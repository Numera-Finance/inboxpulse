import { describe, expect, it } from 'vitest';
import model from './berne-whiskers.json';
import { berneMeta, scoreEmbedding, shouldAnalyzeByEmbedding } from './berne-whiskers';

const DIM = model.coef.length;

/** A unit vector pointing along the coefficients: the most suspicious message possible. */
function suspicious(): number[] {
  const norm = Math.hypot(...model.coef);
  return model.coef.map((c) => c / norm);
}

function scaled(vec: number[], by: number): number[] {
  return vec.map((v) => v * by);
}

describe('scoreEmbedding', () => {
  it('rejects a vector from a different embedder rather than scoring it', () => {
    expect(() => scoreEmbedding(new Array(DIM - 1).fill(0))).toThrow(/dimensions/);
  });

  it('scores a vector the same however it is scaled', () => {
    // The failure this guards against is silent: an un-normalised vector scores
    // high on everything, so the gate sends far more mail than it was tuned for
    // and nothing errors. Only the bill moves.
    const v = suspicious();
    const base = scoreEmbedding(v);
    for (const factor of [0.01, 0.5, 3, 250]) {
      expect(scoreEmbedding(scaled(v, factor))).toBeCloseTo(base, 6);
    }
  });

  it('ranks a coefficient-aligned vector above its opposite', () => {
    const v = suspicious();
    expect(scoreEmbedding(v)).toBeGreaterThan(scoreEmbedding(scaled(v, -1)));
  });
});

describe('shouldAnalyzeByEmbedding', () => {
  it('sends the message when there is no vector yet', () => {
    expect(shouldAnalyzeByEmbedding(null, berneMeta.embeddingModel)).toBe(true);
    expect(shouldAnalyzeByEmbedding(undefined, berneMeta.embeddingModel)).toBe(true);
  });

  it('sends the message when the vector came from another model', () => {
    // Same 768 numbers, different meaning. Scoring it would produce a plausible
    // number and a wrong decision, so the model name is checked, not assumed.
    expect(shouldAnalyzeByEmbedding(suspicious(), 'text-embedding-3-small')).toBe(true);
  });

  it('sends the message when the vector is the wrong length', () => {
    expect(shouldAnalyzeByEmbedding(new Array(384).fill(0.1), berneMeta.embeddingModel)).toBe(true);
  });

  it('sends a message that scores above the threshold', () => {
    expect(shouldAnalyzeByEmbedding(suspicious(), berneMeta.embeddingModel)).toBe(true);
  });

  it('drops a message that scores below it', () => {
    expect(shouldAnalyzeByEmbedding(scaled(suspicious(), -1), berneMeta.embeddingModel)).toBe(false);
  });
});
