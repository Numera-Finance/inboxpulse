import dotenv from 'dotenv';
import { resolve } from 'path';

// Load environment variables with .env.local taking precedence
dotenv.config({ path: resolve(process.cwd(), '.env.local') });
dotenv.config({ path: resolve(process.cwd(), '.env') });

// Validate environment variables via Zod schema (exits on failure)
import { getEnv } from './env';
getEnv();

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger as honoLogger } from 'hono/logger';
import { logger } from './utils/logger';
import { pushCard } from './cards/widgets';
import { buildHomepageCard } from './cards/homepage';
import { buildThreadCard } from './cards/thread';
import { buildFlaggedDetailCard } from './cards/flagged-detail';
import { signalNames } from './cards/signals';
import { getGmail, getActionParameters, type AddonEvent } from './gmail/event';
import { fetchMessageHeaders, fetchMessageBody, fetchThreadMessages, normalizeGmailMessageId } from './gmail/gmail-api';
import { verifyRequest } from './auth/verify';
import {
  createTask,
  getAccountContext,
  getAnalyzedEmail,
  getDangerPulse,
  getFires,
  getSlowResponders,
  getThreadFlagged,
  getThreadTrend,
  getWaitingClients,
  resolveTenantByEmail,
  resolveThreadByMessage,
  resolveThreadIdByProvider,
  resolveViewer,
} from './services/api-client';
import { analyseMessageLive, readThreadLive, writeReplyOptions, draftForStance, classifyThreadMode, isLiveAnalysisEnabled, THREAD_MODES } from './services/live-analysis';
import type { ReplyOption, ThreadMode } from './services/live-analysis';
import { solidBarPng } from './assets/bar';
import { LOGO_PNG_BASE64 } from './assets/logo';
import { AnalysisCache } from './services/analysis-cache';
import {
  InstantLabelState,
  WorkingSet,
  INSTANT_LABELS,
  MODE_LABELS,
  instantLabelByKey,
  modeLabelFor,
  gmailThreadUrl,
  retiredLabelNames,
} from './services/instant-labels';
import { ensureLabel, addLabel, removeLabel, labelsOnThread, recentThreads, clearAllOfLabel, deleteLabelByName } from './gmail/labels';
import { rankTriage, splitQuiet } from './services/triage';
import { buildTriageCard } from './cards/triage';

/**
 * The user's working set — threads they marked, and when each mark expires.
 *
 * Process-local by design: the contract is that these do not outlive the
 * session, so persisting them would recreate exactly the accretion the expiry
 * exists to prevent. See services/instant-labels.ts.
 */
const instantState = new InstantLabelState();
const workingSet = new WorkingSet(instantState);

/**
 * Analysed threads, in memory, for as long as the thread has not changed.
 *
 * Process-local and never persisted -- the card promises "Analysed live. Not
 * stored", and that has to stay literally true for a personal mailbox. See
 * services/analysis-cache.ts.
 */
const analysisCache = new AnalysisCache<{
  mode: Awaited<ReturnType<typeof classifyThreadMode>>;
  reading: Awaited<ReturnType<typeof readThreadLive>>;
  replyOptions: ReplyOption[];
}>(undefined, undefined, undefined, getEnv().ADDON_CACHE_DIR || null);
import { shareToChat, isChatShareEnabled } from './services/chat';
import { deriveParticipants, type Participant } from './services/participants';

const app = new Hono();

app.use('*', honoLogger());
app.use('*', cors());

/** Resolve the tenant for a request: signed-in user's email → tenant, else dev fallback. */
async function resolveTenant(email: string | undefined): Promise<string | null> {
  if (email) {
    const t = await resolveTenantByEmail(email);
    if (t) return t;
  }
  return getEnv().ADDON_DEV_TENANT_ID ?? null;
}

/**
 * A solid color band, for separating groups on the card.
 *
 * Public and unauthenticated like /logo.png, and safe to be: the response is a
 * rectangle of one color and the request carries nothing but that color. The
 * chart endpoint deleted in ADR-004 was neither — its query string held a
 * customer's sentiment sequence.
 *
 * Color is validated to six hex digits and height clamped, so the URL cannot
 * be used to make the add-on render something arbitrary or allocate a large
 * buffer.
 */
app.get('/bar.png', (c) => {
  const hex = (c.req.query('c') ?? '').replace(/[^0-9a-fA-F]/g, '').slice(0, 6);
  const h = Math.min(24, Math.max(2, Number(c.req.query('h') ?? 6) || 6));
  return new Response(solidBarPng(hex, 600, h), {
    headers: {
      'content-type': 'image/png',
      // Immutable: the bytes are a pure function of the query string.
      'cache-control': 'public, max-age=31536000, immutable',
    },
  });
});

app.get('/logo.png', (c) => {
  // Served by the add-on itself so the icon cannot outlive its host. See
  // assets/logo.ts — the previous URL stopped resolving and the rail showed an
  // empty circle.
  const png = Buffer.from(LOGO_PNG_BASE64, 'base64');
  return new Response(png, {
    headers: { 'content-type': 'image/png', 'cache-control': 'public, max-age=86400' },
  });
});

app.get('/health', (c) =>
  c.json({ status: 'ok', service: 'crm-addon', timestamp: new Date().toISOString() }),
);

// (The trend chart used to be served here as a self-rasterized PNG at
// /chart/trend.png — a public, unauthenticated endpoint. The Trend section now
// uses native CardService widgets, so the route and its rasterizer are gone.)

// Action callback: a row in "Flagged messages" was clicked. Pushes a detail card
// onto the add-on's own stack — the in-panel alternative to navigating, since an
// add-on can't move Gmail's thread pane. Falls back gracefully at every step: a
// missing body still renders the flags + metadata we already hold.
app.post('/gmail/flagged/detail', async (c) => {
  const env = getEnv();
  let event: AddonEvent = {};
  try {
    event = await c.req.json<AddonEvent>();
  } catch {
    /* keep the endpoint curl-testable */
  }

  const verified = await verifyRequest(c.req.header('authorization'), event);
  if (!verified.ok) {
    logger.warn({ reason: verified.reason }, 'flagged/detail: request not verified');
    return c.json(pushCard(buildThreadCard({ status: 'unverified' })));
  }

  const params = getActionParameters(event);
  const messageId = params.messageId;
  const threadId = params.threadId;
  const tenantId = await resolveTenant(verified.email);
  if (!messageId || !threadId || !tenantId) {
    return c.json(pushCard(buildThreadCard({ status: 'untracked' })));
  }

  // Re-read the thread's flags rather than stuffing them through action
  // parameters — they're strings, and the reason text is long.
  const flagged = await getThreadFlagged(threadId, tenantId);
  const message = flagged.find((m) => m.messageId === messageId);
  if (!message) return c.json(pushCard(buildThreadCard({ status: 'untracked' })));

  const { accessToken, oauthToken } = getGmail(event);
  const body = await fetchMessageBody(messageId, oauthToken, accessToken);

  return c.json(pushCard(buildFlaggedDetailCard({ message, body, viewerEmail: verified.email })));
});

// Action callback: "Share to Chat" on the thread card. Posts a short summary to
// the configured space and answers with a toast — deliberately NOT a card
// rebuild, so the user keeps their place in the panel.
app.post('/gmail/share/chat', async (c) => {
  let event: AddonEvent = {};
  try {
    event = await c.req.json<AddonEvent>();
  } catch {
    /* keep the endpoint curl-testable */
  }

  const verified = await verifyRequest(c.req.header('authorization'), event);
  if (!verified.ok) {
    logger.warn({ reason: verified.reason }, 'share/chat: request not verified');
    return c.json(notify('Could not verify this request.'));
  }

  const p = getActionParameters(event);
  const ok = await shareToChat({
    subject: p.subject,
    from: p.from,
    sentiment: p.sentiment,
    reason: p.reason,
    link: p.messageId ? gmailMessageLink(p.messageId, verified.email) : undefined,
    sharedBy: verified.email,
  });

  return c.json(notify(ok ? 'Shared to Chat' : 'Could not share to Chat'));
});

/** Deep link to a single message, targeting the viewer's account by address. */
function gmailMessageLink(messageId: string, viewerEmail?: string): string {
  const target = viewerEmail ? `?authuser=${encodeURIComponent(viewerEmail)}` : '';
  return `https://mail.google.com/mail/u/0/${target}#all/${encodeURIComponent(messageId)}`;
}

/**
 * The things worth knowing that the thread does not contain, straight from the
 * account record. This is the differentiated content on the card and it costs
 * one database round-trip that has already happened.
 */
function buildHistoryPoints(account: { found: boolean; negativeCount: number; openTasks: number; lastSeen?: string; priorConcerns: Array<{ when: string; reason: string }> } | null): string[] {
  if (!account?.found) return [];
  const points: string[] = [];

  // Repeat complaints lead — a customer raising the same thing again is the
  // single most useful thing to know before replying, and it is invisible in
  // the open thread.
  for (const c of account.priorConcerns.slice(0, 2)) {
    const short = c.reason.length > 120 ? `${c.reason.slice(0, 117)}…` : c.reason;
    points.push(`${c.when} — ${short}`);
  }

  if (account.openTasks > 0) {
    points.push(`${account.openTasks} task${account.openTasks === 1 ? '' : 's'} still open on this account`);
  }

  return points.slice(0, 3);
}

/** A toast, with no card mutation — the cheapest possible action response. */
function notify(text: string) {
  return { action: { notification: { text } } };
}

// Action callback: "Read this thread". This is where the model call lives — off
// the first-paint path, so opening the panel is instant and the ~6s of analysis
// happens only when asked for. Answers with a full card via pushCard.
app.post('/gmail/analyse', async (c) => {
  let event: AddonEvent = {};
  try {
    event = await c.req.json<AddonEvent>();
  } catch {
    /* keep the endpoint curl-testable */
  }

  const verified = await verifyRequest(c.req.header('authorization'), event);
  if (!verified.ok) {
    return c.json(pushCard(buildThreadCard({ status: 'unverified' })));
  }

  const { accessToken, oauthToken } = getGmail(event);
  const p = getActionParameters(event);
  const messageId = normalizeGmailMessageId(p.messageId);
  const threadId = normalizeGmailMessageId(p.threadId);
  const viewerEmail = verified.email;
  const baseUrl = getEnv().ADDON_BASE_URL;

  const headers = await fetchMessageHeaders(messageId, oauthToken, accessToken);
  const threadMessages = await fetchThreadMessages(threadId, oauthToken, accessToken);
  const participants = threadMessages?.length ? deriveParticipants(threadMessages, viewerEmail) : [];

  // Sweep on EVERY thread open, not just when a label button is pressed.
  //
  // The sweep used to run in one place — the mark route — so a label only
  // expired if the user happened to press another label button afterwards.
  // Opening a message is the thing a user does constantly, which makes it the
  // only trigger frequent enough for a thirty-minute promise to mean anything.
  if (oauthToken) void sweepExpired(oauthToken);

  // A TRACKED thread must not lose the live reading. Forcing status 'untracked'
  // here meant a thread InboxPulse actually knows about got no commitments, no
  // Track buttons and no draft — strictly less than one it had never seen.
  // Resolve it, and carry the stored trend and flags alongside the live reading.
  const tenantIdEarly = await resolveTenant(viewerEmail);
  const dbThreadId =
    threadId && tenantIdEarly ? await resolveThreadIdByProvider(threadId, tenantIdEarly) : null;
  const [storedTrend, storedFlagged] =
    dbThreadId && tenantIdEarly
      ? await Promise.all([
          getThreadTrend(dbThreadId, tenantIdEarly),
          getThreadFlagged(dbThreadId, tenantIdEarly),
        ])
      : [[], []];

  const threadText = (threadMessages ?? [])
    .map((m) => `From: ${m.from ?? 'unknown'}\n${m.body}`)
    .join('\n\n')
    .slice(0, 8000);

  // The external participant's domain is the key to account history. Taken from
  // the thread's participants rather than the open message's From: on a reply
  // the sender is often internal, and the customer is the point.
  const tenantId = tenantIdEarly;
  // The REAL viewer, not a pinned dev id. ADDON_DEV_USER_ID is unset in
  // production, so every account-context call was short-circuiting on an empty
  // userId and the history section silently never rendered.
  const viewer = tenantId && viewerEmail ? await resolveViewer(tenantId, viewerEmail) : null;
  const externalDomain = participants.find((p) => p.external)?.address.split('@')[1];

  // Account history FIRST, then the reading — the reading needs the history as
  // input. Running them in parallel was faster and produced a worse card: the
  // model could only ever talk about the thread, which is exactly what Gemini
  // does three inches to the left.
  const account =
    externalDomain && tenantId
      ? await getAccountContext(externalDomain, tenantId, {
          userId: viewer?.userId ?? '',
          // From the user's actual permissions. Hardcoding false denied admins
          // their own tenant's history.
          isAdmin: viewer?.isAdmin ?? false,
          email: viewerEmail,
        })
      : null;

  const history = account?.found
    ? [
        `Customer: ${account.name}`,
        `${account.messages} messages over ${account.threads} threads since ${account.firstSeen ?? 'unknown'}`,
        account.openTasks ? `${account.openTasks} tasks still open` : null,
        account.negativeCount ? `${account.negativeCount} negative messages on record` : null,
        ...account.priorConcerns.map((c) => `${c.when}: ${c.reason}`),
      ]
        .filter(Boolean)
        .join('\n')
    : undefined;

  // Classify FIRST, in 0.6s. Most mail needs nothing, and knowing that cheaply
  // means never paying 5s to find out — the panel answers an FYI thread in under
  // a second instead of analysing it at length to conclude there was nothing to
  // analyse.
  // A thread that has not changed does not need analysing twice. The panel is
  // opened far more often than mail arrives -- read, switch away, come back --
  // and each of those was paying the full ~4.2s to produce a byte-identical
  // answer. Keyed on the message count and latest message id, so any new reply
  // misses and re-analyses rather than serving a stale claim like "3 questions
  // unanswered" about a conversation that has moved on.
  // The mode is part of the key. Reply stances are written FOR a mode, so a
  // forced mode that reused the cached entry would render new sections around
  // the previous mode's draft -- which is exactly the "same draft everywhere"
  // the demo showed.
  const cacheKeyFor = (m: ThreadMode | null): string =>
    `${AnalysisCache.key({
      threadId,
      viewerEmail,
      count: threadMessages?.length ?? 0,
      latestMessageId: threadMessages?.[threadMessages.length - 1]?.id ?? messageId,
    })}|${m ?? 'auto'}`;
  // Demo override: re-render this thread's real analysis in another mode.
  // Only honoured when ADDON_DEMO_MODE is on, so a stray parameter cannot
  // reshape a real user's card.
  const forced =
    getEnv().ADDON_DEMO_MODE && p.forceMode && THREAD_MODES.includes(p.forceMode as ThreadMode)
      ? (p.forceMode as ThreadMode)
      : null;

  // Classification is mode-independent, so it is cached under the auto key and
  // reused even when a mode is forced -- no need to re-ask what the thread is.
  const autoCached = analysisCache.get(cacheKeyFor(null));
  const classified = forced
    ? (autoCached?.mode ?? null)
    : autoCached
      ? autoCached.mode
      : threadText
        ? await classifyThreadMode({ subject: headers?.subject, thread: threadText })
        : null;

  const mode = forced ?? classified;
  const cacheKey = cacheKeyFor(forced);
  const cached = p.force === 'true' ? null : analysisCache.get(cacheKey);

  // Extraction and prose run CONCURRENTLY, on different models.
  //
  // Ollama runs two different models at once when both fit in memory -- measured,
  // work taking 4.8s + 2.7s sequentially finishes in 4.8s wall. (The same model
  // called twice does NOT: that serialises and wall-clock is the sum, which is
  // the mistake made twice earlier in this build.)
  //
  // So the wait is now max(extraction, prose) rather than one call doing both.
  // It also puts each job on the model suited to it: gemma3:12b is reliable at
  // shape, nemotron is 2.5x faster at prose and has no schema to get wrong.
  const [reading, replyOptions] = cached
    ? [cached.reading, cached.replyOptions]
    : threadText && mode !== 'fyi'
      ? await Promise.all([
          readThreadLive({ subject: headers?.subject, thread: threadText, history }),
          writeReplyOptions({
            subject: headers?.subject,
            thread: threadText,
            history,
            mode: mode ?? undefined,
          }),
        ])
      : [null, [] as ReplyOption[]];

  // Store even the fyi result: knowing a thread needs nothing is worth keeping,
  // and it is the most common answer.
  if (!cached && threadText) analysisCache.set(cacheKey, { mode, reading, replyOptions });

  logger.info({ mode, deepRead: Boolean(reading), cached: Boolean(cached), ...analysisCache.stats() }, 'thread mode');

  // An FYI thread gets a one-line answer and stops. Saying "nothing needed" fast
  // is more useful, and more honest, than four manufactured sections.
  //
  // Unless the user pressed "Read it anyway", which overrides the classifier.
  // They are looking at the thread and we are not; when they disagree with a
  // judgement call, they are the better source.
  if (mode === 'fyi' && p.force !== 'true') {
    return c.json(
      pushCard(
        buildThreadCard({
          messageId,
          status: 'untracked',
          headers,
          viewerEmail,
          participants,
          baseUrl,
          providerThreadId: threadId,
          account,
          historyPoints: buildHistoryPoints(account),
          mode: 'fyi',
          // Without this, an fyi card is a dead end in a demo: the short-circuit
          // returns before the "Show as" row is built, so there is no way back
          // to the other four shapes.
          demoModes: getEnv().ADDON_DEMO_MODE,
          // The escape hatch for the classifier's most costly error. 8 of 37
          // fyi calls on the gauntlet were threads that needed work, and a
          // wrong 'fyi' hides everything -- the user is told there is nothing
          // to do and has no way to disagree. One button costs nothing on the
          // 29 correct calls and rescues the 8 wrong ones.
          fyiEscape: true,
          analysedMessages: threadMessages?.length ?? 0,
          live: { sentiment: 'neutral', reason: '', ephemeral: true },
        }),
      ),
    );
  }

  logger.info(
    { externalDomain, account: account?.name ?? null, negatives: account?.negativeCount ?? 0 },
    'account context',
  );

  if (!reading) {
    // Analysis failed or timed out. Re-render the pending card rather than an
    // empty one, so the button is still there to try again.
    return c.json(
      pushCard(
        buildThreadCard({
          messageId,
          status: 'untracked',
          headers,
          viewerEmail,
          participants,
          baseUrl,
          providerThreadId: threadId,
          account,
          trend: storedTrend,
          flagged: storedFlagged,
          threadId: dbThreadId ?? undefined,
          analysisPending: true,
        }),
      ),
    );
  }

  // Sparkline series, straight from the same reading.
  const liveTrend = reading.messageSentiments.map((sent, i) => ({
    score: sent === 'positive' ? 85 : sent === 'negative' ? 20 : 55,
    sentiment: sent,
    receivedAt: threadMessages?.[i]?.date ?? '',
    isCustomer: true,
  }));

  logger.info(
    {
      commitments: reading.commitments.length,
      hasDraft: Boolean(reading.draft),
      series: liveTrend.length,
    },
    'thread analysed on demand',
  );

  return c.json(
    pushCard(
      buildThreadCard({
        messageId,
        status: 'untracked',
        headers,
        viewerEmail,
        participants,
        baseUrl,
        providerThreadId: threadId,
        analysedMessages: threadMessages?.length ?? 0,
        account,
        // Built from the DATABASE, not from the model.
        //
        // Asking the reading for these was slower, cost tokens, and did not
        // work — gemma3:12b returned an empty array even with the history in
        // the prompt, because it was instruction 7 of 7. But the model was only
        // ever being asked to restate structured rows we already hold, and a
        // model restating a database is the least efficient thing on this card.
        // Deterministic, instant, and it cannot hallucinate a date.
        historyPoints: buildHistoryPoints(account),
        // Explicitly, not only via `headers`: on an action-triggered render the
        // message id may not travel and the header fetch returns undefined,
        // which silently emptied the subject out of calendar titles and the
        // related-mail search.
        subject: headers?.subject ?? (p.subject || undefined),
        mode: mode ?? reading.mode,
        demoModes: getEnv().ADDON_DEMO_MODE,
        // Only gmail has rows in `integrations` (15, of which 2 active); the
        // enum allows outlook/slack/other and none are configured. Hardcoded
        // rather than queried -- a per-render round trip for a fact that
        // changes about once a quarter is not worth it.
        connectedSources: ['gmail'],
        webUrl: getEnv().WEB_URL,
        live: { sentiment: reading.sentiment, reason: reading.reason, ephemeral: true },
        digest: { commitments: reading.commitments, openQuestions: reading.openQuestions },
        draft: reading.draft || null,
        replyOptions,
      }),
    ),
  );
});

// Action callback: "Track" on a commitment. The one control on the panel that
// WRITES — it turns a commitment the model found into a task in the CRM.
// Answers with a toast rather than rebuilding the card, so the user keeps their
// place and sees the outcome immediately.
app.post('/gmail/task', async (c) => {
  let event: AddonEvent = {};
  try {
    event = await c.req.json<AddonEvent>();
  } catch {
    /* keep the endpoint curl-testable */
  }

  const verified = await verifyRequest(c.req.header('authorization'), event);
  if (!verified.ok) return c.json(notify('Could not verify this request.'));

  const p = getActionParameters(event);
  const tenantId = await resolveTenant(verified.email);
  if (!tenantId || !p.customerId || !p.title) return c.json(notify('Could not create the task.'));

  const ok = await createTask({
    tenantId,
    userId: getEnv().ADDON_DEV_USER_ID ?? '',
    isAdmin: false,
    customerId: p.customerId,
    title: p.title,
  });

  // A refusal here is an ENTITLEMENT refusal, not a failure — the viewer is not
  // assigned to that customer. Say so, rather than reporting a generic error.
  return c.json(notify(ok ? 'Task created' : 'You do not have access to this account'));
});

/**
 * Write the reply for a stance the user chose over the recommendation.
 *
 * The reading returns every stance but writes only the recommended one, because
 * writing all three costs 15.5-16.2s against 8.4-8.6s for one and the user sends
 * exactly one. This is where the other two get written — paid only by the user
 * who disagrees with the recommendation.
 *
 * Re-reads the thread rather than carrying it in an action parameter: the thread
 * does not fit in one, and Gmail hands us the token to read it again anyway.
 */
app.post('/gmail/stance', async (c) => {
  let event: AddonEvent = {};
  try {
    event = await c.req.json<AddonEvent>();
  } catch {
    /* keep the endpoint curl-testable */
  }

  const verified = await verifyRequest(c.req.header('authorization'), event);
  if (!verified.ok) return c.json(notify('Could not verify this request.'));

  const { accessToken, oauthToken } = getGmail(event);
  const p = getActionParameters(event);
  if (!p.stance) return c.json(notify('No approach was selected.'));

  const threadId = normalizeGmailMessageId(p.threadId);
  const messageId = normalizeGmailMessageId(p.messageId);
  const headers = await fetchMessageHeaders(messageId, oauthToken, accessToken);
  const threadMessages = await fetchThreadMessages(threadId, oauthToken, accessToken);
  const threadText = (threadMessages ?? [])
    .map((m) => `From: ${m.from ?? 'unknown'}\n${m.body}`)
    .join('\n\n')
    .slice(0, 8000);
  if (!threadText) return c.json(notify('Could not read this thread.'));

  const text = await draftForStance({ subject: headers?.subject, thread: threadText, stance: p.stance });
  if (!text) return c.json(notify('Could not write that reply.'));

  return c.json(
    pushCard(
      buildThreadCard({
        status: 'untracked',
        subject: headers?.subject ?? undefined,
        messageId: messageId ?? undefined,
        providerThreadId: threadId ?? undefined,
        viewerEmail: verified.email ?? undefined,
        baseUrl: getEnv().ADDON_BASE_URL,
        mode: 'working',
        replyOptions: [{ stance: p.stance, rationale: 'you chose this approach', text }],
      }),
    ),
  );
});

/**
 * Toggle an instant label on the open thread.
 *
 * No Gmail write, and therefore no scope: the mark lives in the panel. Pressing
 * the same button again clears it, which has to be the same button or it is not
 * a toggle.
 */
app.post('/gmail/mark', async (c) => {
  let event: AddonEvent = {};
  try {
    event = await c.req.json<AddonEvent>();
  } catch {
    /* keep the endpoint curl-testable */
  }
  const verified = await verifyRequest(c.req.header('authorization'), event);
  if (!verified.ok) return c.json(notify('Could not verify this request.'));

  const p = getActionParameters(event);
  const label = p.labelKey ? instantLabelByKey(p.labelKey) : null;
  const threadId = normalizeGmailMessageId(p.threadId);
  if (!label || !threadId) return c.json(notify('Could not mark this thread.'));

  const short = label.name.split('/')[1];
  const { oauthToken } = getGmail(event);
  // Every working-set entry is namespaced by the viewer who made it — see
  // instant-labels.ts. Without this the homepage listed one user's marked
  // thread SUBJECTS to any other user of the service.
  const viewer = verified.email ?? 'anon';

  // GMAIL DECIDES whether this is on, not our memory.
  //
  // The in-memory state lives in a process Cloud Run scales to zero, so it is
  // forgotten as a matter of course. A toggle that trusted it re-applied a
  // label that was already there and reported "clears in 30 min" while nothing
  // visibly changed — the exact bug this replaces. Memory is still where expiry
  // lives, because Gmail cannot tell us when something should come off.
  let on: boolean;
  let wrote = false;
  if (oauthToken) {
    const labelId = await ensureLabel(label, oauthToken);
    const present = labelId ? (await labelsOnThread(threadId, oauthToken)).has(labelId) : false;
    on = !present;
    if (labelId) {
      wrote = on
        ? await addLabel(threadId, labelId, oauthToken)
        : await removeLabel(threadId, labelId, oauthToken);
    }
    // Keep the panel's view in step with what we just did to the mailbox.
    if (on) workingSet.turnOnFor(viewer, threadId, label.key, p.subject ?? '');
    else workingSet.turnOffFor(viewer, threadId, label.key);
  } else {
    const r = workingSet.mark(viewer, threadId, label.key, p.subject ?? '');
    on = r.on;
  }
  const res = { on, minutesLeft: workingSet.minutesLeftFor(viewer, threadId, label.key) };

  // Sweep anything that expired while the user was away. Lazy, because there is
  // no cron -- and the moment a user is not opening their mail is the moment a
  // stale working-set label costs them nothing.
  if (oauthToken) await sweepExpired(oauthToken);

  return c.json(
    notify(
      res.on
        ? wrote
          ? `${short} added — refresh Gmail to see it. Clears in ${res.minutesLeft} min.`
          : `${short} — clears in ${res.minutesLeft} min (panel only)`
        : `${short} cleared — refresh Gmail to see it go`,
    ),
  );
});

/**
 * Remove every instant label whose thirty minutes are up.
 *
 * Runs on every mark and every homepage open. A label that outlives its window
 * is the accretion this feature exists to avoid, so the sweep is not optional
 * housekeeping -- it is the half of the contract the user cannot see.
 */
async function sweepExpired(oauthToken: string): Promise<void> {
  for (const app of instantState.takeExpired()) {
    const label = instantLabelByKey(app.labelKey);
    if (!label) continue;
    const labelId = await ensureLabel(label, oauthToken);
    if (labelId) await removeLabel(app.threadId, labelId, oauthToken);
  }
}

/**
 * Prioritize the inbox: one press, an ordered list of what to do next.
 *
 * The panel cannot see which rows the user has selected — Gmail gives add-ons
 * two triggers, compose and message-open, and neither carries a selection. So
 * this picks the threads instead of the user picking them, which is the better
 * shape anyway: the point is that the DEFAULT order is good, not that the tools
 * for reordering are.
 *
 * Classification runs concurrently. Sequentially, a dozen threads at ~0.5s each
 * is six seconds of staring at a spinner; against a network model there is no
 * reason to pay that.
 */
app.post('/gmail/triage', async (c) => {
  let event: AddonEvent = {};
  try {
    event = await c.req.json<AddonEvent>();
  } catch {
    /* keep the endpoint curl-testable */
  }
  const verified = await verifyRequest(c.req.header('authorization'), event);
  if (!verified.ok) return c.json(notify('Could not verify this request.'));

  const { oauthToken } = getGmail(event);
  if (!oauthToken) return c.json(notify('Gmail access is not granted.'));

  const threads = await recentThreads(oauthToken, 'in:inbox -category:promotions', 12);
  if (!threads.length) return c.json(notify('Nothing in the inbox to prioritize.'));

  const classified = await Promise.all(
    threads.map(async (t) => ({
      threadId: t.id,
      subject: t.subject,
      from: t.from,
      at: t.at,
      mode:
        (await classifyThreadMode({ subject: t.subject, thread: t.snippet })) ?? ('working' as const),
    })),
  );

  const { work, quiet } = splitQuiet(rankTriage(classified, Date.now()));
  return c.json(
    pushCard(
      buildTriageCard({
        work,
        quiet,
        viewerEmail: verified.email ?? undefined,
        baseUrl: getEnv().ADDON_BASE_URL,
      }),
    ),
  );
});

/**
 * Put the triage order into the inbox as labels.
 *
 * The panel's ordering is only useful while the panel is open; the work happens
 * in a list that is still sorted by date. Labelling the top few carries the
 * decision to where the scanning is.
 *
 * Bounded deliberately. This writes a MODEL'S OPINION into a real mailbox, so
 * it is the top five only, user-initiated by a second press, using the same
 * self-clearing Focus label — the smallest write that carries the point, and
 * one that undoes itself in thirty minutes whether or not anyone comes back.
 */
app.post('/gmail/triage/label', async (c) => {
  let event: AddonEvent = {};
  try {
    event = await c.req.json<AddonEvent>();
  } catch {
    /* keep the endpoint curl-testable */
  }
  const verified = await verifyRequest(c.req.header('authorization'), event);
  if (!verified.ok) return c.json(notify('Could not verify this request.'));

  const { oauthToken } = getGmail(event);
  const p = getActionParameters(event);
  const ids = (p.threadIds ?? '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 5);
  const subjects = (p.subjects ?? '').split('|');
  if (!oauthToken || !ids.length) return c.json(notify('Nothing to label.'));

  const focus = instantLabelByKey('focus');
  if (!focus) return c.json(notify('Nothing to label.'));
  const labelId = await ensureLabel(focus, oauthToken);
  if (!labelId) return c.json(notify('Could not create the label.'));

  let n = 0;
  for (const [i, id] of ids.entries()) {
    if (await addLabel(id, labelId, oauthToken)) {
      workingSet.turnOnFor(verified.email ?? 'anon', id, 'focus', subjects[i] ?? '');
      n += 1;
    }
  }
  // Say that Gmail needs a refresh.
  //
  // An add-on cannot repaint the host message list. There is no API for it:
  // CardService controls the panel only, and Apps Script's refreshMessages()
  // reloads the add-on's view of message state, not Gmail's UI. So the labels
  // are genuinely applied and genuinely invisible until the user reloads, and
  // the only honest thing is to say so rather than let them wonder whether the
  // button worked.
  return c.json(
    notify(`Focus added to ${n} thread${n === 1 ? '' : 's'} — refresh Gmail to see them. Clears in 30 min.`),
  );
});

/**
 * Clear every instant label, everywhere.
 *
 * The removal path that cannot fail. Timed expiry needs a live process to
 * remember when each mark was made, and that memory does not survive a deploy
 * or a restart — marks made before one are orphaned, sitting in the mailbox
 * with nothing left that knows to remove them. This asks GMAIL what is labelled
 * and takes it off, so it works no matter what the process remembers.
 */
app.post('/gmail/clear-marks', async (c) => {
  let event: AddonEvent = {};
  try {
    event = await c.req.json<AddonEvent>();
  } catch {
    /* keep the endpoint curl-testable */
  }
  const verified = await verifyRequest(c.req.header('authorization'), event);
  if (!verified.ok) return c.json(notify('Could not verify this request.'));

  const { oauthToken } = getGmail(event);
  if (!oauthToken) return c.json(notify('Gmail access is not granted.'));

  let total = 0;

  // Retired names are DELETED, not detached.
  //
  // Renaming the prefix created a second set of labels beside the first, so the
  // sidebar showed sixteen entries where eight were intended — half of them
  // permanently empty. Detaching leaves the definition behind; deleting removes
  // it AND takes it off every thread that carried it.
  let removedDefs = 0;
  for (const name of retiredLabelNames()) {
    if (await deleteLabelByName(name, oauthToken)) removedDefs += 1;
  }

  for (const label of [...INSTANT_LABELS, ...MODE_LABELS]) {
    total += await clearAllOfLabel(label, oauthToken);
    for (const a of instantState.active().filter((x) => x.labelKey === label.key)) {
      instantState.turnOff(a.threadId, a.labelKey);
    }
  }
  workingSet.prune();
  return c.json(
    notify(
      total || removedDefs
        ? `Cleared ${total} thread${total === 1 ? '' : 's'}` +
          (removedDefs ? `, removed ${removedDefs} old label${removedDefs === 1 ? '' : 's'}` : '') +
          ' — refresh Gmail to see'
        : 'Nothing marked',
    ),
  );
});

/**
 * Color the inbox by what each thread needs.
 *
 * The triage already classified every thread; this writes that classification
 * back so it is visible while scanning rather than only inside the panel.
 *
 * These are a MODEL'S claims, not the user's, which is the category ADR-018
 * exists to restrain. So they inherit every guard the instant labels have —
 * namespaced, self-clearing, one press to undo, cleared wholesale by "Clear all
 * my marks" — and fyi is never written at all. Labelling the largest mode to
 * say nothing is needed would be `Automated` at 51.7% again.
 */
app.post('/gmail/triage/label-types', async (c) => {
  let event: AddonEvent = {};
  try {
    event = await c.req.json<AddonEvent>();
  } catch {
    /* keep the endpoint curl-testable */
  }
  const verified = await verifyRequest(c.req.header('authorization'), event);
  if (!verified.ok) return c.json(notify('Could not verify this request.'));

  const { oauthToken } = getGmail(event);
  const p = getActionParameters(event);
  // "threadId:mode,threadId:mode" — the classification is already done, so this
  // costs no model calls at all.
  const pairs = (p.byMode ?? '')
    .split(',')
    .map((s) => s.split(':'))
    .filter((x) => x.length === 2 && x[0] && x[1])
    .slice(0, 12);
  if (!oauthToken || !pairs.length) return c.json(notify('Nothing to label.'));

  const ids = new Map<string, string>();
  let n = 0;
  for (const [threadId, mode] of pairs) {
    const label = modeLabelFor(mode);
    if (!label) continue; // fyi, deliberately
    let labelId = ids.get(label.key);
    if (!labelId) {
      const created = await ensureLabel(label, oauthToken);
      if (!created) continue;
      labelId = created;
      ids.set(label.key, labelId);
    }
    if (await addLabel(threadId, labelId, oauthToken)) {
      workingSet.turnOnFor(verified.email ?? 'anon', threadId, label.key, '');
      n += 1;
    }
  }
  return c.json(
    notify(
      n
        ? `Labelled ${n} thread${n === 1 ? '' : 's'} by type — refresh Gmail to see them. Clears in 30 min.`
        : 'Nothing needed a label.',
    ),
  );
});

// Homepage trigger — opened without a message context.
app.post('/homepage', async (c) => {
  const env = getEnv();
  if (!env.SERVICE_API_KEY) return c.json(pushCard(buildHomepageCard(null)));
  let event: AddonEvent = {};
  try {
    event = await c.req.json<AddonEvent>();
  } catch {
    /* empty body is fine for local curl */
  }
  const verified = await verifyRequest(c.req.header('authorization'), event);
  if (!verified.ok) return c.json(pushCard(buildHomepageCard(null)));
  const tenantId = await resolveTenant(verified.email);
  // Not fetched any more. The only thing /api/internal/emails/stats fed was the
  // "Emails ingested / Analyzed" block, which was removed as a fact about our
  // pipeline rather than the reader's day. What remained was a serial round-trip
  // on every homepage render — up to the 2s API deadline — for a number nothing
  // displays, whose failure was the sole trigger for the "not connected" banner.
  const stats = null;
  // Resolve the real viewer before asking — the query is entitlement-scoped and
  // "who is unhappy" must not become a way to read accounts they cannot open.
  const who = tenantId && verified.email ? await resolveViewer(tenantId, verified.email) : null;
  const waiting = tenantId && who ? await getWaitingClients(tenantId, who.userId, who.isAdmin) : [];
  const pulse = tenantId ? await getDangerPulse(tenantId) : null;
  // Both are management views: where the fires are, and who to ask about them.
  const fires = tenantId && who ? await getFires(tenantId, who.userId, who.isAdmin) : [];
  // A viewer with no admin permission and no assigned customers sees nothing in
  // the entitlement-scoped sections. That must be stated on the card, not left
  // as an absent section that reads as "nothing is wrong".
  const restricted = Boolean(who && !who.isAdmin && who.accessibleCustomers === 0);
  const slow = tenantId ? await getSlowResponders(tenantId) : [];
  // The working set is the reason to open the panel without a message: it is
  // the only view of what the user marked, since nothing was written to Gmail.
  workingSet.prune();
  const { oauthToken: homeToken } = getGmail(event);
  if (homeToken) void sweepExpired(homeToken);
  return c.json(
    pushCard(
      buildHomepageCard(
        stats,
        {
          entries: workingSet.entries(verified.email ?? 'anon'),
          viewerEmail: verified.email ?? undefined,
          threadUrl: gmailThreadUrl,
        },
        getEnv().ADDON_BASE_URL,
        { clients: waiting, webUrl: getEnv().WEB_URL },
        pulse ?? undefined,
        { fires, restricted, windowDays: 90, webUrl: getEnv().WEB_URL },
        { people: slow, firmMedianH: pulse?.negativeMedianH ?? null, webUrl: getEnv().WEB_URL, windowDays: 90 },
      ),
    ),
  );
});

// Gmail contextual trigger — a message is open.
app.post('/gmail/contextual', async (c) => {
  const env = getEnv();
  let event: AddonEvent = {};
  try {
    event = await c.req.json<AddonEvent>();
  } catch {
    // Allow an empty body so the endpoint is curl-testable locally.
  }
  const { messageId: rawMessageId, threadId: rawThreadId, accessToken, oauthToken } = getGmail(event);
  // The event can carry ids as `msg-f:`/`thread-f:<decimal>`; the Gmail API and
  // our stored ids use the bare hex form. Normalize so resolution paths match.
  const messageId = normalizeGmailMessageId(rawMessageId);
  const providerThreadId = normalizeGmailMessageId(rawThreadId);

  // Preview mode means "no InboxPulse API", which is a reason to skip STORED
  // analysis — not a reason to skip live analysis, which never calls crm-api.
  // Short-circuiting here made the whole live path unreachable without a shared
  // service secret, which is exactly the friction the live path exists to avoid.
  if (!env.SERVICE_API_KEY && !isLiveAnalysisEnabled()) {
    return c.json(pushCard(buildThreadCard({ messageId, status: 'preview' })));
  }

  const verified = await verifyRequest(c.req.header('authorization'), event);
  if (!verified.ok) {
    logger.warn({ reason: verified.reason }, 'contextual: request not verified');
    return c.json(pushCard(buildThreadCard({ messageId, status: 'unverified' })));
  }

  // Which credentials Google actually sent. A 403 "insufficient scopes" is
  // indistinguishable from a missing token in the failure message, so record
  // presence (never the values) before the call rather than guessing after it.
  logger.info(
    {
      hasMessageId: Boolean(messageId),
      hasAccessToken: Boolean(accessToken),
      hasOauthToken: Boolean(oauthToken),
      eventKeys: Object.keys(event ?? {}),
      gmailKeys: Object.keys((event as Record<string, unknown>)?.gmail ?? {}),
    },
    'contextual: inbound credentials',
  );

  // The open message's own envelope headers (title / from / to / cc / bcc) plus
  // its cross-mailbox-stable RFC Message-ID, in one Gmail metadata call.
  const headers = await fetchMessageHeaders(messageId, oauthToken, accessToken);
  const viewerEmail = verified.email;

  /**
   * Analyse the open message in-request. Depends on nothing but Gmail and the
   * configured model — no tenant, no service key, no stored record — so it is
   * available on every branch where we would otherwise render an empty state.
   */
  const liveForOpenMessage = async () => {
    if (!isLiveAnalysisEnabled()) return null;
    const body = await fetchMessageBody(messageId, oauthToken, accessToken);
    if (!body) return null;
    return analyseMessageLive({ subject: headers?.subject, from: headers?.from, body });
  };

  const tenantId = await resolveTenant(viewerEmail);
  if (!tenantId) {
    // No workspace link. Stored context is unavailable, but the message itself
    // can still be read — which is the whole point of the live path.
    const live = await liveForOpenMessage();
    return c.json(
      pushCard(buildThreadCard({ messageId, status: 'unidentified', headers, viewerEmail, live })),
    );
  }

  // Thread-level trend + flagged for a DB thread id (best-effort; [] on failure).
  const threadExtras = async (
    dbThreadId: string | null | undefined,
  ): Promise<[Awaited<ReturnType<typeof getThreadTrend>>, Awaited<ReturnType<typeof getThreadFlagged>>]> =>
    dbThreadId
      ? Promise.all([getThreadTrend(dbThreadId, tenantId), getThreadFlagged(dbThreadId, tenantId)])
      : [[], []];

  // Even an untracked open message still gets the thread's trend/flagged when the
  // thread is known (resolved via its Gmail thread id from the event).
  const baseUrl = env.ADDON_BASE_URL;
  const untrackedCard = async () => {
    const dbThreadId = providerThreadId ? await resolveThreadIdByProvider(providerThreadId, tenantId) : null;
    const [trend, flagged] = await threadExtras(dbThreadId);

    // Nothing stored for this thread — analyse the open message in-request and
    // throw the result away. Opt-in, and only on this branch: a tracked thread
    // always uses its stored analysis. Every failure returns null, so the card
    // renders exactly as before.
    // Nothing stored for this thread. Read the WHOLE thread and analyse each
    // message, so the sparkline has a real series rather than one padded point.
    // Falls back to the open message alone when the thread read is refused —
    // the per-message token may not reach beyond the message being viewed.
    let live = null;
    const digest = null;
    const draft: string | null = null;
    let participants: Participant[] = [];
    let analysisPending = false;
    if (!trend.length && !flagged.length && isLiveAnalysisEnabled()) {
      const threadMessages = await fetchThreadMessages(providerThreadId, oauthToken, accessToken);
      if (threadMessages?.length) {
        // Who is involved comes from the WHOLE chain — see services/participants.
        participants = deriveParticipants(threadMessages, viewerEmail);

        // The per-message sentiment loop was dropped here. It was the slowest
        // part of the render and the least useful output: a row of identical
        // squares on an internal thread tells the reader nothing. Commitments
        // and unanswered questions are invisible at a glance and matter even
        // when nothing is wrong, which is most mail.
        const threadText = threadMessages
          .map((m) => `From: ${m.from ?? 'unknown'}\n${m.body}`)
          .join('\n\n')
          .slice(0, 8000);

        // NOTHING is analysed on first paint. Reading the thread costs ~6s on
        // local hardware and Gmail shows an empty panel until the response
        // lands, so the model call moved behind a button — see the
        // analysisPending branch in buildThreadCard and /gmail/analyse below.
        analysisPending = true;
        logger.info({ messages: threadMessages.length }, 'first paint: analysis deferred');
      } else {
        live = await liveForOpenMessage();
      }
    }

    // Gmail refused the read, so we know nothing about the open message. Saying
    // "not a tracked client thread" here would be a confident answer to a
    // question we never got to ask.
    const status = !headers && !live ? ('unreadable' as const) : ('untracked' as const);

    return c.json(
      pushCard(
        buildThreadCard({
          messageId,
          status,
          headers,
          viewerEmail,
          trend,
          flagged,
          threadId: dbThreadId ?? undefined,
          baseUrl,
          live,
          chatShareEnabled: isChatShareEnabled(),
          participants,
          digest,
          draft,
          analysisPending,
          providerThreadId,
        }),
      ),
    );
  };

  if (!messageId) return untrackedCard();

  // The RFC Message-ID (read above) lets a thread ingested from a teammate's
  // mailbox still resolve — per-mailbox provider ids differ.
  const resolved = await resolveThreadByMessage(messageId, headers?.rfcMessageId, tenantId);
  if (!resolved) return untrackedCard();

  const analyzed = await getAnalyzedEmail(resolved.emailId, tenantId);
  const flags = signalNames(resolved.signals.length ? resolved.signals : analyzed?.signals ?? []);
  const [trend, flagged] = await threadExtras(resolved.threadId);
  return c.json(
    pushCard(
      buildThreadCard({
        messageId,
        status: 'resolved',
        analysisPending: isLiveAnalysisEnabled(),
        providerThreadId,
        accountName: analyzed?.customerName,
        flags,
        headers,
        viewerEmail,
        trend,
        flagged,
        threadId: resolved.threadId,
        baseUrl,
        subject: resolved.subject ?? analyzed?.subject,
        fromEmail: analyzed?.fromEmail,
        receivedAt: resolved.receivedAt,
        task: analyzed?.taskId
          ? {
              done: analyzed.taskDone,
              assignee: analyzed.assignedToName,
              problem: analyzed.problem,
              resolution: analyzed.resolution,
            }
          : null,
      }),
    ),
  );
});

const port = getEnv().PORT;
logger.info({ port }, 'crm-addon starting');

// Bun serves the module's DEFAULT export (a { port, fetch } server config) when
// running `bun dist/index.js`. This is the idiomatic Bun entrypoint — do NOT
// also call @hono/node-server's serve(), and do NOT use a named export here
// (Bun would try to Bun.serve() an object with no `fetch` and crash on boot).
export default {
  port,
  fetch: app.fetch,
};
