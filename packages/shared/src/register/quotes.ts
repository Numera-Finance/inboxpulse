/**
 * Never show a reader a quotation the sender did not write.
 *
 * The model's stored `reasoning` is displayed verbatim under "Why this was
 * flagged", and it likes to quote: 83% of reasonings for real complaints contain
 * a quoted phrase. Only 53% of those phrases actually appear in the email.
 *
 * The other 30% are paraphrases wearing quotation marks — usually close in
 * meaning, occasionally not. On a surface whose job is to teach someone American
 * business register, that is the worst possible error: the reader studies a
 * phrase, learns to recognise it, and it was never there. A wrong verdict costs
 * one email; a fabricated quote teaches a false lesson that outlives it.
 *
 * So quotes are checked against the body and demoted when they fail. The claim
 * survives, the false evidence does not — `The client says "this is wrong"`
 * becomes `The client says this is wrong`, which is an assertion the reader can
 * weigh rather than a citation they cannot.
 */

/** Match a quoted span in either style, including the curly variants Gmail emits. */
const QUOTED = /["“']([^"”']{8,})["”']/g;

/**
 * Loosened for comparison only: markup, entities and whitespace differ between
 * the stored body and what the model was shown, and none of those differences
 * make a quote fabricated.
 */
function normalise(s: string): string {
  let t = s.replace(/<[^>]+>/g, ' ');
  for (const [a, b] of [['&nbsp;', ' '], ['&amp;', '&'], ['&lt;', '<'], ['&gt;', '>'],
                        ['&quot;', '"'], ['&#39;', "'"], ['&rsquo;', "'"]] as const) {
    t = t.split(a).join(b);
  }
  return t.replace(/[’‘]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').toLowerCase();
}

export interface CheckedReasoning {
  /** Safe to display: unverifiable quotations demoted to plain claims. */
  text: string;
  /** Quoted spans that do not appear in the email. */
  fabricated: string[];
}

/**
 * Strip quotation marks from any span that is not in the body.
 *
 * Compares a prefix rather than the whole span, because the model routinely
 * quotes accurately and then trails an ellipsis, joins two fragments, or clips
 * mid-sentence. Demanding an exact full match would demote quotes that are
 * genuinely present, and over-demoting costs the reader a real lesson.
 */
export function checkQuotes(reasoning: string, body: string): CheckedReasoning {
  if (!reasoning) return { text: '', fabricated: [] };
  const haystack = normalise(body ?? '');
  const fabricated: string[] = [];

  const text = reasoning.replace(QUOTED, (whole, inner: string) => {
    const probe = normalise(inner).replace(/\.{2,}$/, '').trim().slice(0, 40);
    if (probe.length >= 8 && haystack.includes(probe)) return whole;
    fabricated.push(inner);
    return inner;
  });

  return { text, fabricated };
}
