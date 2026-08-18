import model from './berne-whiskers.json';

/**
 * Berne Whiskers — the pre-filter, scored from a stored embedding.
 *
 * Decides whether a message is worth an LLM call. Sending the top-scoring 40%
 * retains 89% of the complaints in a temporal hold-out (8,877 newer emails,
 * 274 negatives, 3.1% prevalence). The tf-idf version it replaces needed 60% of
 * the mail for 94%, and 3.7 MB of vocabulary to do it.
 *
 * The vector is computed once when the email arrives and stored on the row, so
 * scoring here is a dot product over 768 numbers — no model, no network, no
 * vocabulary to decay. That last point is why this replaces the word-based
 * model rather than joining it: a tf-idf gate has to be retrained as clients
 * and projects change, and an embedding does not.
 *
 * It remains a SCREEN. At a threshold strict enough to be precise it finds
 * roughly one complaint in ten; the LLM behind it still makes the judgement.
 *
 * Named for Eric Berne, whose observation that "Sorry, why would it cost more?"
 * is a challenge rather than an apology is the whole reason this system exists:
 * the people reading this mail are fluent in English but not in American
 * business register, and the severity is carried by phrases that do not mean
 * what they appear to mean.
 */

interface BerneModel {
  version: string;
  embedding: { model: string; dim: number; normalize: string };
  trainedOn: {
    rows: number;
    negatives: number;
    upTo: string;
    /** Always every row — see the warning below before measuring anything. */
    coefficientsFitOn?: string;
    metricsMeasuredOn?: string;
  };
  metrics: { prAuc: number; heldOutRows: number; sendFraction: number; negativesRetained: number };
  intercept: number;
  threshold: number;
  coef: number[];
}

/**
 * DO NOT re-measure these coefficients against the corpus.
 *
 * They are refit on every row before shipping, which is right — the deployed
 * model should use all the evidence — and it makes them impossible to score
 * honestly afterwards. Doing it anyway reports ~91% on the training portion and
 * ~89% on the "held-out" portion, a flat line that reads like unusually good
 * generalisation and is memorisation. The true figure from a fit that never saw
 * the test mail is closer to 69% at the same send fraction.
 *
 * The numbers in `metrics` come from that separate, honest fit. They are the
 * ones to quote. To re-derive them, refit on the first 75% by date and score the
 * rest — never score this file's coefficients against anything they were
 * trained on.
 */

const M = model as BerneModel;

/**
 * Log-odds that the LLM would call this negative. Higher is more suspicious.
 *
 * Expects an L2-normalised vector from the SAME embedding model named in
 * `M.embedding.model`. A vector from a different model is still 768 numbers and
 * will still produce a score — a plausible, meaningless one — which is why the
 * model name is stored per row and checked by the caller rather than assumed.
 */
export function scoreEmbedding(vec: number[] | Float32Array): number {
  if (vec.length !== M.coef.length) {
    throw new Error(
      `berne-whiskers: expected ${M.coef.length} dimensions, got ${vec.length}. ` +
        `The model is ${M.embedding.model}; a different embedder cannot be scored with these coefficients.`
    );
  }
  // Normalise here rather than trust the writer. The threshold was fitted on
  // unit vectors, and an un-normalised one does not fail — it scores high on
  // every message, so the gate sends 67% of the mail instead of 42% and the
  // only symptom is the bill. There is no error to catch and no wrong answer to
  // notice, which makes it exactly the kind of drift worth spending 768
  // multiplications to rule out.
  let norm = 0;
  for (let i = 0; i < vec.length; i++) norm += vec[i] * vec[i];
  norm = Math.sqrt(norm) || 1;

  let dot = M.intercept;
  for (let i = 0; i < vec.length; i++) dot += (vec[i] / norm) * M.coef[i];
  return dot;
}

/**
 * Should this message go to the LLM?
 *
 * Fails OPEN in every uncertain case: no vector yet, a vector from the wrong
 * model, or a wrong-length one. A gate that silently drops mail it cannot score
 * turns an embedder outage into missing escalations, and a wasted call is much
 * the cheaper mistake.
 */
export function shouldAnalyzeByEmbedding(
  vec: number[] | Float32Array | null | undefined,
  embeddingModel: string | null | undefined
): boolean {
  if (!vec || vec.length !== M.coef.length) return true;
  if (embeddingModel && embeddingModel !== M.embedding.model) return true;
  return scoreEmbedding(vec) >= M.threshold;
}

export const berneMeta = {
  version: M.version,
  embeddingModel: M.embedding.model,
  dim: M.embedding.dim,
  threshold: M.threshold,
  prAuc: M.metrics.prAuc,
  sendFraction: M.metrics.sendFraction,
  negativesRetained: M.metrics.negativesRetained,
  trainedOn: M.trainedOn,
};
