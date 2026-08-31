import { GoogleAuth } from 'google-auth-library';
import { safeErrorDetail } from '../utils/api-error';
import { getEnv, type Env } from '../env';
import { logger } from '../utils/logger';
import { filterCommitments } from './commitments';

/**
 * Live, in-request analysis of the OPEN message — nothing is stored.
 *
 * Why this exists: InboxPulse only ingests mail with an external customer
 * participant, so internal and leadership inboxes are excluded by design. Those
 * users open the add-on and correctly see "not a tracked client thread", which
 * reads as a broken panel. This path analyses the message the user is looking at
 * right now, renders it, and throws it away. Nothing is written to the database
 * and nothing enters the shared tenant.
 *
 * It is opt-in (LIVE_ANALYSIS_URL blank = disabled) and only ever runs for
 * threads InboxPulse does NOT track — a tracked thread always uses its stored
 * analysis, which is authoritative and free.
 */

export type LiveSentiment = 'positive' | 'neutral' | 'negative';

export interface LiveAnalysis {
  sentiment: LiveSentiment;
  reason: string;
  /** Always true — used by the card to label this as ephemeral, not stored. */
  ephemeral: true;
}

const SENTIMENTS = new Set<LiveSentiment>(['positive', 'neutral', 'negative']);

/** Keep the prompt small: latency is in the render path, and bodies can be huge. */
const MAX_BODY_CHARS = 4000;

export function isLiveAnalysisEnabled(): boolean {
  const env = getEnv();
  // Gemini carries its own base URL with a default, so LIVE_ANALYSIS_URL is
  // blank on that path -- the credential is what decides whether it can run.
  //
  // This checked LIVE_ANALYSIS_URL for every provider, which meant switching to
  // gemini silently DISABLED live analysis: every thread rendered "Not a tracked
  // client thread", including threads with an external customer on them. No
  // error, no log, just a panel that quietly stopped working. Exactly the shape
  // of failure this codebase keeps producing -- a config change that reads as
  // empty data.
  //
  // ADC IS A CREDENTIAL TOO, and this is the same bug one layer along: under
  // LIVE_ANALYSIS_AUTH=adc there is no key by design and never will be, so a
  // key-only test reports the panel disabled while the credential it actually
  // uses is sitting right there and working. The token is not minted here --
  // this is called on the render path and must stay synchronous; a bad ADC
  // environment surfaces as a logged 401 from the call itself, not as a panel
  // that silently claims to be switched off.
  if (env.LIVE_ANALYSIS_PROVIDER === 'gemini')
    return env.LIVE_ANALYSIS_AUTH === 'adc' || env.LIVE_ANALYSIS_KEY.trim().length > 0;
  return env.LIVE_ANALYSIS_URL.trim().length > 0;
}

/**
 * Reasoning models (e.g. nemotron-3.5-lightning) emit their chain into
 * `message.reasoning` and only fill `message.content` once thinking finishes.
 * Measured: ~510 completion tokens for a one-line classification, of which ~500
 * are reasoning. A small max_tokens therefore returns finish_reason "length"
 * with an EMPTY content string rather than an error — which is why the budget
 * below is generous and why empty content is treated as a failure, not as data.
 */
const MAX_TOKENS = 1200;

export async function analyseMessageLive(input: {
  subject?: string;
  from?: string;
  body: string;
}): Promise<LiveAnalysis | null> {
  const env = getEnv();
  const base = baseFor(env);
  if (!base) return null;

  const body = input.body.slice(0, MAX_BODY_CHARS);
  if (!body.trim()) return null;

  const prompt = [
    'Classify the sentiment of this email from the recipient\'s point of view.',
    'Mark it negative only when the sender asserts that we failed them —',
    'urgency alone is not negative.',
    '',
    `Subject: ${input.subject ?? '(none)'}`,
    `From: ${input.from ?? '(unknown)'}`,
    '',
    body,
    '',
    'Return ONLY this JSON, no prose:',
    '{"mode":"complaint|scheduling|opportunity|working|fyi","sentiment":"positive|neutral|negative","reason":"one short sentence"}',
  ].join('\n');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), env.LIVE_ANALYSIS_TIMEOUT_MS);
  const ollama = env.LIVE_ANALYSIS_PROVIDER === 'ollama';

  try {
    const headers = await authHeaders(env);

    const url = endpointFor(base, env.LIVE_ANALYSIS_PROVIDER);
    const payload = ollama
      ? {
          model: env.LIVE_ANALYSIS_MODEL,
          messages: [{ role: 'user', content: prompt }],
          // The whole reason this branch exists — see env.ts.
          think: env.LIVE_ANALYSIS_THINK,
          stream: false,
          options: { temperature: 0 },
        }
      : {
          model: env.LIVE_ANALYSIS_MODEL,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0,
          max_tokens: MAX_TOKENS,
        };

    const res = await fetch(url, {
      method: 'POST',
      headers,
      signal: controller.signal,
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      // Log the endpoint's own error text. A bare status cannot distinguish an
      // unknown model from a rejected parameter from a wrong path, and all three
      // return 400.
      const detail = safeErrorDetail(await res.text().catch(() => ''));
      logger.warn(
        { status: res.status, provider: env.LIVE_ANALYSIS_PROVIDER, url, model: env.LIVE_ANALYSIS_MODEL, detail },
        'live analysis: non-OK response',
      );
      return null;
    }

    const json = (await res.json()) as {
      // OpenAI shape
      choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
      // Ollama native shape
      message?: { content?: string };
      done_reason?: string;
    };

    const content = ollama ? (json.message?.content ?? '') : (json.choices?.[0]?.message?.content ?? '');
    const finish = ollama ? json.done_reason : json.choices?.[0]?.finish_reason;

    if (!content.trim()) {
      // Ran out of budget mid-reasoning. Reported rather than silently dropped:
      // an empty body with HTTP 200 is a success-shaped failure, and the usual
      // cause is a reasoning model with thinking left on.
      logger.warn({ finish, provider: env.LIVE_ANALYSIS_PROVIDER }, 'live analysis: empty content');
      return null;
    }

    return parseAnalysis(content);
  } catch (err) {
    const aborted = err instanceof Error && err.name === 'AbortError';
    logger.warn({ aborted, err: String(err) }, 'live analysis: failed');
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Models wrap JSON in prose or fences often enough that this must be tolerant. */
export function parseAnalysis(raw: string): LiveAnalysis | null {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return null;

  try {
    const obj = JSON.parse(match[0]) as { sentiment?: string; reason?: string };
    const sentiment = String(obj.sentiment ?? '').toLowerCase() as LiveSentiment;
    if (!SENTIMENTS.has(sentiment)) return null;

    const reason = String(obj.reason ?? '').trim();
    return { sentiment, reason: reason || 'No reason given.', ephemeral: true };
  } catch {
    return null;
  }
}

/**
 * Analyse several messages concurrently to produce a real sentiment series.
 *
 * The sparkline needs more than one point, and a single-message reading cannot
 * supply one. Padding a lone value into five bars would invent data — the exact
 * failure the design forbids — so the series is only as long as the messages we
 * actually analysed, and is empty when we could not read the thread.
 *
 * Capped, because every entry is an LLM call sitting in the card's render path.
 * Concurrency keeps wall-clock at roughly one call, not N.
 */
export async function analyseThreadLive(
  messages: Array<{ from?: string; body: string }>,
  limit = 3,
): Promise<LiveAnalysis[]> {
  if (!isLiveAnalysisEnabled() || !messages.length) return [];

  // Concurrency does NOT buy parallelism here. A local Ollama serves one model
  // at a time, so N concurrent requests queue behind each other and the wall
  // clock is the sum, not the max. Measured: 3 messages took 3.7s. Shipping a
  // cap of 5 pushed the whole contextual response past 9s, Gmail gave up on it,
  // and the panel fell back to the homepage card.
  //
  // So the cap is small AND the total is bounded: whatever has resolved when the
  // deadline passes is what gets rendered. A shorter sparkline is a fine
  // outcome; a card that never arrives is not.
  const recent = messages.slice(-limit);
  const deadline = new Promise<'deadline'>((r) =>
    setTimeout(() => r('deadline'), getEnv().LIVE_ANALYSIS_TIMEOUT_MS),
  );

  const settled: Array<LiveAnalysis | null> = new Array(recent.length).fill(null);
  const calls = recent.map((m, i) =>
    analyseMessageLive({ from: m.from, body: m.body }).then((r) => {
      settled[i] = r;
    }),
  );

  const raced = await Promise.race([Promise.all(calls).then(() => 'done' as const), deadline]);
  if (raced === 'deadline') {
    logger.warn({ requested: recent.length, got: settled.filter(Boolean).length }, 'live thread analysis: deadline');
  }
  return settled.filter((r): r is LiveAnalysis => r !== null);
}

/**
 * Draft a short reply to the open thread.
 *
 * Returns plain text, deliberately: it is carried in a Gmail compose URL, which
 * is the only way to pre-populate a draft WITHOUT the compose OAuth scope. The
 * scope route (setComposeAction) is documented for Apps Script but Google does
 * not publish the equivalent response shape for HTTP add-ons, and guessing it
 * costs a full consent cycle to test. The URL works today and costs nothing.
 *
 * The trade-off is real and worth stating: a compose URL opens a NEW message,
 * not a threaded reply. Gmail threads on References headers, which a URL cannot
 * set, so the draft will not join the original conversation.
 */
export async function draftReplyLive(input: {
  subject?: string;
  from?: string;
  thread: string;
  senderFirstName?: string;
}): Promise<string | null> {
  const env = getEnv();
  const base = baseFor(env);
  if (!base) return null;

  const prompt = [
    'Write a short reply to the email thread below, as the recipient.',
    'Rules: 3 sentences maximum. Acknowledge the substance specifically.',
    'Commit only to what the thread already supports, never invent a date,',
    'a price, or a promise that is not already there. No greeting line, no',
    'sign-off, no subject line. Plain text only.',
    '',
    `Subject: ${input.subject ?? '(none)'}`,
    '',
    input.thread.slice(0, MAX_BODY_CHARS),
  ].join('\n');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), env.LIVE_ANALYSIS_TIMEOUT_MS);
  const ollama = env.LIVE_ANALYSIS_PROVIDER === 'ollama';

  try {
    const headers = await authHeaders(env);

    const res = await fetch(endpointFor(base, env.LIVE_ANALYSIS_PROVIDER), {
      method: 'POST',
      headers,
      signal: controller.signal,
      body: JSON.stringify(
        ollama
          ? {
              model: env.LIVE_ANALYSIS_MODEL,
              messages: [{ role: 'user', content: prompt }],
              think: env.LIVE_ANALYSIS_THINK,
              stream: false,
              options: { temperature: 0.2 },
            }
          : {
              model: env.LIVE_ANALYSIS_MODEL,
              messages: [{ role: 'user', content: prompt }],
              temperature: 0.2,
              max_tokens: MAX_TOKENS,
            },
      ),
    });

    if (!res.ok) {
      const detail = safeErrorDetail(await res.text().catch(() => ''));
      logger.warn({ status: res.status, detail }, 'draft reply: non-OK');
      return null;
    }

    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      message?: { content?: string };
    };
    const text = (ollama ? json.message?.content : json.choices?.[0]?.message?.content) ?? '';
    const clean = text.replace(/^```[a-z]*\n?|```$/g, '').trim();
    return clean || null;
  } catch (err) {
    logger.warn({ err: String(err) }, 'draft reply: failed');
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Something someone said they would do, and who owes it. */
export interface Commitment {
  who: string;
  what: string;
  when?: string;
  /**
   * The verbatim sentence this was taken from.
   *
   * A paraphrase is a claim the reader has to trust; a quote is one they can
   * check in two seconds against the thread on screen. It is also the only
   * defence against a confident extraction of something nobody said — which is
   * exactly how "Noah built Closewise in a month" became a commitment.
   */
  quote?: string;
}

export interface ThreadDigest {
  commitments: Commitment[];
  openQuestions: string[];
}

/**
 * Extract commitments and unanswered questions from the whole thread.
 *
 * This exists because sentiment is a non-answer on most mail. On an internal
 * scheduling thread "nothing concerning" tells the reader what they already
 * knew, and a panel that says only that is scaffolding. What is genuinely
 * invisible at a glance — especially on a long chain — is who owes what, and
 * which asks never got answered.
 *
 * One call over the whole thread rather than per message: commitments are a
 * property of the conversation, not of any single email, and one call is faster
 * than the per-message loop it partly replaces.
 */
export async function digestThreadLive(input: {
  subject?: string;
  thread: string;
}): Promise<ThreadDigest | null> {
  const env = getEnv();
  const base = baseFor(env);
  if (!base) return null;

  const prompt = [
    'Read this email thread and extract two things.',
    '',
    '1. Commitments: anything someone said they WOULD DO. Use the name as written.',
    '   Include a due date only if the thread states one.',
    '   Include "quote": the exact sentence it came from, copied verbatim.',
    '   A commitment is something the person UNDERTOOK. "We should meet",',
    '   "let\'s schedule a call" and "it would be good to loop them in" are',
    '   suggestions that somebody act -- they are NOT commitments, no matter how',
    '   actionable they sound.',
    '2. Open questions: questions asked that nobody answered later in the thread.',
    '',
    'Do not invent commitments. If someone only expressed an opinion, that is not',
    'a commitment. If there are none, return empty arrays.',
    '',
    `Subject: ${input.subject ?? '(none)'}`,
    '',
    input.thread.slice(0, 6000),
    '',
    'Return ONLY this JSON:',
    '{"commitments":[{"who":"name","what":"short phrase","when":"or omit","quote":"exact sentence"}],"openQuestions":["..."]}',
  ].join('\n');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), env.LIVE_ANALYSIS_TIMEOUT_MS);
  const ollama = env.LIVE_ANALYSIS_PROVIDER === 'ollama';

  try {
    const headers = await authHeaders(env);

    const res = await fetch(endpointFor(base, env.LIVE_ANALYSIS_PROVIDER), {
      method: 'POST',
      headers,
      signal: controller.signal,
      body: JSON.stringify(
        ollama
          ? {
              model: env.LIVE_ANALYSIS_MODEL,
              messages: [{ role: 'user', content: prompt }],
              think: env.LIVE_ANALYSIS_THINK,
              stream: false,
              options: { temperature: 0 },
            }
          : {
              model: env.LIVE_ANALYSIS_MODEL,
              messages: [{ role: 'user', content: prompt }],
              temperature: 0,
              max_tokens: MAX_TOKENS,
            },
      ),
    });

    if (!res.ok) {
      const detail = safeErrorDetail(await res.text().catch(() => ''));
      logger.warn({ status: res.status, detail }, 'thread digest: non-OK');
      return null;
    }

    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      message?: { content?: string };
    };
    const content = (ollama ? json.message?.content : json.choices?.[0]?.message?.content) ?? '';
    return parseDigest(content);
  } catch (err) {
    logger.warn({ err: String(err) }, 'thread digest: failed');
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Tolerant of fences and prose, strict about shape. */
export function parseDigest(raw: string): ThreadDigest | null {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const obj = JSON.parse(match[0]) as { commitments?: unknown; openQuestions?: unknown };
    const commitments = Array.isArray(obj.commitments)
      ? obj.commitments
          .map((c) => c as Record<string, unknown>)
          .filter((c) => typeof c?.who === 'string' && typeof c?.what === 'string')
          .map((c) => ({
            who: String(c.who).trim(),
            what: String(c.what).trim(),
            when: typeof c.when === 'string' && c.when.trim() ? String(c.when).trim() : undefined,
            quote: typeof c.quote === 'string' && c.quote.trim() ? String(c.quote).trim() : undefined,
          }))
          .filter((c) => c.who && c.what)
      : [];
    const openQuestions = Array.isArray(obj.openQuestions)
      ? obj.openQuestions.filter((q): q is string => typeof q === 'string' && q.trim().length > 0).map((q) => q.trim())
      : [];
    // The prompt forbids suggestions and the model returns them anyway --
    // "We should meet and learn from them" was rendered on a live thread as a
    // commitment by the person who wrote it. Filing a suggestion as a debt puts
    // a colleague's name against something they never agreed to, so this is a
    // rule, not a request. See services/commitments.ts.
    return { commitments: filterCommitments(commitments), openQuestions };
  } catch {
    return null;
  }
}

/**
 * What KIND of thread this is. The card renders differently for each, because a
 * scheduling note and a billing complaint do not deserve the same panel — and
 * showing sentiment on a calendar invite is most of why the card read as flat
 * on ordinary mail.
 */
export type ThreadMode = 'complaint' | 'scheduling' | 'opportunity' | 'working' | 'fyi';

export const THREAD_MODES: ThreadMode[] = ['complaint', 'scheduling', 'opportunity', 'working', 'fyi'];

/**
 * One way of answering. The stance is the expertise: a good CSM knows whether
 * this thread wants ownership, a question, or escalation. The median user gets
 * handed one draft and has to make that judgement alone — which is exactly the
 * floor this product is meant to raise.
 *
 * Offered as a choice, not a menu: the first is recommended and renders FILLED,
 * the rest OUTLINED. Three equal buttons would be three decisions.
 */
export interface ReplyOption {
  /** 2-3 words naming the move: "Own it", "Ask first", "Escalate". */
  stance: string;
  /** Why this stance, in one short clause. */
  rationale: string;
  /**
   * The reply itself — present on the RECOMMENDED option only.
   *
   * Writing all three costs 15.5-16.2s against 8.4-8.6s for one, measured on
   * gemma3:12b: two extra drafts nearly double the wait. But the user sends
   * exactly one, so the other two were always going to be thrown away.
   *
   * The choice is the valuable part and it is nearly free — a stance label and
   * a clause is a handful of tokens. So all the stances come back immediately
   * and only the recommended one arrives written. Picking a different stance
   * writes that one on demand, and only the user who disagrees with the
   * recommendation pays for it.
   */
  text: string;
}

export interface ThreadReading {
  mode: ThreadMode;
  /** Ordered: the recommended stance first. */
  replyOptions: ReplyOption[];
  sentiment: LiveSentiment;
  reason: string;
  commitments: Commitment[];
  openQuestions: string[];
  draft: string;
  /**
   * Points that come from account history and are NOT in the thread. The only
   * output here Gemini cannot produce.
   */
  historyPoints: string[];
  /**
   * One sentiment per message, oldest first — the sparkline's series.
   *
   * Asked for in the SAME call as everything else. A separate per-message loop
   * was what made the render path slow enough to time out; the model is already
   * reading every message here, so returning a value per message costs almost
   * nothing.
   */
  messageSentiments: LiveSentiment[];
}

/**
 * Everything the card needs, in ONE model call.
 *
 * This replaces three separate calls (sentiment, digest, draft). They were
 * issued concurrently on the assumption that concurrency buys parallelism — it
 * does not against a local Ollama, which serves one model at a time, so the
 * three requests queued and the wall clock was their SUM. All three then blew
 * the deadline together and the card rendered empty: worse than any one of them
 * alone.
 *
 * One prompt, one response, roughly one call's latency. The model is already
 * reading the whole thread for each of these questions, so asking all three at
 * once costs barely more than asking one.
 */
/**
 * The exact shape the deep read must return, enforced by the decoder.
 *
 * Ollama accepts a JSON Schema as `format` and constrains sampling to tokens
 * that can still produce a valid document. That matters here more than model
 * size does: our need is narrow -- six fields off ~1500 tokens of email -- and
 * the failures have all been SHAPE failures, not comprehension ones. gemma3:27b
 * understood every thread perfectly and still dropped `when` on 3 runs out of 3.
 *
 * A field the schema requires cannot be dropped. That converts the reminder
 * button from something that works when the model remembers to something that
 * works.
 *
 * `when` is required but may be empty, deliberately. Making it optional is how
 * it goes missing; making it a required non-empty string is how it gets
 * invented. Required-and-emptyable forces the model to decide rather than to
 * forget.
 */
const READING_SCHEMA = {
  type: 'object',
  properties: {
    sentiment: { type: 'string', enum: ['positive', 'neutral', 'negative'] },
    reason: { type: 'string' },
    commitments: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          who: { type: 'string' },
          what: { type: 'string' },
          when: { type: 'string' },
          quote: { type: 'string' },
        },
        required: ['who', 'what', 'when', 'quote'],
      },
    },
    openQuestions: { type: 'array', items: { type: 'string' } },
    messageSentiments: {
      type: 'array',
      items: { type: 'string', enum: ['positive', 'neutral', 'negative'] },
    },
  },
  required: ['sentiment', 'reason', 'commitments', 'openQuestions'],
} as const;

export async function readThreadLive(input: {
  subject?: string;
  thread: string;
  /**
   * What we know about this customer that the thread does NOT contain — prior
   * complaints with dates, open tasks, how long the relationship has run.
   *
   * This is the whole differentiation. Gemini sits three inches to the left and
   * reads the same thread we do, so any point derived only from the thread is a
   * point it already makes. History is what it structurally cannot see, and
   * feeding it into the reading is what turns "answer her question" into
   * "she raised billing twice before and it is still open".
   */
  history?: string;
}): Promise<ThreadReading | null> {
  const env = getEnv();
  const base = baseFor(env);
  if (!base) return null;

  const prompt = [
    'Read this email thread and answer every question in one JSON object.',
    '',
    '0. mode: what KIND of thread this is. Exactly one of:',
    '   complaint, someone is dissatisfied, chasing, or escalating',
    '   scheduling, arranging a time, invites, availability, rescheduling',
    '   opportunity, interest in more work, a new service, a referral, a demo',
    '   working, substantive back-and-forth on live work: questions,',
    '                 decisions, deliverables, review',
    '   fyi, announcement, notification, or courtesy note needing no',
    '                 action from the recipient',
    '   Pick fyi only when the recipient genuinely owes nothing.',
    '',
    '1. sentiment: positive, neutral or negative, from the recipient\'s point of',
    '   view. Negative ONLY when someone asserts we failed them; urgency alone is',
    '   not negative.',
    '2. reason: QUOTE the single sentence from the thread that most drives that',
    '   reading, verbatim, in double quotes. Do not summarise and do not',
    '   editorialise. If no single sentence carries it, return "".',
    '3. commitments: things someone will do IN THE FUTURE, with who said it, and',
    '   the VERBATIM sentence they said it in as "quote". If you cannot quote it',
    '   word-for-word from the text below, it is not a commitment, leave it out.',
    '   Use names as written. Include "when" only if the thread states one.',
    '   STRICT: a commitment is a future action the person themselves undertook.',
    '   NOT a commitment: something already done ("Noah built X in a month"),',
    '   a fact, an opinion, a suggestion someone else should act on, or a',
    '   description of how something works. If in doubt, leave it out.',
    '4. openQuestions: questions asked that nobody answered later in the thread,',
    '   quoted VERBATIM as they were written. Not your rephrasing of them.',
    '5. messageSentiments: one sentiment per message IN ORDER, oldest first.',
    '   The array length MUST equal the number of "From:" blocks below.',
    '',
    `Subject: ${input.subject ?? '(none)'}`,
    '',
    input.thread.slice(0, 6000),
    '',
    'Return ONLY this JSON:',
    '{"sentiment":"positive|neutral|negative","reason":"\\"exact quote\\"","commitments":[{"who":"...","what":"...","when":"optional","quote":"exact sentence"}],"openQuestions":["exact question"],"messageSentiments":["neutral","positive"]}',
  ].join('\n');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), env.LIVE_ANALYSIS_TIMEOUT_MS);
  const ollama = env.LIVE_ANALYSIS_PROVIDER === 'ollama';

  try {
    const headers = await authHeaders(env);

    const res = await fetch(endpointFor(base, env.LIVE_ANALYSIS_PROVIDER), {
      method: 'POST',
      headers,
      signal: controller.signal,
      body: JSON.stringify(
        ollama
          ? {
              model: env.LIVE_ANALYSIS_MODEL,
              messages: [{ role: 'user', content: prompt }],
              think: env.LIVE_ANALYSIS_THINK,
              stream: false,
              ...schemaFields(env.LIVE_ANALYSIS_PROVIDER, READING_SCHEMA, 'reading'),
              options: { temperature: 0 },
            }
          : {
              model: env.LIVE_ANALYSIS_MODEL,
              messages: [{ role: 'user', content: prompt }],
              temperature: 0,
              max_tokens: MAX_TOKENS,
              // Runtime is Gemini Flash, and it is the path that has to be
              // right. The schema is what stops `when` going missing -- the
              // failure that silently removes the reminder button -- and
              // reasoning_effort is what stops 2.5 Flash thinking by default,
              // which is billed as output tokens on top of the latency.
              ...schemaFields(env.LIVE_ANALYSIS_PROVIDER, READING_SCHEMA, 'reading'),
              ...reasoningFields(env, base),
            },
      ),
    });

    if (!res.ok) {
      const detail = safeErrorDetail(await res.text().catch(() => ''));
      logger.warn({ status: res.status, detail }, 'thread reading: non-OK');
      return null;
    }

    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      message?: { content?: string };
    };
    return parseReading((ollama ? json.message?.content : json.choices?.[0]?.message?.content) ?? '');
  } catch (err) {
    logger.warn({ err: String(err) }, 'thread reading: failed');
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Partial output is still useful — a missing draft must not discard commitments. */
export function parseReading(raw: string): ThreadReading | null {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const o = JSON.parse(match[0]) as Record<string, unknown>;
    const sentiment = String(o.sentiment ?? '').toLowerCase() as LiveSentiment;
    const digest = parseDigest(match[0]);
    // Only keep values the model actually returned. Padding the series to the
    // message count would invent data points, which is the one thing the
    // sparkline must never do.
    const messageSentiments = Array.isArray(o.messageSentiments)
      ? (o.messageSentiments as unknown[])
          .map((v) => String(v).toLowerCase() as LiveSentiment)
          .filter((v) => SENTIMENTS.has(v))
      : [];

    const rawMode = String(o.mode ?? '').toLowerCase() as ThreadMode;

    return {
      mode: THREAD_MODES.includes(rawMode) ? rawMode : 'working',
      sentiment: SENTIMENTS.has(sentiment) ? sentiment : 'neutral',
      reason: typeof o.reason === 'string' ? o.reason.trim() : '',
      commitments: digest?.commitments ?? [],
      openQuestions: digest?.openQuestions ?? [],
      replyOptions: Array.isArray(o.replyOptions)
        ? (o.replyOptions as Array<Record<string, unknown>>)
            .filter((r) => typeof r?.stance === 'string')
            .map((r) => ({
              stance: String(r.stance).trim(),
              rationale: typeof r.rationale === 'string' ? String(r.rationale).trim() : '',
              text: typeof r.text === 'string' ? String(r.text).trim() : '',
            }))
            .filter((r) => r.stance)
            .slice(0, 3)
        : [],
      draft: typeof o.draft === 'string' ? o.draft.trim() : '',
      messageSentiments,
      historyPoints: Array.isArray(o.historyPoints)
        ? (o.historyPoints as unknown[])
            .filter((q): q is string => typeof q === 'string' && q.trim().length > 0)
            .map((q) => q.trim())
            .slice(0, 3)
        : [],
    };
  } catch {
    return null;
  }
}


/**
 * Classify the thread in ONE focused question.
 *
 * Measured, and it overturns the "one big call" decision made earlier today:
 * asking for the mode as instruction 0 of 7 returned the fallback on every
 * thread tested, while asking it alone returns the right answer in 0.6s. A model
 * given seven jobs does the last few badly, and the cost of a second call is
 * less than the cost of a wrong card.
 *
 * It also enables the real saving below — most mail needs nothing, and knowing
 * that for 0.6s means never paying 5s to find out.
 */
/**
 * The chat endpoint for the configured provider.
 *
 * Centralised because it was written out at seven call sites. The 'gemini'
 * branch exists because the path differs: Google documents the compat API at
 * .../v1beta/openai/chat/completions, while the 'openai' branch appends
 * /v1/chat/completions to its base.
 *
 * UNVERIFIED whether the doubled path would actually have failed -- Google
 * rejects on the missing Authorization header before it routes, so both spellings
 * return the same 400 and no key was available to test past it. The 'gemini'
 * branch uses the documented path, which is the defensible choice either way.
 */
function endpointFor(base: string, provider: string): string {
  if (provider === 'ollama') return `${base}/api/chat`;
  if (provider === 'gemini') return `${base}/chat/completions`;
  return `${base}/v1/chat/completions`;
}

/**
 * `reasoning_effort`, in the spelling the configured HOST accepts.
 *
 * The two Gemini hosts disagree about the name of "do not think", and neither
 * degrades: the request is rejected outright.
 *
 *   generativelanguage.googleapis.com   'none'
 *   {…}aiplatform.googleapis.com        the field OMITTED
 *
 * Vertex rejects 'none' outright -- 400 "Expected 'reasoning_effort' to be one
 * of: 'high', 'low', 'medium', 'minimal'; found 'none'." -- and its nearest
 * spelling, 'minimal', is NOT the same thing: minimal still thinks. Measured
 * 2026-08-27 on gemini-3.1-flash-lite, one-word classification, max_tokens 64:
 *
 *   reasoning_effort: 'minimal'   60 reasoning tokens, finish_reason 'length',
 *                                 content NULL          -- 1017ms
 *   field omitted                 0 reasoning tokens, completion_tokens 1,
 *                                 content "scheduling"  --  737ms
 *
 * So on Vertex "do not think" is spelled by ABSENCE. Mapping 'none' to
 * 'minimal' looks like the careful translation and reproduces, exactly, the bug
 * the max_tokens comment in classifyThreadMode already describes: a 200 with no
 * content, which every caller reads as "unclassifiable" rather than as an error.
 *
 * Keyed on the BASE URL, not on a second env var: the host is already the thing
 * that decides, so a separate switch could only ever contradict it.
 */
function reasoningFields(env: Env, base: string): Record<string, unknown> {
  if (env.LIVE_ANALYSIS_PROVIDER !== 'gemini' || env.LIVE_ANALYSIS_REASONING === 'unset') return {};
  const vertex = base.includes('aiplatform.googleapis.com');
  if (vertex && env.LIVE_ANALYSIS_REASONING === 'none') return {};
  return { reasoning_effort: env.LIVE_ANALYSIS_REASONING };
}

/**
 * The request headers for a model call, including the credential.
 *
 * Centralised for the same reason `endpointFor` was: these two lines were
 * written out at seven call sites, and under ADC they are no longer two lines
 * but an async token mint. Seven copies of that is seven places to forget the
 * await.
 *
 * The header shape does not change between modes — Vertex takes an ordinary
 * `Authorization: Bearer`, exactly as an API key did — so only the source of
 * the string differs.
 *
 * A failure to mint returns headers WITHOUT authorization rather than throwing.
 * The call then fails with a 401 that `safeErrorDetail` logs, which is a
 * diagnosable error; throwing here would abort the render path and blank the
 * card instead, and this codebase's recurring failure is a panel that goes
 * quiet rather than one that complains.
 */
async function authHeaders(env: Env): Promise<Record<string, string>> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (env.LIVE_ANALYSIS_AUTH === 'adc') {
    const token = await accessToken();
    if (token) headers.authorization = `Bearer ${token}`;
    return headers;
  }
  if (env.LIVE_ANALYSIS_KEY) headers.authorization = `Bearer ${env.LIVE_ANALYSIS_KEY}`;
  return headers;
}

/**
 * One GoogleAuth for the process, because it is the token cache.
 *
 * `getAccessToken()` returns the cached token until it nears expiry and
 * refreshes it transparently, so this is cheap on every call after the first —
 * but only while the client is reused. Constructing a GoogleAuth per request
 * would re-read the credential and re-mint a token on every panel render.
 */
let googleAuth: GoogleAuth | null = null;

async function accessToken(): Promise<string | null> {
  try {
    googleAuth ??= new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
    const client = await googleAuth.getClient();
    const { token } = await client.getAccessToken();
    return token ?? null;
  } catch (err) {
    // The message only. Never the credential, and never the token.
    logger.warn({ err: String(err) }, 'live analysis: could not mint an ADC token');
    return null;
  }
}

/** The base URL for the configured provider. */
function baseFor(env: Env): string {
  const raw =
    env.LIVE_ANALYSIS_PROVIDER === 'gemini'
      ? env.LIVE_ANALYSIS_GEMINI_URL
      : env.LIVE_ANALYSIS_URL;
  return raw.trim().replace(/\/+$/, '');
}

/**
 * Provider-specific fields that constrain the output to a JSON schema.
 *
 * Ollama takes a bare `format`; the OpenAI-compatible providers take
 * `response_format` with a named json_schema. Gemini honours it. Ollama honours
 * it for gguf models and SILENTLY IGNORES it on the MLX runner, which is how
 * the reply section once rendered empty with no error -- so callers on that path
 * must still parse defensively rather than trusting the shape.
 */
function schemaFields(provider: string, schema: unknown, name: string): Record<string, unknown> {
  if (!schema) return {};
  if (provider === 'ollama') return { format: schema };
  return {
    response_format: { type: 'json_schema', json_schema: { name, schema, strict: true } },
  };
}

export async function classifyThreadMode(input: {
  subject?: string;
  thread: string;
}): Promise<ThreadMode | null> {
  const env = getEnv();
  const base = baseFor(env);
  if (!base) return null;

  const prompt = [
    'Classify this email thread. Reply with ONE word only, no punctuation, from this list:',
    'complaint scheduling opportunity working fyi',
    '',
    'Work through these IN ORDER and stop at the first that matches.',
    '',
    '1. fyi -- nothing is required of the recipient. An automated notification,',
    '   receipt, invoice notice, payment alert, system or calendar reminder, a',
    '   newsletter, an out-of-office, a report that just arrived, or a thread',
    '   whose whole content is thanks, praise or congratulations. If no human',
    '   wrote it TO this person expecting anything back, it is fyi.',
    '   CALENDAR MACHINERY IS fyi, NOT scheduling: "Accepted:", "Declined:",',
    '   "Updated invitation:", "Invitation:", a resent invite, a chat',
    '   notification, a meeting-notes mail. The time is already settled or the',
    '   system is telling you about it, nothing is being ARRANGED with you.',
    '',
    '2. scheduling -- a HUMAN is arranging a time WITH YOU and it is not settled:',
    '   proposing slots, asking your availability, requesting a reschedule.',
    '   There must be an open question about WHEN. An automated invite,',
    '   acceptance or update is fyi, not scheduling -- see rule 1. A meeting',
    '   mentioned in passing inside other work is not scheduling either.',
    '',
    '3. complaint -- someone is DISSATISFIED, chasing something overdue, or',
    '   escalating. There must be real friction: frustration, a repeated ask that',
    '   went unanswered, a mistake being called out, a threat to leave or cancel.',
    '   DISSATISFACTION EXPRESSED POLITELY IS STILL A COMPLAINT. Do not be swayed',
    '   by a calm tone or a "thanks in advance" -- judge the substance.',
    '   A BILLING DISPUTE IS A COMPLAINT: a charge questioned, a duplicate or',
    '   unexpected fee, "why are you still charging us", "please stop billing',
    '   us", "this invoice is wrong", "we already paid this". These are the most',
    '   common form of complaint in this business and they always arrive wrapped',
    '   in operational detail.',
    '   "I thought we had resolved this" and "he did not do that today" are',
    '   complaints even though they are short and unemotional.',
    '   Merely asking for something is not a complaint. A first polite follow-up',
    '   is not a complaint. Urgency alone is not a complaint.',
    '',
    '4. opportunity -- interest in NEW work: a new service, a referral, a demo, a',
    '   proposal, a prospect enquiring. Existing work continuing is not this.',
    '',
    '5. working -- everything else. Substantive back-and-forth on live work:',
    '   requests, answers, documents, numbers, invoices being discussed,',
    '   approvals, ongoing delivery. This is the most common answer by far, so',
    '   choose it whenever 1-4 do not clearly apply.',
    '',
    `Subject: ${input.subject ?? '(none)'}`,
    input.thread.slice(0, 3000),
  ].join('\n');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  const ollama = env.LIVE_ANALYSIS_PROVIDER === 'ollama';

  try {
    const headers = await authHeaders(env);
    const res = await fetch(endpointFor(base, env.LIVE_ANALYSIS_PROVIDER), {
      method: 'POST',
      headers,
      signal: controller.signal,
      body: JSON.stringify(
        ollama
          ? {
              model: env.LIVE_ANALYSIS_MODEL,
              messages: [{ role: 'user', content: prompt }],
              think: env.LIVE_ANALYSIS_THINK,
              stream: false,
              options: { temperature: 0 },
            }
          : {
              model: env.LIVE_ANALYSIS_MODEL,
              messages: [{ role: 'user', content: prompt }],
              temperature: 0,
              // 64, not 12. Gemini counts THINKING against max_tokens, so a tight
              // cap plus default thinking returns a response with no `content`
              // field at all -- not an error, just an absent answer, which this
              // function then read as "unclassifiable" and fell back to working
              // on every single thread.
              max_tokens: 64,
              // The actual fix: without this, 2.5 Flash reasons about a
              // one-word classification. With it, the answer costs 1 token.
              ...reasoningFields(env, base),
            },
      ),
    });
    // SAY WHY. This returned null silently, and null here is indistinguishable
    // from "the model could not classify it" -- so a rejected request became a
    // thread quietly falling back to 'working'. A 400 for a malformed field
    // looked exactly like an unclassifiable email.
    if (!res.ok) {
      const detail = safeErrorDetail(await res.text().catch(() => ''));
      logger.warn({ status: res.status, detail }, 'mode classify: non-OK');
      return null;
    }
    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      message?: { content?: string };
    };
    const content = (ollama ? json.message?.content : json.choices?.[0]?.message?.content) ?? '';
    // An EMPTY content on a 200 is the documented failure of the max_tokens cap
    // above, not an opinion about the thread. Worth its own line, because the
    // fix is a budget change and the symptom is silence.
    if (!content.trim()) logger.warn({}, 'mode classify: 200 with no content (token budget?)');
    const raw = content.toLowerCase().replace(/[^a-z]/g, '');
    return (THREAD_MODES as string[]).includes(raw) ? (raw as ThreadMode) : null;
  } catch (err) {
    logger.warn({ err: String(err) }, 'mode classify: failed');
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Write the reply for a stance the user picked over the recommendation.
 *
 * Focused on one job, which is why it is fast: a model given six instructions
 * does the sixth badly — that is how historyPoints came back empty and how mode
 * came back as the fallback on every thread.
 */
export async function draftForStance(input: {
  subject?: string;
  thread: string;
  stance: string;
  history?: string;
}): Promise<string | null> {
  const env = getEnv();
  const base = baseFor(env);
  if (!base) return null;

  // Pure prose, no schema to get wrong — exactly the job the fast model is for.
  const model = env.LIVE_ANALYSIS_FAST_MODEL || env.LIVE_ANALYSIS_MODEL;

  const prompt = [
    `Write a reply to this email thread taking this approach: "${input.stance}".`,
    '',
    'Three sentences maximum. No greeting, no sign-off.',
    'Commit only to what the thread already supports, never invent a date, a',
    'price, or a promise.',
    'NEVER write a placeholder. No [Name], no [date], no blank to fill in. A',
    'reply the user has to edit before sending has not saved them anything.',
    ...(input.history
      ? ['', 'Context the thread does not contain, which the reply must account',
         'for:', input.history]
      : []),
    '',
    `Subject: ${input.subject ?? '(none)'}`,
    '',
    input.thread.slice(0, 6000),
    '',
    'Return ONLY the reply text, nothing else.',
  ].join('\n');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), env.LIVE_ANALYSIS_TIMEOUT_MS);
  const ollama = env.LIVE_ANALYSIS_PROVIDER === 'ollama';

  try {
    const headers = await authHeaders(env);
    const res = await fetch(endpointFor(base, env.LIVE_ANALYSIS_PROVIDER), {
      method: 'POST',
      headers,
      signal: controller.signal,
      body: JSON.stringify(
        ollama
          ? {
              model,
              messages: [{ role: 'user', content: prompt }],
              think: env.LIVE_ANALYSIS_THINK,
              stream: false,
              options: { temperature: 0.3 },
            }
          : {
              model,
              messages: [{ role: 'user', content: prompt }],
              temperature: 0.3,
            },
      ),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      message?: { content?: string };
    };
    const raw = (ollama ? json.message?.content : json.choices?.[0]?.message?.content) ?? '';
    const out = raw.trim().replace(/^["'`]+|["'`]+$/g, '').trim();
    return out || null;
  } catch (err) {
    logger.warn({ err: String(err) }, 'stance draft: failed');
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * How to answer -- stances plus the recommended draft.
 *
 * Split off the extraction call and run CONCURRENTLY with it, on the fast model.
 *
 * Two facts make this the right shape. First, Ollama runs two DIFFERENT models
 * at once when both fit in memory: measured, work that takes 4.8s + 2.7s
 * sequentially completes in 4.8s wall. (Which is the opposite of the same model
 * called twice -- that serialises, and wall-clock is the sum.) Second, the reply
 * was the largest block of output tokens in a response whose cost is almost
 * entirely generation at ~31.9 tok/s, so moving it off the extraction call makes
 * that call shorter as well as making the two overlap.
 *
 * It also puts each job on the model that is good at it. Extraction is a shape
 * problem and gemma3:12b is reliable at it; prose is a fluency problem and
 * nemotron is 2.5x faster with no schema to get wrong. The reverse pairing is
 * what produced "well-formed garbage" on phi3.5 -- every field present, the
 * sentiment wrong, the reason empty, and the open question echoing the schema
 * hint back.
 *
 * This call owns the whole "How to answer" section, stance labels included, so
 * there is no risk of a label from one model being attached to prose from
 * another.
 */
const OPTIONS_SCHEMA = {
  type: 'object',
  properties: {
    replyOptions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          stance: { type: 'string' },
          rationale: { type: 'string' },
          text: { type: 'string' },
        },
        required: ['stance', 'rationale', 'text'],
      },
    },
  },
  required: ['replyOptions'],
} as const;

/**
 * The moves that are actually available, per kind of thread.
 *
 * Without this the reply was generated mode-blind: the card changed which
 * sections it rendered, but the draft underneath was the same paragraph in
 * every shape. That makes the modal design cosmetic — a complaint and a
 * scheduling thread do not want differently-arranged sections around identical
 * prose, they want different prose.
 *
 * These are the stances a competent person would actually choose between on
 * that kind of thread. Naming them is most of the value: the choice is where
 * the expertise lives, and "Own it / Ask first / Escalate" is a different
 * decision from "Accept the time / Propose another / Hand off".
 */
const MODE_STANCES: Record<ThreadMode, string> = {
  complaint:
    'Own it (take responsibility, commit to a next step) / Ask first (get the ' +
    'one fact that unblocks it) / Escalate (bring in someone who can decide)',
  scheduling:
    'Accept (take the proposed time) / Propose another (offer specific ' +
    'alternatives) / Hand off (someone else should take this meeting)',
  opportunity:
    'Lean in (express interest, propose the next step) / Qualify (ask what ' +
    'decides whether this is real) / Defer (interested, wrong moment, say when)',
  working:
    'Answer (give them what they asked for) / Commit (say what you will do and ' +
    'by when) / Unblock (name what YOU need before this can move)',
  fyi: 'Acknowledge briefly / No reply needed',
};

export async function writeReplyOptions(input: {
  subject?: string;
  thread: string;
  /** Joined account history — what the thread does NOT contain. */
  history?: string;
  /**
   * Shapes the stances offered. Without it every mode got the same draft, which
   * is what made the modal card look like a rearrangement rather than a
   * different answer.
   */
  mode?: ThreadMode;
}): Promise<ReplyOption[]> {
  const env = getEnv();
  const base = baseFor(env);
  if (!base) return [];
  const model = env.LIVE_ANALYSIS_FAST_MODEL || env.LIVE_ANALYSIS_MODEL;

  const prompt = [
    'Give TWO genuinely different ways to answer this email thread, best first.',
    '',
    ...(input.mode
      ? [
          `This is a ${input.mode} thread. Choose from these moves:`,
          `  ${MODE_STANCES[input.mode]}`,
          'Use the move names as the stance. Write for THAT move -- a reply that',
          'accepts a meeting time reads nothing like one that takes ownership of',
          'a complaint.',
          '',
        ]
      : []),
    'Each has a stance (2-3 words naming the move) and a rationale (one short',
    'clause for why that move). They must differ in APPROACH, not wording.',
    'Two options that say the same thing differently are worthless.',
    '',
    'Write the full reply text for the FIRST one ONLY. Leave text empty for the',
    'second -- the user picks a stance before anyone needs the prose. That text',
    'is three sentences maximum, no greeting, no sign-off.',
    '',
    'NEVER write a placeholder. No [Name], no [date], no blank to fill in. A',
    'reply the user has to edit before sending has not saved them anything.',
    'Commit only to what the thread already supports -- never invent a date, a',
    'price, or a promise.',
    ...(input.history
      ? ['', 'CONTEXT the thread does not contain. The first reply MUST account',
         'for it -- a reply that ignores a repeat complaint is the single worst',
         'thing this product could produce:', input.history]
      : []),
    '',
    `Subject: ${input.subject ?? '(none)'}`,
    '',
    input.thread.slice(0, 6000),
    '',
    'Return ONLY this JSON:',
    '{"replyOptions":[{"stance":"Own it","rationale":"third time raised","text":"full reply here"},{"stance":"Ask first","rationale":"scope is unclear","text":""}]}',
  ].join('\n');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), env.LIVE_ANALYSIS_TIMEOUT_MS);
  const ollama = env.LIVE_ANALYSIS_PROVIDER === 'ollama';

  try {
    const headers = await authHeaders(env);
    const res = await fetch(endpointFor(base, env.LIVE_ANALYSIS_PROVIDER), {
      method: 'POST',
      headers,
      signal: controller.signal,
      body: JSON.stringify(
        ollama
          ? {
              model,
              messages: [{ role: 'user', content: prompt }],
              think: env.LIVE_ANALYSIS_THINK,
              stream: false,
              // No `format` on the Ollama branch. The MLX runner IGNORES
              // constrained decoding -- nemotron-3.5-lightning:30b-mlx returns
              // prose and the parse finds no JSON at all, which is how this
              // section once rendered empty with no error. Enforced by prompt
              // and a tolerant parser there instead.
              options: { temperature: 0.4 },
            }
          : {
              model,
              messages: [{ role: 'user', content: prompt }],
              temperature: 0.4,
              // Gemini DOES honour it, and this is the runtime path.
              ...schemaFields(env.LIVE_ANALYSIS_PROVIDER, OPTIONS_SCHEMA, 'replyOptions'),
              ...reasoningFields(env, base),
            },
      ),
    });
    if (!res.ok) return [];
    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      message?: { content?: string };
    };
    const raw = (ollama ? json.message?.content : json.choices?.[0]?.message?.content) ?? '';
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return [];
    const o = JSON.parse(match[0]) as Record<string, unknown>;
    if (!Array.isArray(o.replyOptions)) return [];
    return (o.replyOptions as Array<Record<string, unknown>>)
      .filter((r) => typeof r?.stance === 'string')
      .map((r) => ({
        stance: String(r.stance).trim(),
        rationale: typeof r.rationale === 'string' ? String(r.rationale).trim() : '',
        text: typeof r.text === 'string' ? String(r.text).trim() : '',
      }))
      .filter((r) => r.stance)
      .slice(0, 3);
  } catch (err) {
    logger.warn({ err: String(err) }, 'reply options: failed');
    return [];
  } finally {
    clearTimeout(timer);
  }
}
