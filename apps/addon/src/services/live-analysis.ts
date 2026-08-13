import { getEnv } from '../env';
import { logger } from '../utils/logger';

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
  return getEnv().LIVE_ANALYSIS_URL.trim().length > 0;
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
  const base = env.LIVE_ANALYSIS_URL.trim().replace(/\/+$/, '');
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
    '{"sentiment":"positive|neutral|negative","reason":"one short sentence"}',
  ].join('\n');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), env.LIVE_ANALYSIS_TIMEOUT_MS);
  const ollama = env.LIVE_ANALYSIS_PROVIDER === 'ollama';

  try {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (env.LIVE_ANALYSIS_KEY) headers.authorization = `Bearer ${env.LIVE_ANALYSIS_KEY}`;

    const url = ollama ? `${base}/api/chat` : `${base}/v1/chat/completions`;
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
      const detail = await res.text().then((t) => t.slice(0, 300)).catch(() => '');
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
  const base = env.LIVE_ANALYSIS_URL.trim().replace(/\/+$/, '');
  if (!base) return null;

  const prompt = [
    'Write a short reply to the email thread below, as the recipient.',
    'Rules: 3 sentences maximum. Acknowledge the substance specifically.',
    'Commit only to what the thread already supports — never invent a date,',
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
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (env.LIVE_ANALYSIS_KEY) headers.authorization = `Bearer ${env.LIVE_ANALYSIS_KEY}`;

    const res = await fetch(ollama ? `${base}/api/chat` : `${base}/v1/chat/completions`, {
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
      const detail = await res.text().then((t) => t.slice(0, 200)).catch(() => '');
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
  const base = env.LIVE_ANALYSIS_URL.trim().replace(/\/+$/, '');
  if (!base) return null;

  const prompt = [
    'Read this email thread and extract two things.',
    '',
    '1. Commitments: anything someone said they WOULD DO. Use the name as written.',
    '   Include a due date only if the thread states one.',
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
    '{"commitments":[{"who":"name","what":"short phrase","when":"or omit"}],"openQuestions":["..."]}',
  ].join('\n');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), env.LIVE_ANALYSIS_TIMEOUT_MS);
  const ollama = env.LIVE_ANALYSIS_PROVIDER === 'ollama';

  try {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (env.LIVE_ANALYSIS_KEY) headers.authorization = `Bearer ${env.LIVE_ANALYSIS_KEY}`;

    const res = await fetch(ollama ? `${base}/api/chat` : `${base}/v1/chat/completions`, {
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
      const detail = await res.text().then((t) => t.slice(0, 200)).catch(() => '');
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
          }))
          .filter((c) => c.who && c.what)
      : [];
    const openQuestions = Array.isArray(obj.openQuestions)
      ? obj.openQuestions.filter((q): q is string => typeof q === 'string' && q.trim().length > 0).map((q) => q.trim())
      : [];
    return { commitments, openQuestions };
  } catch {
    return null;
  }
}

export interface ThreadReading {
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
  const base = env.LIVE_ANALYSIS_URL.trim().replace(/\/+$/, '');
  if (!base) return null;

  const prompt = [
    'Read this email thread and answer all four questions in one JSON object.',
    '',
    '1. sentiment: positive, neutral or negative, from the recipient\'s point of',
    '   view. Negative ONLY when someone asserts we failed them; urgency alone is',
    '   not negative.',
    '2. reason: one short sentence supporting that sentiment.',
    '3. commitments: things someone will do IN THE FUTURE, with who said it.',
    '   Use names as written. Include "when" only if the thread states one.',
    '   STRICT: a commitment is a future action the person themselves undertook.',
    '   NOT a commitment: something already done ("Noah built X in a month"),',
    '   a fact, an opinion, a suggestion someone else should act on, or a',
    '   description of how something works. If in doubt, leave it out.',
    '4. openQuestions: questions asked that nobody answered later in the thread.',
    '5. draft: a reply the recipient could send. Three sentences maximum, no',
    '   greeting, no sign-off. Commit only to what the thread already supports.',
    '   If the HISTORY section below shows this was raised before, the draft must',
    '   acknowledge that explicitly — a reply that ignores a repeat complaint is',
    '   the single worst thing this product could produce.',
    '6. messageSentiments: one sentiment per message IN ORDER, oldest first.',
    '   The array length MUST equal the number of "From:" blocks below.',
    '',
    `Subject: ${input.subject ?? '(none)'}`,
    '',
    input.thread.slice(0, 6000),
    '',
    'Return ONLY this JSON:',
    '{"sentiment":"positive|neutral|negative","reason":"...","commitments":[{"who":"...","what":"...","when":"optional"}],"openQuestions":["..."],"draft":"...","messageSentiments":["neutral","positive"]}',
  ].join('\n');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), env.LIVE_ANALYSIS_TIMEOUT_MS);
  const ollama = env.LIVE_ANALYSIS_PROVIDER === 'ollama';

  try {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (env.LIVE_ANALYSIS_KEY) headers.authorization = `Bearer ${env.LIVE_ANALYSIS_KEY}`;

    const res = await fetch(ollama ? `${base}/api/chat` : `${base}/v1/chat/completions`, {
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
      const detail = await res.text().then((t) => t.slice(0, 200)).catch(() => '');
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

    return {
      sentiment: SENTIMENTS.has(sentiment) ? sentiment : 'neutral',
      reason: typeof o.reason === 'string' ? o.reason.trim() : '',
      commitments: digest?.commitments ?? [],
      openQuestions: digest?.openQuestions ?? [],
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
