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
  limit = 5,
): Promise<LiveAnalysis[]> {
  if (!isLiveAnalysisEnabled() || !messages.length) return [];

  // Most recent `limit`, then back to oldest-first so the series reads left to
  // right the way the sparkline renders it.
  const recent = messages.slice(-limit);
  const results = await Promise.all(
    recent.map((m) => analyseMessageLive({ from: m.from, body: m.body })),
  );
  return results.filter((r): r is LiveAnalysis => r !== null);
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
