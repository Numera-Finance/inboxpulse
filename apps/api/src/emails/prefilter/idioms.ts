/**
 * A bag of idioms, not a bag of words.
 *
 * The people reading this mail are bookkeepers and accountants in India working
 * for American startups. They are fluent, but the register is not theirs — and
 * it is not general American English either. It is Silicon Valley operating
 * language, where ordinary words carry fixed severity: a "blocker" is not an
 * obstacle, it is a P0; "let's take this offline" is displeasure, not logistics;
 * "circle back" can be a promise or a brush-off depending on who says it. An
 * American client rarely writes "you failed us" — of 20 complaints a native
 * reader identified in a labelled sample, only 5 used explicit failure wording.
 * The other 15 carried their force in fixed expressions that do not mean what
 * they appear to mean:
 *
 *   "Sorry, why would it cost more?"        Sorry is not an apology here.
 *   "BTW, these are in the wrong class"     BTW is not an aside.
 *   "I got a bit lost in the spreadsheet"   The spreadsheet is the problem.
 *   "Not good to have so many iterations"   Litotes. Stronger than it looks.
 *   "Although I had pointed out..."         This is the second or third time.
 *   "This is now holding up our KYC"        The stakes just rose.
 *
 * Every one is a trap for a non-native reader: the surface is mild, the force is
 * not. A bag of unigrams cannot see any of it — the meaning lives in the whole
 * phrase, and the individual words are the most common in English. Learned
 * bag-of-words models scored PR-AUC 0.221 on complaint content and 0.049 on
 * stance; these hand-written phrases hit 100% precision on the same emails.
 *
 * Two uses, and the second may matter more:
 *   1. A feature for the classifier — deterministic, offline, microseconds.
 *   2. A TEACHING list. Each entry explains what the phrase actually means, so
 *      the panel can say "'Sorry, why…' is a challenge, not an apology."
 *
 * Written against a labelled sample and therefore fitted to it. `npm run
 * idiom-eval` scores it against held-out mail; treat the numbers there, not the
 * ones in this comment, as the truth.
 */

export interface Idiom {
  /** Stable id, used when reporting which idiom fired. */
  id: string;
  pattern: RegExp;
  /** What a non-native reader is likely to take it for. */
  readsAs: string;
  /** What it actually signals. Shown to the user; keep it one plain sentence. */
  means: string;
  /** 0-1. How reliably this indicates real dissatisfaction, before evidence. */
  weight: number;
}

export const IDIOMS: Idiom[] = [
  {
    id: 'litotes',
    pattern: /\b(not (good|great|ideal|acceptable|working|helpful|right)|less than (ideal|helpful)|not the (first|only) time|hardly (ideal|acceptable))\b/i,
    readsAs: 'a mild observation',
    means: 'Understatement used as criticism. Read it as the strong form: "this is bad".',
    weight: 0.9,
  },
  {
    id: 'understatement',
    pattern: /\b(a (bit|little) (lost|confused|off|concerned|concerning|surprised)|(somewhat|slightly) (off|unclear|concerning)|a (bit|little) of an? (issue|problem))\b/i,
    readsAs: 'the writer is unsure of themselves',
    means: 'Politely saying our work is wrong or unclear. The doubt is about us, not them.',
    weight: 0.8,
  },
  {
    id: 'soft_opener',
    // The softener is the tell. "Sorry" opening a question is adversarial.
    pattern: /(^|[.!?]\s+)(sorry[,!.]?\s+(but|why|i\b|can|could)|btw[.,\s]|just (to|so) (be clear|confirm)|with (all due )?respect|no offen[cs]e)/i,
    readsAs: 'an apology, or a casual aside',
    means: 'A softener placed in front of a complaint. What follows it is the real message.',
    weight: 0.7,
  },
  {
    id: 'repetition',
    pattern: /\b(although i (had )?(pointed|mentioned|said|noted)|as (i|we) (had )?(already )?(mentioned|pointed out|noted|said|explained)|i (thought|had thought) (we|you|this|it)|(once )?again[,.]|as per my (last|previous)|(second|third|fourth) (time|follow.?up|reminder)|\d(st|nd|rd|th) (follow.?up|reminder))\b/i,
    readsAs: 'a reminder',
    means: 'They have told us this before. Repetition is the complaint.',
    weight: 0.95,
  },
  {
    id: 'consequence',
    pattern: /\b(holding (this |us |it )?up|held up|blocking|can'?t (close|file|proceed|move)|at risk|miss(ing|ed)? the deadline|penalt(y|ies)|late fee|audit(ors)? (are|is) waiting)\b/i,
    readsAs: 'context about their situation',
    means: 'Our delay is now costing them something. Stakes have risen even if the tone has not.',
    weight: 0.9,
  },
  {
    id: 'colloquial_failure',
    pattern: /\b(messed (this |it |everything )?up|screwed up|dropped the ball|fell through|went sideways|off the rails|a mess)\b/i,
    readsAs: 'informal, friendly language',
    means: 'Casual wording for a real failure. Informality does not mean it is minor.',
    weight: 0.9,
  },
  {
    id: 'challenge',
    pattern: /\b(i (don'?t|do not) know what you mean|why (would|do|did) you (need|think|say|do)|where (or how )?do you (find|get)|what makes you|help me understand|walk me through|explain (to me )?(why|how))\b/i,
    readsAs: 'a genuine question',
    means: 'A challenge to our judgement dressed as a question. They want justification, not information.',
    weight: 0.85,
  },
  {
    id: 'escalate_to_call',
    pattern: /\b(hop on a call|get on a call|jump on a call|urgent call|call me (today|now|asap)|let'?s (discuss|talk) (this )?(live|today|now)|can we (get on|have) a (quick )?call (today|now))\b/i,
    readsAs: 'a scheduling request',
    means: 'Email has stopped working for them. Asking for a call is an escalation.',
    weight: 0.75,
  },
  {
    id: 'witness',
    pattern: /\b(looping in|cc'?ing (in )?|adding \w+ (here|to this thread)|bringing in (our|the) (auditor|counsel|board)|per (our|the) (board|auditor|counsel|attorney))\b/i,
    readsAs: 'keeping people informed',
    means: 'Bringing in an audience. The conversation is being put on the record.',
    weight: 0.7,
  },
  {
    id: 'small_error',
    // "just a typo" is how a native speaker reports our carelessness politely
    pattern: /\b(had a typo|there'?s a typo|small (typo|error|mistake)|minor (error|issue)|wrong (address|spelling|name|link)|misspel)\b/i,
    readsAs: 'a trivial correction',
    means: 'A small error in our work, reported gently. Politeness here often masks irritation at carelessness.',
    weight: 0.6,
  },
  {
    id: 'non_delivery',
    pattern: /\b(has not (been )?(debited|received|arrived|come through|hit)|have not (yet )?(received|seen|got)|don'?t see (the|any|it)|nothing (has )?(come|arrived)|no sign of)\b/i,
    readsAs: 'a status question',
    means: 'Something we said would happen has not happened. This is a failure report, not a query.',
    weight: 0.85,
  },
  // ---- Silicon Valley operating register -------------------------------
  // Startup-standard vocabulary where the severity is conventional rather than
  // literal. These are the hardest for a non-native reader precisely because
  // every individual word is familiar.
  {
    id: 'sv_blocker',
    pattern: /\b(is a (hard )?blocker|blocked on|unblock|p0\b|p1\b|fire ?drill|show ?stopper|critical path)\b/i,
    readsAs: 'a status word',
    means: 'In startup usage a blocker is top priority, not an obstacle. This is the highest-urgency word in the register.',
    weight: 0.9,
  },
  {
    id: 'sv_offline',
    pattern: /\b(take (this|it) offline|discuss (this )?offline|handle (this )?offline|not (over|on) email)\b/i,
    readsAs: 'a scheduling preference',
    means: 'They do not want this in writing. Usually displeasure, sometimes a decision being made without us.',
    weight: 0.8,
  },
  {
    id: 'sv_flag',
    pattern: /\b(raising a flag|flagging (this|that)|want to flag|heads.?up (that|on)|putting (this )?on your radar|surfacing (this|an issue))\b/i,
    readsAs: 'sharing information',
    means: 'A deliberate, formal escalation. "Flagging" means they want it on the record.',
    weight: 0.8,
  },
  {
    id: 'sv_sanity',
    pattern: /\b(sanity check|gut check|double.?click(ing)? on|dig(ging)? into (this|the numbers)|pressure.?test)\b/i,
    readsAs: 'a routine review',
    means: 'They doubt the work and are checking it themselves. Doubt, phrased as process.',
    weight: 0.7,
  },
  {
    id: 'sv_circle_back',
    pattern: /\b(circl(e|ing) back|close the loop|following up on my|touch(ing)? base|bump(ing)? this|any movement on)\b/i,
    readsAs: 'a friendly check-in',
    means: 'A chase. The friendliness is convention; the message is that we did not respond.',
    weight: 0.7,
  },
  {
    id: 'sv_bandwidth',
    pattern: /\b(do you have (the )?bandwidth|bandwidth (for|to)|capacity (for|to)|is (this|that) on your plate|who owns (this|that))\b/i,
    readsAs: 'a scheduling question',
    means: 'Doubt about whether we can or will deliver. "Who owns this" means nobody has.',
    weight: 0.7,
  },
  {
    id: 'resigned',
    pattern: /\b(over and over|every (time|month|quarter)|keeps? happening|same (issue|thing|problem) again|back and forth|going in circles|kryptonite)\b/i,
    readsAs: 'venting',
    means: 'A pattern, not an incident. They have stopped expecting it to be fixed.',
    weight: 0.9,
  },
];

export interface IdiomHit {
  id: string;
  readsAs: string;
  means: string;
  weight: number;
  /** The matched text, so the panel can quote what triggered it. */
  quote: string;
}

/**
 * Which idioms fire on this text.
 *
 * Deliberately returns every match rather than a single verdict: the panel shows
 * a reader WHY a message was flagged, and "Although I had pointed out…" teaches
 * more than a score does.
 */
export function findIdioms(text: string): IdiomHit[] {
  const hits: IdiomHit[] = [];
  for (const idiom of IDIOMS) {
    const m = idiom.pattern.exec(text);
    if (m) {
      hits.push({
        id: idiom.id,
        readsAs: idiom.readsAs,
        means: idiom.means,
        weight: idiom.weight,
        quote: m[0].trim().slice(0, 80),
      });
    }
  }
  return hits;
}

/** Highest weight among the idioms present. 0 when none fire. */
export function idiomScore(text: string): number {
  return findIdioms(text).reduce((max, h) => Math.max(max, h.weight), 0);
}
